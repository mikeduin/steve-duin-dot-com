import db from "../db/knex.js";
import { NEWSBANK_CONFIG_KEY } from "../newsbank/config.js";
import { parseCurlRequest } from "../newsbank/curl.js";
import { runNewsbankSync } from "../scraper/newsbank-sync.js";
import type { Article, Column, NewsbankRequestConfig, Resolvers } from "./types.js";

type UpsertedNewsbankConfigRow = {
  id: number;
  key: string;
  curl_text: string;
  request_url: string | null;
  method: string;
  cookie_header: string | null;
  headers_json: unknown;
  body_text: string | null;
  updated_at: Date | string;
};

type ArticleWithSourceRow = {
  id: number;
  title: string;
  date: Date | string;
  url: string | null;
  snippet: string | null;
  source_id: number;
  source_name: string;
  source_url: string | null;
};

type ColumnWithSourceRow = ArticleWithSourceRow & {
  body_text: string | null;
  source_metadata: string | null;
  publication_name: string | null;
  byline: string | null;
  article_section: string | null;
  word_count: number | null;
  extraction_method: string | null;
  content_extracted_at: Date | string | null;
  tags: string[] | null;
};

type SyncRunRow = {
  id: number;
  source_name: string;
  status: string;
  prune_stale: boolean;
  max_pages: number | null;
  max_articles: number | null;
  total_discovered: number;
  processed_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_existing_count: number;
  failed_count: number;
  deleted_stale_count: number;
  error_message: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  updated_at: Date | string;
};

const NEWSBANK_SOURCE_NAME = "NewsBank";
const NEWSBANK_STALE_RUN_MINUTES = Math.max(1, Number(process.env.NEWSBANK_STALE_RUN_MINUTES ?? "30"));

const applyNonDuplicateFilter = (builder: { whereRaw: (sql: string) => unknown }) => {
  builder.whereRaw("coalesce(articles.is_newsbank_duplicate, false) = false");
};

let activeNewsbankRunId: number | null = null;

const toGraphConfig = (row: UpsertedNewsbankConfigRow): NewsbankRequestConfig => ({
  id: String(row.id),
  key: row.key,
  curl: row.curl_text,
  requestUrl: row.request_url,
  method: row.method,
  cookieHeader: row.cookie_header,
  headers: JSON.stringify(row.headers_json ?? {}),
  bodyText: row.body_text,
  updatedAt: new Date(row.updated_at).toISOString()
});

const toGraphArticle = (row: ArticleWithSourceRow): Article => ({
  id: String(row.id),
  title: row.title,
  date: new Date(row.date).toISOString().slice(0, 10),
  url: row.url,
  snippet: row.snippet,
  source: {
    id: String(row.source_id),
    name: row.source_name,
    url: row.source_url
  }
});

const toGraphColumn = (row: ColumnWithSourceRow): Column => ({
  ...toGraphArticle(row),
  bodyText: row.body_text,
  sourceMetadata: row.source_metadata,
  publicationName: row.publication_name,
  byline: row.byline,
  articleSection: row.article_section,
  wordCount: row.word_count,
  extractionMethod: row.extraction_method,
  contentExtractedAt: row.content_extracted_at ? new Date(row.content_extracted_at).toISOString() : null,
  tags: row.tags ?? []
});

const normalizeTags = (values: readonly string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
};

const toGraphSyncRun = (row: SyncRunRow) => {
  const total = Math.max(row.total_discovered, 0);
  const processed = Math.max(row.processed_count, 0);
  const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return {
    id: String(row.id),
    sourceName: row.source_name,
    status: row.status,
    pruneStale: row.prune_stale,
    maxPages: row.max_pages,
    maxArticles: row.max_articles,
    totalDiscovered: row.total_discovered,
    processedCount: row.processed_count,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    skippedExistingCount: row.skipped_existing_count,
    failedCount: row.failed_count,
    deletedStaleCount: row.deleted_stale_count,
    errorMessage: row.error_message,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    progressPercent
  };
};

const findActiveNewsbankRun = async () => {
  const row = await db("sync_runs")
    .where({ source_name: NEWSBANK_SOURCE_NAME, status: "running" })
    .orderBy("id", "desc")
    .first<SyncRunRow>();

  return row ?? null;
};

const recoverStaleNewsbankRun = async (run: SyncRunRow) => {
  if (activeNewsbankRunId === run.id) {
    return run;
  }

  const lastUpdate = new Date(run.updated_at ?? run.started_at).getTime();
  if (!Number.isFinite(lastUpdate)) {
    return run;
  }

  const staleAfterMs = NEWSBANK_STALE_RUN_MINUTES * 60 * 1000;
  const isStale = Date.now() - lastUpdate >= staleAfterMs;
  if (!isStale) {
    return run;
  }

  const staleMessage =
    run.error_message ??
    `Marked failed automatically: no sync progress for ${NEWSBANK_STALE_RUN_MINUTES} minutes.`;

  await db("sync_runs")
    .where({ id: run.id, status: "running" })
    .update({
      status: "failed",
      error_message: staleMessage,
      finished_at: db.fn.now(),
      updated_at: db.fn.now()
    });

  return null;
};

