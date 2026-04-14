import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import db from "../db/knex.js";
import { loadNewsbankRequestConfig } from "../newsbank/config.js";

type NewsbankResultEntry = {
  url: string;
  title: string;
};

type NewsbankArticle = {
  url: string;
  externalKey: string;
  title: string;
  date: string;
  snippet: string | null;
  content: string | null;
  sourceMetadata: string | null;
  publicationName: string | null;
  byline: string | null;
  articleSection: string | null;
  wordCount: number | null;
  extractionMethod: string;
};

export type NewsbankSyncProgress = {
  discovered: number;
  processed: number;
  inserted: number;
  updated: number;
  skippedExisting: number;
  failed: number;
  deletedStale: number;
};

export type NewsbankSyncOptions = {
  resultsUrl?: string;
  maxPages?: number;
  maxArticles?: number;
  pruneStale?: boolean;
  debugSnapshots?: boolean;
  outputFile?: string;
  onProgress?: (progress: NewsbankSyncProgress) => Promise<void> | void;
};

export type NewsbankSyncResult = NewsbankSyncProgress;

const getEnv = (key: string, fallback?: string) => process.env[key] ?? fallback ?? "";

const parsePositiveInt = (raw: string | null | undefined) => {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
};

const NEWSBANK_SOURCE_NAME = getEnv("NEWSBANK_SOURCE_NAME", "NewsBank");
const NEWSBANK_SOURCE_URL = getEnv("NEWSBANK_SOURCE_URL", "https://infoweb.newsbank.com");
const NEWSBANK_RESULTS_URL = getEnv(
  "NEWSBANK_RESULTS_URL",
  "https://infoweb.newsbank.com/apps/news/results?p=NewsBank&t=&sort=YMD_date%3AD&hide_duplicates=2&maxresults=60&f=advanced&val-base-0=steve%20duin&fld-base-0=Author"
);
const NEWSBANK_MAX_PAGES = parsePositiveInt(getEnv("NEWSBANK_MAX_PAGES"));
const NEWSBANK_MAX_ARTICLES = parsePositiveInt(getEnv("NEWSBANK_MAX_ARTICLES"));
const NEWSBANK_DEBUG_SNAPSHOTS = getEnv("NEWSBANK_DEBUG_SNAPSHOTS", "false") === "true";
const NEWSBANK_OUTPUT_FILE = getEnv("NEWSBANK_OUTPUT_FILE", ".tmp/newsbank-articles.ndjson");

const isResultsUrl = (value: string | null | undefined) => {
  if (!value) return false;
  return value.includes("/apps/news/results");
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number(digits)));

const cleanText = (value: string) => decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

const normalizeMetadataValue = (value: string | null | undefined) => {
  if (!value) return null;
  const normalized = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};

const parseWordCount = (value: string | null | undefined) => {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/(\d{2,6})\s*words?/i);
  if (!match?.[1]) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const BAD_BODY_PATTERNS = [
  /status message/i,
  /error code\s*:?\s*1015/i,
  /a problem has occurred while loading the document/i,
  /a problem has occured while loading the document/i,
  /article made available by/i,
  /our generous donors/i
];

const GENERIC_TITLE_PATTERNS = [/^america'?s news\s*\|\s*document view/i, /^document view\s*:/i, /in\s+author\/byline\b/i];

const NEWSBANK_TITLE_SUFFIX_PATTERN =
  /\s+-\s+[^-]+:\s+Web\s+Edition\s+Articles\s*\([^)]*\)\s+-\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+-\s+page\s+\d+\s*$/i;

const looksLikeBlockedOrChromeContent = (text: string | null | undefined) => {
  if (!text) return false;
  return BAD_BODY_PATTERNS.some((pattern) => pattern.test(text));
};

const isGenericContainerTitle = (title: string | null | undefined) => {
  if (!title) return true;
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(title));
};

