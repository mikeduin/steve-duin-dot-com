import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import db from "../db/knex.js";
import { loadNewsbankRequestConfig } from "../newsbank/config.js";

const getEnv = (key: string, fallback?: string) => process.env[key] ?? fallback ?? "";

const NEWSBANK_SOURCE_NAME = getEnv("NEWSBANK_SOURCE_NAME", "NewsBank");
const NEWSBANK_SOURCE_URL = getEnv("NEWSBANK_SOURCE_URL", "https://infoweb.newsbank.com");
const NEWSBANK_ONE_DOCREF = getEnv("NEWSBANK_ONE_DOCREF", "");
const NEWSBANK_ONE_URL = getEnv("NEWSBANK_ONE_URL", "");
const NEWSBANK_DEBUG_SNAPSHOTS = getEnv("NEWSBANK_DEBUG_SNAPSHOTS", "false") === "true";

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

const GENERIC_TITLE_PATTERNS = [
  /^america'?s news\s*\|\s*document view/i,
  /^document view\s*:/i,
  /in\s+author\/byline\b/i
];

const looksLikeBlockedOrChromeContent = (text: string | null | undefined) => {
  if (!text) return false;
  return BAD_BODY_PATTERNS.some((pattern) => pattern.test(text));
};

const isGenericContainerTitle = (title: string | null | undefined) => {
  if (!title) return true;
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(title));
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

const maybeSaveSnapshot = async (name: string, content: string) => {
  if (!NEWSBANK_DEBUG_SNAPSHOTS) return;

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

const extractArticleTitle = (html: string) => {
  const template = extractTemplateParams(html);
  if (template?.title) {
    const cleanedTemplateTitle = cleanText(template.title);
    if (!isGenericContainerTitle(cleanedTemplateTitle)) {
      return cleanedTemplateTitle;
    }
  }

  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (ogTitle?.[1]) {
    const cleanedOgTitle = cleanText(ogTitle[1]);
    if (!isGenericContainerTitle(cleanedOgTitle)) {
      return cleanedOgTitle;
    }
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    const cleanedH1 = cleanText(h1[1]);
    if (!isGenericContainerTitle(cleanedH1)) {
      return cleanedH1;
    }
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const cleanedTitle = cleanText(titleMatch[1]);
    if (!isGenericContainerTitle(cleanedTitle)) {
      return cleanedTitle;
    }
  }

  return "Untitled";
};

const extractArticleContent = (html: string) => {
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
        bodyText: normalizedBodyText,
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
        bodyText: cleaned,
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
        bodyText: cleaned,
        method: "class-body"
      };
    }
  }

  const articleSection = html.match(/<(?:article|main|section)[^>]*>([\s\S]*?)<\/(?:article|main|section)>/i);
  if (articleSection?.[1]) {
    const text = cleanText(articleSection[1]);
    if (text.length > 120 && !looksLikeBlockedOrChromeContent(text)) {
      return {
        bodyText: text,
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
        bodyText: null,
        method: "blocked-content"
      };
    }

    return {
      bodyText: joined,
      method: "paragraph-fallback"
    };
  }

  return {
    bodyText: null,
    method: "none"
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

const resolveArticleUrl = (docrefOrUrl: string, fallbackUrl?: string | null) => {
  if (docrefOrUrl.startsWith("http://") || docrefOrUrl.startsWith("https://")) {
    return docrefOrUrl;
  }

  const docref = docrefOrUrl.startsWith("news/") ? docrefOrUrl : `news/${docrefOrUrl}`;

  if (fallbackUrl) {
    const url = new URL(fallbackUrl);
    url.searchParams.set("docref", docref);
    return url.toString();
  }

  const url = new URL("/apps/news/document-view", NEWSBANK_SOURCE_URL);
  url.searchParams.set("p", "NewsBank");
  url.searchParams.set("docref", docref);
  return url.toString();
};

const run = async () => {
  const config = await loadNewsbankRequestConfig();
  if (!config?.cookieHeader) {
    throw new Error(
      "No saved NewsBank cookie config found. Save a cURL command in Admin Portal before running this scraper."
    );
  }

  const targetInput = NEWSBANK_ONE_URL || NEWSBANK_ONE_DOCREF;
  if (!targetInput) {
    throw new Error("Set NEWSBANK_ONE_DOCREF (or NEWSBANK_ONE_URL) in api/.env to extract one article.");
  }

  const referer = config.headers.referer;
  const articleUrl = resolveArticleUrl(targetInput, referer && referer.includes("/document-view") ? referer : null);

  const headers = filterForwardHeaders(config.headers);
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "cookie")) {
    headers.Cookie = config.cookieHeader;
  }

  const sourceId = await upsertSource();

  const response = await fetch(articleUrl, {
    method: "GET",
    headers: {
      ...headers,
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch article ${articleUrl}: ${response.status}`);
  }

  const html = await response.text();
  await maybeSaveSnapshot("article-single.html", html);

  const title = extractArticleTitle(html);
  const date = extractArticleDate(html);
  const extracted = extractArticleContent(html);
  const metadata = extractArticleMetadata(html);
  const snippet = extracted.bodyText ? extracted.bodyText.slice(0, 280) : null;

  await db("articles")
    .insert({
      source_id: sourceId,
      title,
      date,
      url: articleUrl,
      snippet,
      body_text: extracted.bodyText,
      source_metadata: metadata.sourceMetadata,
      publication_name: metadata.publicationName,
      byline: metadata.byline,
      article_section: metadata.articleSection,
      word_count: metadata.wordCount,
      extraction_method: extracted.method,
      content_extracted_at: extracted.bodyText ? db.fn.now() : null,
      ocr_url: null
    })
    .onConflict(["source_id", "url"])
    .merge({
      title: db.raw("excluded.title"),
      date: db.raw("excluded.date"),
      snippet: db.raw("excluded.snippet"),
      body_text: db.raw("coalesce(excluded.body_text, articles.body_text)"),
      source_metadata: db.raw("coalesce(excluded.source_metadata, articles.source_metadata)"),
      publication_name: db.raw("coalesce(excluded.publication_name, articles.publication_name)"),
      byline: db.raw("coalesce(excluded.byline, articles.byline)"),
      article_section: db.raw("coalesce(excluded.article_section, articles.article_section)"),
      word_count: db.raw("coalesce(excluded.word_count, articles.word_count)"),
      extraction_method: db.raw("excluded.extraction_method"),
      content_extracted_at: db.raw("coalesce(excluded.content_extracted_at, articles.content_extracted_at)"),
      updated_at: db.fn.now()
    });

  console.log(`Saved single article. URL: ${articleUrl}`);
  console.log(`Extraction method: ${extracted.method}`);
  console.log(`Body length: ${extracted.bodyText ? extracted.bodyText.length : 0}`);

  await db.destroy();
};

run().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
