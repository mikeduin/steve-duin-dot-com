# NewsBank Sync Process Reference

This document describes how NewsBank sync works in this repository so you can reuse the same context in future chat sessions.

## Scope
- Sync trigger path: Admin Portal (`web`) -> GraphQL mutation (`api`) -> NewsBank sync service (`api/src/scraper/newsbank-sync.ts`).
- Data targets: `articles` table and `sync_runs` table.

## Core Goals
- Idempotent writes: re-syncing existing articles should update, not duplicate.
- Safe stale cleanup: old rows should only be removed after a full crawl.
- Observable runs: each sync records status, counters, and errors.

## Data Model

### `articles`
Important fields used by sync:
- `source_id`
- `external_key` (stable identity, NewsBank docref-based when available)
- `url`
- `title`, `date`, `snippet`
- `body_text`
- source metadata: `publication_name`, `byline`, `article_section`, `word_count`, `source_metadata`
- `extraction_method`, `content_extracted_at`

Identity rules:
- Primary sync identity is `(source_id, external_key)`.
- During migration/legacy overlap, upsert matching also falls back to `(source_id, url)`.
- This fallback prevents unique collisions from legacy URL-constrained rows.

### `sync_runs`
Each run stores:
- run config: `source_name`, `prune_stale`, `max_pages`, `max_articles`
- lifecycle: `status`, `started_at`, `finished_at`, `error_message`
- counters: `total_discovered`, `processed_count`, `inserted_count`, `updated_count`, `failed_count`, `deleted_stale_count`

## End-to-End Flow
1. Admin starts sync from `Admin Portal`.
2. GraphQL creates a `sync_runs` row with `status=running`.
3. Service crawls NewsBank result pages and queues article URLs.
4. Service fetches article pages and extracts title/date/body/snippet.
5. Service upserts each article row.
6. Service updates run progress counters.
7. Optional stale prune runs only when crawl is complete.
8. `sync_runs.status` transitions to `completed` or `failed`.

## Upsert Behavior
Upsert matching is intentionally defensive:
- Try to match existing article by `external_key` for same `source_id`.
- Also match by `url` for same `source_id` to catch legacy records.
- If match exists, update row fields.
- If no match, insert a new row.

This is implemented in:
- `api/src/scraper/newsbank-sync.ts`

## Stale Prune Safety Guard
`prune_stale` does NOT run on partial crawls.

Prune runs only when the crawl appears complete, meaning:
- Result pages were fully exhausted (no next page remaining), and
- Run did not stop due to `max_pages`, and
- Run did not stop due to `max_articles` during discovery or processing.

This prevents limited test runs from deleting older rows outside the fetched window.

## Admin Portal Behavior
Admin sync controls include:
- `maxPages`
- `maxArticles`
- `pruneStale`

Status display includes:
- running/completed/failed
- progress counters
- inserted/updated/failed/deleted stale totals
- timestamps and errors

## Recommended Operating Modes

### Safe test run (no delete risk)
- Use low `maxPages` / `maxArticles`
- Set `pruneStale=false`

### Full production run
- Use high enough limits to fully traverse current corpus
- Set `pruneStale=true`
- Confirm run completes and check `deleted_stale_count`

### Recovery run after accidental pruning
- Run with broader limits and `pruneStale=false` first to repopulate missing rows.
- After data is back, run a full crawl with `pruneStale=true`.

## Quick Verification Queries

Recent runs:
```sql
select id, status, prune_stale, max_pages, max_articles,
       total_discovered, processed_count,
       inserted_count, updated_count, failed_count, deleted_stale_count,
       started_at, finished_at
from sync_runs
order by id desc
limit 10;
```

Article counts by source:
```sql
select s.name as source_name, count(*)::int as article_count
from articles a
join sources s on s.id = a.source_id
group by s.name
order by article_count desc;
```

## Related Files
- `api/src/scraper/newsbank-sync.ts`
- `api/src/graphql/schema.ts`
- `api/src/graphql/resolvers.ts`
- `web/src/App.tsx`
- `api/migrations/20260406000300_add_article_external_key_and_sync_runs.cjs`
