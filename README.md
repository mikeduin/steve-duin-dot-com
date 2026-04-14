# steve-duin-dot-com

Monorepo with a GraphQL API and React web app.

## Requirements
- Node 18+
- Yarn Classic (1.x)
- Postgres

## Setup
1. Install dependencies:
   - `yarn`
2. Copy env templates:
  - `cp api/.env.example api/.env`
   - Update `DATABASE_URL`
3. Run dev servers:
   - `yarn dev`

## Scripts
- `yarn dev` - run API and web in dev mode
- `yarn dev:api` - API only
- `yarn dev:web` - web only
- `yarn build` - build both packages
- `yarn typecheck` - typecheck all workspaces

## API
GraphQL endpoint: `http://localhost:4000/graphql`

`Column` rows now include a `tags` string array and can be updated with `updateColumnTags(id, tags)`.

Example query:
```
query SearchArticles($query: String!) {
  searchArticles(query: $query) {
    id
    title
    date
    source {
      id
      name
    }
  }
}
```

## Scraper (Oregon Historical Newspapers)
1. Run migrations:
  - `yarn workspace api knex:migrate`
2. Run scraper:
  - `yarn workspace api scrape:odnp`

Adjust scraper env vars in `api/.env` as needed (query, date range, max pages). Leave `ODNP_LCCN` blank to search all papers.

## Admin Portal (Newsbank Request Config)
Use the web app Admin Portal to store a Newsbank request profile from a copied browser cURL command.

1. Ensure migrations are up to date:
  - `yarn workspace api knex:migrate`
2. Start the app:
  - `yarn dev`
3. Open the web app and switch to `Admin Portal`.
4. Paste the cURL command from your network tab and click `Save Request`.

The API stores the latest parsed Newsbank request details (URL, method, headers, cookie, body) in `newsbank_request_configs` for scraper reuse.

## Table Tags
Use the web app `Table` tab to manage custom tags per column and filter the table by tags.

1. Ensure migrations are up to date:
  - `yarn workspace api knex:migrate`
2. Open the `Table` tab.
3. Add comma-separated tags in any row and click `Save`.
4. Use the table tag filter input to require matching tags.

## Scraper (NewsBank)
This scraper uses the saved Admin Portal cURL config (especially the cookie header) to access protected NewsBank results and article pages.

Detailed process and runbook reference:
- `docs/newsbank-sync-process.md`

1. Save a fresh NewsBank cURL command in the `Admin Portal` first.
2. Ensure migrations are up to date:
  - `yarn workspace api knex:migrate`
3. Run the scraper:
  - `yarn workspace api scrape:newsbank`

Behavior:
- Crawls NewsBank result pages starting from `NEWSBANK_RESULTS_URL` (or saved cURL URL).
- Follows pagination via detected next-page links.
- Fetches article pages, extracts best-effort title/date/text.
- Upserts article rows into `articles` including `snippet`, `body_text`, source metadata (`publication_name`, `byline`, `article_section`, `word_count`, `source_metadata`), and extraction metadata, and writes extraction payloads to `api/.tmp/newsbank-articles.ndjson`.
- If `NEWSBANK_DEBUG_SNAPSHOTS=true`, writes HTML snapshots to `api/.tmp/newsbank-debug` to help inspect hidden data sources in the response.

## Scraper (NewsBank Single Article)
Use this to validate body extraction quality before running large crawls.

1. Set one target in `api/.env`:
  - `NEWSBANK_ONE_DOCREF=1A081CA2640C7460` (or)
  - `NEWSBANK_ONE_URL=https://infoweb.newsbank.com/apps/news/document-view?...`
2. Run:
  - `yarn workspace api scrape:newsbank:one`

The command fetches one article with your saved NewsBank session cookie, extracts body text plus source metadata with method tagging, and upserts the record in `articles`.

## NewsBank Duplicate Flagging
Use the dedupe script to flag near-duplicate NewsBank rows where the title starts the same but one version includes `Steve Duin column` suffix text.

1. Ensure migrations are up to date:
  - `yarn workspace api knex:migrate`
2. Run a dry-run first (no data changes):
  - `yarn workspace api dedupe:newsbank --dry-run --sample=25`
3. Review sample duplicate/canonical pairs in output.
4. Apply flags when satisfied:
  - `yarn workspace api dedupe:newsbank --apply`

Flagged rows are marked with `articles.is_newsbank_duplicate = true` and excluded from `searchArticles` and `searchColumns` query results.