const normalizeHeadlineCandidate = (title: string | null | undefined) => {
  if (!title) return null;

  const cleaned = cleanText(title);
  if (!cleaned || isGenericContainerTitle(cleaned)) {
    return null;
  }

  // NewsBank sometimes appends publication/date/page chrome to title-like strings.
  const withoutSuffix = cleaned.replace(NEWSBANK_TITLE_SUFFIX_PATTERN, "").trim();
  return withoutSuffix || cleaned;
};

const normalizeDate = (input: string | null) => {
  if (!input) return new Date().toISOString().slice(0, 10);

  const short = input.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(short)) {
    return short;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
};

const filterForwardHeaders = (headers: Record<string, string>) => {
  const blocked = new Set([
    "authority",
    "host",
    "content-length",
    "connection",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform"
  ]);

  return Object.entries(headers).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (!blocked.has(key.toLowerCase())) {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
};

const maybeSaveSnapshot = async (enabled: boolean, name: string, content: string) => {
  if (!enabled) return;

  const outputDir = path.resolve(process.cwd(), ".tmp/newsbank-debug");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, name), content, "utf8");
};

const extractDrupalSettingsPayload = (html: string) => {
  const marker = "jQuery.extend(Drupal.settings,";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  const objectStart = html.indexOf("{", markerIndex + marker.length);
  if (objectStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const jsonSlice = html.slice(objectStart, index + 1);
        try {
          return JSON.parse(jsonSlice) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
};

const extractTemplateParams = (html: string) => {
  const settings = extractDrupalSettingsPayload(html) as
    | {
        nbcore_pdf?: {
          "nbcore-pdf-ascii-bar"?: {
            template_params?: {
              title?: string;
              body?: string;
              metadata?: Record<string, unknown>;
            };
          };
        };
      }
    | null;

  return settings?.nbcore_pdf?.["nbcore-pdf-ascii-bar"]?.template_params ?? null;
};

const readTemplateMetadataField = (
  metadata: Record<string, unknown> | null,
  keys: string[]
) => {
  if (!metadata) return null;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string") {
      const normalized = normalizeMetadataValue(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
};

const extractArticleMetadata = (html: string) => {
  const template = extractTemplateParams(html);
  const templateMetadata =
    template?.metadata && typeof template.metadata === "object"
      ? (template.metadata as Record<string, unknown>)
      : null;

  const fullText = cleanText(html);
  const rawMetadataMatch = fullText.match(
    /([A-Za-z]+\s+\d{1,2},\s+\d{4}\s*\|\s*[^]+?(?:\d{2,6}\s+Words?))/i
  );
  const sourceMetadata =
    normalizeMetadataValue(rawMetadataMatch?.[1]) ??
    (templateMetadata ? normalizeMetadataValue(JSON.stringify(templateMetadata)) : null);

  const publicationFromBlock = sourceMetadata
    ? sourceMetadata.match(
        /[A-Za-z]+\s+\d{1,2},\s+\d{4}\s*\|\s*(.+?)(?:\s+Author\/Byline:|\s+\|\s*Section:|\s+\d{2,6}\s+Words?\b|$)/i
      )?.[1]
    : null;
  const bylineFromBlock = sourceMetadata
    ? sourceMetadata.match(/Author\/Byline:\s*([^|]+?)(?:\s+\|\s*Section:|\s+\d{2,6}\s+Words?\b|$)/i)?.[1]
    : null;
  const sectionFromBlock = sourceMetadata
    ? sourceMetadata.match(/Section:\s*([^|]+?)(?:\s+\d{2,6}\s+Words?\b|$)/i)?.[1]
    : null;

  const publicationName =
    normalizeMetadataValue(publicationFromBlock) ??
    readTemplateMetadataField(templateMetadata, ["publication", "publication_name", "source", "newspaper"]);
  const byline =
    normalizeMetadataValue(bylineFromBlock) ??
    readTemplateMetadataField(templateMetadata, ["author_byline", "byline", "author", "author_name"]);
  const articleSection =
    normalizeMetadataValue(sectionFromBlock) ??
    readTemplateMetadataField(templateMetadata, ["section", "article_section", "desk", "category"]);
  const wordCount =
    parseWordCount(sourceMetadata) ??
    parseWordCount(readTemplateMetadataField(templateMetadata, ["word_count", "words", "wordcount"]));

  return {
    sourceMetadata,
    publicationName,
    byline,
    articleSection,
    wordCount
  };
};

const upsertSource = async () => {
  const existing = await db("sources").where({ name: NEWSBANK_SOURCE_NAME }).first<{ id: number }>();

  if (existing) {
    await db("sources").where({ id: existing.id }).update({
      url: NEWSBANK_SOURCE_URL,
      updated_at: db.fn.now()
    });
    return existing.id;
  }

  const inserted = (await db("sources")
    .insert({ name: NEWSBANK_SOURCE_NAME, url: NEWSBANK_SOURCE_URL, lccn: null })
    .returning(["id"])) as Array<{ id: number }>;

  return inserted[0].id;
};

const extractResults = (html: string, baseUrl: URL) => {
  const matches = [...html.matchAll(/<a[^>]+href=["']([^"']*\/apps\/news\/document-view[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  const unique = new Map<string, NewsbankResultEntry>();
  for (const match of matches) {
    const rawUrl = decodeHtmlEntities(match[1]);
    const rawTitle = cleanText(match[2]);
    const resolvedUrl = new URL(rawUrl, baseUrl).toString();

    if (!rawTitle) continue;
    if (!unique.has(resolvedUrl)) {
      unique.set(resolvedUrl, {
        url: resolvedUrl,
        title: rawTitle
      });
    }
  }

  return [...unique.values()];
};

const extractNextPageUrl = (html: string, currentPageUrl: URL) => {
  const relNext = html.match(/<a[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i);
  if (relNext?.[1]) {
    return new URL(relNext[1], currentPageUrl).toString();
  }

  const textNext = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:Next|Next page|›|&gt;)\s*<\/a>/i);
  if (textNext?.[1]) {
    return new URL(textNext[1], currentPageUrl).toString();
  }

  return null;
};

const extractNextArticleUrl = (html: string, currentArticleUrl: string) => {
  const nextMatch = html.match(
    /<a[^>]+href=["']([^"']*\/apps\/news\/document-view[^"']+)["'][^>]*(?:title=["']Next Search Result["']|class=["'][^"']*nbcore-doc-nav__next_link[^"']*["'])[^>]*>/i
  );

  if (!nextMatch?.[1]) {
    return null;
  }

  try {
    return new URL(decodeHtmlEntities(nextMatch[1]), currentArticleUrl).toString();
  } catch {
    return null;
  }
};

const extractArticleBody = (html: string) => {
  const template = extractTemplateParams(html);
  if (template?.body) {
    const normalizedBodyHtml = template.body
      .replace(/\\\//g, "/")
      .replace(/\\u003C/gi, "<")
      .replace(/\\u003E/gi, ">")
      .replace(/\\u0026/gi, "&");

    const normalizedBodyText = decodeHtmlEntities(
      normalizedBodyHtml
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>\s*<p>/gi, "\n\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );

    if (normalizedBodyText && !looksLikeBlockedOrChromeContent(normalizedBodyText)) {
      return {
        text: normalizedBodyText,
        method: "drupal-template-body"
      };
    }
  }

  const jsonLdBody = html.match(/"articleBody"\s*:\s*"([\s\S]*?)"\s*[,}]/i);
  if (jsonLdBody?.[1]) {
    const candidate = jsonLdBody[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\"/g, '"');

    const cleaned = cleanText(candidate);
    if (!looksLikeBlockedOrChromeContent(cleaned)) {
      return {
        text: cleaned,
        method: "jsonld"
      };
    }
  }

  const textBlock = html.match(
    /<div[^>]+class=["'][^"']*(?:doc-body|article-text|story-body|full-text|document-view__body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  if (textBlock?.[1]) {
    const cleaned = cleanText(textBlock[1]);
    if (!looksLikeBlockedOrChromeContent(cleaned)) {
      return {
        text: cleaned,
        method: "class-body"
      };
    }
  }

  const articleSection = html.match(/<(?:article|main|section)[^>]*>([\s\S]*?)<\/(?:article|main|section)>/i);
  if (articleSection?.[1]) {
    const text = cleanText(articleSection[1]);
    if (text.length > 120 && !looksLikeBlockedOrChromeContent(text)) {
      return {
        text,
        method: "semantic-section"
      };
    }
  }

  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(match[1]))
    .filter((value) => value.length > 60);

  if (paragraphs.length >= 3) {
    const joined = paragraphs.join("\n\n");
    if (looksLikeBlockedOrChromeContent(joined)) {
      return {
        text: null,
        method: "blocked-content"
      };
    }

    return {
      text: joined,
      method: "paragraph-fallback"
    };
  }

  return {
    text: null,
    method: "none"
  };
};

const extractArticleDate = (html: string) => {
  const template = extractTemplateParams(html);
  const templateDateDisplay =
    template?.metadata && typeof template.metadata.date_display === "string"
      ? template.metadata.date_display
      : null;
  if (templateDateDisplay) {
    return normalizeDate(templateDateDisplay);
  }

  const metaMatch = html.match(
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|date|dc.date|publish-date)["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  if (metaMatch?.[1]) {
    return normalizeDate(metaMatch[1]);
  }

  const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
  if (timeMatch?.[1]) {
    return normalizeDate(timeMatch[1]);
  }

  return normalizeDate(null);
};

const extractArticleTitle = (html: string, fallback: string) => {
  const jsonLdHeadline = html.match(/"headline"\s*:\s*"([\s\S]*?)"\s*[,}]/i);
  if (jsonLdHeadline?.[1]) {
    const cleanedJsonHeadline = normalizeHeadlineCandidate(
      jsonLdHeadline[1]
        .replace(/\\n/g, " ")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\"/g, '"')
    );
    if (cleanedJsonHeadline) {
      return cleanedJsonHeadline;
    }
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    const cleanedH1 = normalizeHeadlineCandidate(h1[1]);
    if (cleanedH1) {
      return cleanedH1;
    }
  }

  const citationTitle = html.match(
    /<meta[^>]+(?:name|property)=["'](?:citation_title|dc.title|twitter:title)["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  if (citationTitle?.[1]) {
    const cleanedCitationTitle = normalizeHeadlineCandidate(citationTitle[1]);
    if (cleanedCitationTitle) {
      return cleanedCitationTitle;
    }
  }

  const template = extractTemplateParams(html);
  if (template?.title) {
    const cleanedTemplateTitle = normalizeHeadlineCandidate(template.title);
    if (cleanedTemplateTitle) {
      return cleanedTemplateTitle;
    }
  }

  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (ogTitle?.[1]) {
    const cleanedOgTitle = normalizeHeadlineCandidate(ogTitle[1]);
    if (cleanedOgTitle) {
      return cleanedOgTitle;
    }
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const cleanedTitle = normalizeHeadlineCandidate(titleMatch[1]);
    if (cleanedTitle) {
      return cleanedTitle;
    }
  }

  const cleanedFallback = normalizeHeadlineCandidate(fallback);
  if (cleanedFallback) {
    return cleanedFallback;
  }

  return "Untitled";
};

const extractNewsbankExternalKey = (url: string) => {
  try {
    const parsed = new URL(url);
    const rawDocref = parsed.searchParams.get("docref");
    if (!rawDocref) {
      return `newsbank:url:${parsed.toString()}`;
    }

    const decodedDocref = decodeURIComponent(rawDocref).trim();
    return `newsbank:docref:${decodedDocref}`;
  } catch {
    return `newsbank:url:${url}`;
  }
};

const appendOutput = async (outputFile: string, article: NewsbankArticle) => {
  const outputPath = path.resolve(process.cwd(), outputFile);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.appendFile(outputPath, `${JSON.stringify(article)}\n`, "utf8");
};

const upsertArticleSummary = async (sourceId: number, article: NewsbankArticle) => {
  const existing = await db("articles")
    .where({ source_id: sourceId })
    .andWhere((builder) => {
      builder.where({ external_key: article.externalKey }).orWhere({ url: article.url });
    })
    .first<{ id: number }>("id");

  if (!existing) {
    await db("articles").insert({
      source_id: sourceId,
      external_key: article.externalKey,
      title: article.title,
      date: article.date,
      url: article.url,
      snippet: article.snippet,
      body_text: article.content,
      source_metadata: article.sourceMetadata,
      publication_name: article.publicationName,
      byline: article.byline,
      article_section: article.articleSection,
      word_count: article.wordCount,
      extraction_method: article.extractionMethod,
      content_extracted_at: article.content ? db.fn.now() : null,
      ocr_url: null,
      updated_at: db.fn.now()
    });

    return { inserted: 1, updated: 0 };
  }

  return { inserted: 0, updated: 0 };
};

const pruneStaleArticles = async (sourceId: number, keepExternalKeys: string[]) => {
  if (keepExternalKeys.length === 0) {
    return 0;
  }

  const rows = await db("articles")
    .where({ source_id: sourceId })
    .whereNotIn("external_key", keepExternalKeys)
    .delete()
    .returning("id");

  return rows.length;
};

export const runNewsbankSync = async (options: NewsbankSyncOptions = {}): Promise<NewsbankSyncResult> => {
  const maxPages = options.maxPages ?? NEWSBANK_MAX_PAGES ?? Number.POSITIVE_INFINITY;
  const maxArticles = options.maxArticles ?? NEWSBANK_MAX_ARTICLES ?? Number.POSITIVE_INFINITY;
  const resultsUrl = options.resultsUrl ?? NEWSBANK_RESULTS_URL;
  const outputFile = options.outputFile ?? NEWSBANK_OUTPUT_FILE;
  const debugSnapshots = options.debugSnapshots ?? NEWSBANK_DEBUG_SNAPSHOTS;
  const pruneStale = options.pruneStale ?? true;

  const emitProgress = async (progress: NewsbankSyncProgress) => {
    if (options.onProgress) {
      await options.onProgress(progress);
    }
  };

  const progress: NewsbankSyncProgress = {
    discovered: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    skippedExisting: 0,
    failed: 0,
    deletedStale: 0
  };

  const config = await loadNewsbankRequestConfig();
  if (!config?.cookieHeader) {
    throw new Error(
      "No saved NewsBank cookie config found. Save a cURL command in Admin Portal before running this scraper."
    );
  }

  const baseHeaders = filterForwardHeaders(config.headers);
  if (!Object.keys(baseHeaders).some((key) => key.toLowerCase() === "cookie")) {
    baseHeaders.Cookie = config.cookieHeader;
  }

  const sourceId = await upsertSource();
  const existingExternalKeys = new Set(
    await db("articles").where({ source_id: sourceId }).whereNotNull("external_key").pluck<string[]>("external_key")
  );
  const visitedResultsPages = new Set<string>();
  const queuedArticleUrls = new Set<string>();
  const discoveredExternalKeys = new Set<string>();
  const queue: NewsbankResultEntry[] = [];

  let pageUrl: string | null = isResultsUrl(config.requestUrl) ? config.requestUrl : resultsUrl;
  let pageCount = 0;

  while (pageUrl && pageCount < maxPages) {
    if (visitedResultsPages.has(pageUrl)) break;
    visitedResultsPages.add(pageUrl);

    const response = await fetch(pageUrl, {
      method: "GET",
      headers: baseHeaders
    });

    if (!response.ok) {
      throw new Error(`NewsBank results request failed for ${pageUrl}: ${response.status}`);
    }

    const html = await response.text();
    pageCount += 1;
    await maybeSaveSnapshot(debugSnapshots, `results-page-${pageCount}.html`, html);

    const entries = extractResults(html, new URL(pageUrl));
    for (const entry of entries) {
      if (queuedArticleUrls.has(entry.url)) continue;

      const externalKey = extractNewsbankExternalKey(entry.url);
      discoveredExternalKeys.add(externalKey);
      if (!pruneStale && existingExternalKeys.has(externalKey)) {
        progress.skippedExisting += 1;
        continue;
      }

      queuedArticleUrls.add(entry.url);
      queue.push(entry);
      if (queue.length >= maxArticles) break;
    }

    progress.discovered = queue.length;
    await emitProgress(progress);

    if (queue.length >= maxArticles) break;

    pageUrl = extractNextPageUrl(html, new URL(pageUrl));
  }

  const exhaustedResultsPages = pageUrl === null;
  const hitResultsLimit = !exhaustedResultsPages && pageCount >= maxPages;
  const hitArticleLimitDuringDiscovery = queue.length >= maxArticles;

  let cursor = 0;
  while (cursor < queue.length && progress.processed < maxArticles) {
    const entry = queue[cursor];
    cursor += 1;

    const externalKey = extractNewsbankExternalKey(entry.url);
    discoveredExternalKeys.add(externalKey);
    const articleAlreadyExists = existingExternalKeys.has(externalKey);
    if (articleAlreadyExists && !pruneStale) {
      progress.skippedExisting += 1;
      progress.processed += 1;
      if (progress.processed % 5 === 0 || progress.processed === maxArticles || progress.processed === queue.length) {
        await emitProgress(progress);
      }
      continue;
    }

    const response = await fetch(entry.url, {
      method: "GET",
      headers: {
        ...baseHeaders,
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      progress.failed += 1;
      await emitProgress(progress);
      continue;
    }

    const html = await response.text();
    if (progress.processed === 0) {
      await maybeSaveSnapshot(debugSnapshots, "article-sample-1.html", html);
    }

    const nextArticleUrl = extractNextArticleUrl(html, entry.url);
    if (nextArticleUrl && !queuedArticleUrls.has(nextArticleUrl) && queue.length < maxArticles) {
      queuedArticleUrls.add(nextArticleUrl);
      queue.push({
        url: nextArticleUrl,
        title: ""
      });
      progress.discovered = queue.length;
    }

    if (articleAlreadyExists) {
      progress.skippedExisting += 1;
      progress.processed += 1;
      if (progress.processed % 5 === 0 || progress.processed === maxArticles || progress.processed === queue.length) {
        await emitProgress(progress);
      }
      continue;
    }

    const extracted = extractArticleBody(html);
    const metadata = extractArticleMetadata(html);
    const title = extractArticleTitle(html, entry.title);
    const date = extractArticleDate(html);
    const snippet = extracted.text ? extracted.text.slice(0, 280) : null;

    const article: NewsbankArticle = {
      url: entry.url,
      externalKey,
      title,
      date,
      snippet,
      content: extracted.text,
      sourceMetadata: metadata.sourceMetadata,
      publicationName: metadata.publicationName,
      byline: metadata.byline,
      articleSection: metadata.articleSection,
      wordCount: metadata.wordCount,
      extractionMethod: extracted.method
    };

    const writeResult = await upsertArticleSummary(sourceId, article);
    progress.inserted += writeResult.inserted;
    progress.updated += writeResult.updated;
    existingExternalKeys.add(externalKey);

    await appendOutput(outputFile, article);

    progress.processed += 1;
    if (progress.processed % 5 === 0 || progress.processed === maxArticles || progress.processed === queue.length) {
      await emitProgress(progress);
    }
  }

  const hitArticleLimitDuringProcessing = progress.processed >= maxArticles;
  const isLikelyCompleteCrawl =
    exhaustedResultsPages &&
    !hitResultsLimit &&
    !hitArticleLimitDuringDiscovery &&
    !hitArticleLimitDuringProcessing &&
    progress.processed >= progress.discovered;

  // Safety guard: never prune on a partial crawl (page/article-limited runs).
  if (pruneStale && isLikelyCompleteCrawl) {
    progress.deletedStale = await pruneStaleArticles(sourceId, Array.from(discoveredExternalKeys));
    await emitProgress(progress);
  }

  return progress;
};