const findRecoverableActiveNewsbankRun = async () => {
  const active = await findActiveNewsbankRun();
  if (!active) return null;
  return recoverStaleNewsbankRun(active);
};

const findLatestNewsbankRun = async () => {
  const row = await db("sync_runs")
    .where({ source_name: NEWSBANK_SOURCE_NAME })
    .orderBy("id", "desc")
    .first<SyncRunRow>();

  return row ?? null;
};

export const resolvers: Resolvers = {
  Query: {
    searchArticles: async (_parent, args) => {
      const query = args.query.trim();

      if (!query) {
        return [];
      }

      const rows = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .modify(applyNonDuplicateFilter)
        .where((builder) => {
          builder
            .whereILike("articles.title", `%${query}%`)
            .orWhereILike("articles.snippet", `%${query}%`)
            .orWhereILike("articles.body_text", `%${query}%`);
        })
        .orderBy("articles.date", "desc")
        .orderBy("articles.id", "desc")
        .limit(50)
        .select<ArticleWithSourceRow[]>(
          "articles.id",
          "articles.title",
          "articles.date",
          "articles.url",
          "articles.snippet",
          "articles.source_id",
          "sources.name as source_name",
          "sources.url as source_url"
        );

      return rows.map(toGraphArticle);
    },
    searchColumns: async (_parent, args) => {
      const query = (args.query ?? "").trim();
      const tags = normalizeTags(args.tags ?? []);
      const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
      const offset = Math.max(0, args.offset ?? 0);

      const rows = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .modify(applyNonDuplicateFilter)
        .whereNotNull("articles.body_text")
        .whereRaw("length(articles.body_text) > 0")
        .modify((builder) => {
          if (!query) return;

          builder.andWhere((whereBuilder) => {
            whereBuilder
              .whereILike("articles.title", `%${query}%`)
              .orWhereILike("articles.snippet", `%${query}%`)
              .orWhereILike("articles.body_text", `%${query}%`)
              .orWhereRaw(
                "exists (select 1 from unnest(coalesce(articles.tags, ARRAY[]::text[])) as tag where tag ilike ?)",
                [`%${query}%`]
              );
          });
        })
        .modify((builder) => {
          for (const tag of tags) {
            builder.whereRaw(
              "exists (select 1 from unnest(coalesce(articles.tags, ARRAY[]::text[])) as tag where lower(tag) = lower(?))",
              [tag]
            );
          }
        })
        .orderBy("articles.date", "desc")
        .orderBy("articles.id", "desc")
        .limit(limit)
        .offset(offset)
        .select<ColumnWithSourceRow[]>(
          "articles.id",
          "articles.title",
          "articles.date",
          "articles.url",
          "articles.snippet",
          "articles.body_text",
          "articles.source_metadata",
          "articles.publication_name",
          "articles.byline",
          "articles.article_section",
          "articles.word_count",
          "articles.extraction_method",
          "articles.content_extracted_at",
          "articles.tags",
          "articles.source_id",
          "sources.name as source_name",
          "sources.url as source_url"
        );

      return rows.map(toGraphColumn);
    },
    searchColumnsPageForDate: async (_parent, args) => {
      const query = (args.query ?? "").trim();
      const tags = normalizeTags(args.tags ?? []);
      const pageSize = Math.max(1, Math.min(args.pageSize ?? 100, 500));

      const parsed = new Date(args.date);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid date. Use YYYY-MM-DD.");
      }

      const isoDate = parsed.toISOString().slice(0, 10);

      const result = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .modify(applyNonDuplicateFilter)
        .whereNotNull("articles.body_text")
        .whereRaw("length(articles.body_text) > 0")
        .modify((builder) => {
          if (!query) return;

          builder.andWhere((whereBuilder) => {
            whereBuilder
              .whereILike("articles.title", `%${query}%`)
              .orWhereILike("articles.snippet", `%${query}%`)
              .orWhereILike("articles.body_text", `%${query}%`)
              .orWhereRaw(
                "exists (select 1 from unnest(coalesce(articles.tags, ARRAY[]::text[])) as tag where tag ilike ?)",
                [`%${query}%`]
              );
          });
        })
        .modify((builder) => {
          for (const tag of tags) {
            builder.whereRaw(
              "exists (select 1 from unnest(coalesce(articles.tags, ARRAY[]::text[])) as tag where lower(tag) = lower(?))",
              [tag]
            );
          }
        })
        .whereRaw("articles.date > ?", [isoDate])
        .count<{ count: string }[]>("* as count")
        .first();

      const offset = Number(result?.count ?? 0);
      return Math.floor(offset / pageSize);
    },
    neighboringColumns: async (_parent, args) => {
      const limit = Math.max(3, Math.min(args.limit ?? 21, 51));

      const anchor = await db("articles")
        .modify(applyNonDuplicateFilter)
        .whereNotNull("articles.body_text")
        .whereRaw("length(articles.body_text) > 0")
        .where("articles.id", args.id)
        .first<{ id: number; date: Date | string }>("articles.id", "articles.date");

      if (!anchor) {
        return [];
      }

      const anchorDate = new Date(anchor.date).toISOString().slice(0, 10);

      const offsetResult = await db("articles")
        .modify(applyNonDuplicateFilter)
        .whereNotNull("articles.body_text")
        .whereRaw("length(articles.body_text) > 0")
        .andWhere((builder) => {
          builder
            .whereRaw("articles.date > ?", [anchorDate])
            .orWhere((sameDateBuilder) => {
              sameDateBuilder.whereRaw("articles.date = ?", [anchorDate]).andWhere("articles.id", ">", anchor.id);
            });
        })
        .count<{ count: string }[]>("* as count")
        .first();

      const offset = Number(offsetResult?.count ?? 0);
      const windowStart = Math.max(0, offset - Math.floor(limit / 2));

      const rows = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .modify(applyNonDuplicateFilter)
        .whereNotNull("articles.body_text")
        .whereRaw("length(articles.body_text) > 0")
        .orderBy("articles.date", "desc")
        .orderBy("articles.id", "desc")
        .limit(limit)
        .offset(windowStart)
        .select<ColumnWithSourceRow[]>(
          "articles.id",
          "articles.title",
          "articles.date",
          "articles.url",
          "articles.snippet",
          "articles.body_text",
          "articles.source_metadata",
          "articles.publication_name",
          "articles.byline",
          "articles.article_section",
          "articles.word_count",
          "articles.extraction_method",
          "articles.content_extracted_at",
          "articles.tags",
          "articles.source_id",
          "sources.name as source_name",
          "sources.url as source_url"
        );

      return rows.map(toGraphColumn);
    },
    column: async (_parent, args) => {
      const row = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .modify(applyNonDuplicateFilter)
        .where("articles.id", args.id)
        .first<ColumnWithSourceRow>(
          "articles.id",
          "articles.title",
          "articles.date",
          "articles.url",
          "articles.snippet",
          "articles.body_text",
          "articles.source_metadata",
          "articles.publication_name",
          "articles.byline",
          "articles.article_section",
          "articles.word_count",
          "articles.extraction_method",
          "articles.content_extracted_at",
          "articles.tags",
          "articles.source_id",
          "sources.name as source_name",
          "sources.url as source_url"
        );

      if (!row) return null;

      return toGraphColumn(row);
    },
    newsbankRequestConfig: async () => {
      const row = await db("newsbank_request_configs")
        .where({ key: NEWSBANK_CONFIG_KEY })
        .first<UpsertedNewsbankConfigRow>();

      if (!row) return null;

      return toGraphConfig(row);
    },
    newsbankSyncStatus: async () => {
      const [activeRun, latestRun] = await Promise.all([findRecoverableActiveNewsbankRun(), findLatestNewsbankRun()]);

      return {
        isRunning: Boolean(activeRun),
        activeRun: activeRun ? toGraphSyncRun(activeRun) : null,
        latestRun: latestRun ? toGraphSyncRun(latestRun) : null
      };
    }
  },
  Mutation: {
    saveNewsbankRequestConfig: async (_parent, args) => {
      const parsed = parseCurlRequest(args.curl);
      const changeset = {
        key: NEWSBANK_CONFIG_KEY,
        curl_text: parsed.rawCurl,
        request_url: parsed.requestUrl,
        method: parsed.method,
        cookie_header: parsed.cookieHeader,
        headers_json: parsed.headers,
        body_text: parsed.body,
        updated_at: db.fn.now()
      };

      const [row] = await db("newsbank_request_configs")
        .insert(changeset)
        .onConflict("key")
        .merge(changeset)
        .returning("*");

      return toGraphConfig(row as UpsertedNewsbankConfigRow);
    },
    startNewsbankSync: async (_parent, args) => {
      const existing = await findRecoverableActiveNewsbankRun();
      if (existing) {
        return toGraphSyncRun(existing);
      }

      const pruneStale = args.pruneStale ?? false;
      const maxPages = args.maxPages ?? null;
      const maxArticles = args.maxArticles ?? null;

      const [created] = await db("sync_runs")
        .insert({
          source_name: NEWSBANK_SOURCE_NAME,
          status: "running",
          prune_stale: pruneStale,
          max_pages: maxPages,
          max_articles: maxArticles,
          total_discovered: 0,
          processed_count: 0,
          inserted_count: 0,
          updated_count: 0,
          skipped_existing_count: 0,
          failed_count: 0,
          deleted_stale_count: 0,
          started_at: db.fn.now(),
          updated_at: db.fn.now()
        })
        .returning<SyncRunRow[]>("*");

      activeNewsbankRunId = created.id;

      void runNewsbankSync({
        maxPages: maxPages ?? undefined,
        maxArticles: maxArticles ?? undefined,
        pruneStale,
        onProgress: async (progress) => {
          if (!activeNewsbankRunId) return;

          await db("sync_runs")
            .where({ id: activeNewsbankRunId })
            .update({
              total_discovered: progress.discovered,
              processed_count: progress.processed,
              inserted_count: progress.inserted,
              updated_count: progress.updated,
              skipped_existing_count: progress.skippedExisting,
              failed_count: progress.failed,
              deleted_stale_count: progress.deletedStale,
              updated_at: db.fn.now()
            });
        }
      })
        .then(async (result) => {
          if (!activeNewsbankRunId) return;

          await db("sync_runs")
            .where({ id: activeNewsbankRunId })
            .update({
              status: "completed",
              total_discovered: result.discovered,
              processed_count: result.processed,
              inserted_count: result.inserted,
              updated_count: result.updated,
              skipped_existing_count: result.skippedExisting,
              failed_count: result.failed,
              deleted_stale_count: result.deletedStale,
              finished_at: db.fn.now(),
              updated_at: db.fn.now()
            });

          activeNewsbankRunId = null;
        })
        .catch(async (error) => {
          if (!activeNewsbankRunId) return;

          await db("sync_runs")
            .where({ id: activeNewsbankRunId })
            .update({
              status: "failed",
              error_message: error instanceof Error ? error.message : String(error),
              finished_at: db.fn.now(),
              updated_at: db.fn.now()
            });

          activeNewsbankRunId = null;
        });

      return toGraphSyncRun(created);
    },
    updateColumnTitle: async (_parent, args) => {
      const title = args.title.trim();
      if (!title) {
        throw new Error("Title cannot be empty.");
      }

      const [updatedRow] = await db("articles")
        .where({ id: args.id })
        .update({
          title,
          updated_at: db.fn.now()
        })
        .returning<{ id: number }[]>("id");

      if (!updatedRow) {
        throw new Error("Column not found.");
      }

      const row = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .where("articles.id", updatedRow.id)
        .first<ColumnWithSourceRow>(
          "articles.id",
          "articles.title",
          "articles.date",
          "articles.url",
          "articles.snippet",
          "articles.body_text",
          "articles.source_metadata",
          "articles.publication_name",
          "articles.byline",
          "articles.article_section",
          "articles.word_count",
          "articles.extraction_method",
          "articles.content_extracted_at",
          "articles.tags",
          "articles.source_id",
          "sources.name as source_name",
          "sources.url as source_url"
        );

      if (!row) {
        throw new Error("Column not found.");
      }

      return toGraphColumn(row);
    },
    updateColumnTags: async (_parent, args) => {
      const tags = normalizeTags(args.tags);

      const [updatedRow] = await db("articles")
        .where({ id: args.id })
        .update({
          tags,
          updated_at: db.fn.now()
        })
        .returning<{ id: number }[]>("id");

      if (!updatedRow) {
        throw new Error("Column not found.");
      }

      const row = await db("articles")
        .join("sources", "sources.id", "articles.source_id")
        .where("articles.id", updatedRow.id)
        .first<ColumnWithSourceRow>(
          "articles.id",
          "articles.title",
          "articles.date",
          "articles.url",
          "articles.snippet",
          "articles.body_text",
          "articles.source_metadata",
          "articles.publication_name",
          "articles.byline",
          "articles.article_section",
          "articles.word_count",
          "articles.extraction_method",
          "articles.content_extracted_at",
          "articles.tags",
          "articles.source_id",
          "sources.name as source_name",
          "sources.url as source_url"
        );

      if (!row) {
        throw new Error("Column not found.");
      }

      return toGraphColumn(row);
    },
    markColumnDuplicate: async (_parent, args) => {
      const [updatedRow] = await db("articles")
        .where({ id: args.id })
        .update({
          is_newsbank_duplicate: true,
          updated_at: db.fn.now()
        })
        .returning<{ id: number }[]>("id");

      return Boolean(updatedRow);
    }
  }
};
