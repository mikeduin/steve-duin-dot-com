import "dotenv/config";
import db from "../db/knex.js";

const BASE_URL = "https://oregonnews.uoregon.edu/search/pages/results/";

type OdnpItem = {
  id?: string;
  title?: string;
  date?: string;
  url?: string;
  snippet?: string;
  ocr?: string;
  ocr_url?: string;
  ocr_eng?: string;
  page?: string | number;
};

type OdnpResponse = {
  items?: OdnpItem[];
  totalItems?: number;
};

const getEnv = (key: string, fallback?: string) =>
  process.env[key] ?? fallback ?? "";

const toDateString = (value?: string) => {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const fetchPage = async (params: Record<string, string | number>) => {
  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ODNP request failed: ${response.status}`);
  }

  return (await response.json()) as OdnpResponse;
};

const upsertSource = async () => {
  const name = getEnv("ODNP_SOURCE_NAME", "The Oregonian");
  const url = getEnv("ODNP_SOURCE_URL", "https://www.oregonlive.com");
   const lccn = getEnv("ODNP_LCCN", "").trim(); // Make LCCN optional

   if (lccn) {
     const existing = await db("sources").where({ lccn }).first();
     if (existing) {
       await db("sources").where({ id: existing.id }).update({
         name,
         url,
         updated_at: db.fn.now()
       });
       return existing.id as number;
     }
   }

   const inserted = (await db("sources")
     .insert({ name, url, lccn: lccn || null }) // Set lccn to null if not provided
     .returning(["id"])) as Array<{ id: number }>;

  return inserted[0].id;
};

const upsertArticles = async (sourceId: number, items: OdnpItem[]) => {
  if (!items.length) return 0;

  const rows = items
    .map((item) => {
      const date = toDateString(item.date);
      const url = item.url
        ? item.url
        : item.id
          ? `https://oregonnews.uoregon.edu${item.id}`
          : null;
      if (!item.title || !url || !date) return null;
      const ocrText = item.ocr_eng || item.ocr || "";
      const snippet = item.snippet || (ocrText ? ocrText.slice(0, 280) : null);
      const displayTitle = item.page
        ? `${item.title} — Page ${item.page}`
        : item.title;
      return {
        source_id: sourceId,
        title: displayTitle,
        date,
        url,
        snippet,
        ocr_url: item.ocr_url ?? null
      };
    })
    .filter(Boolean) as Array<{
    source_id: number;
    title: string;
    date: string;
    url: string;
    snippet: string | null;
    ocr_url: string | null;
  }>;

  if (!rows.length) return 0;

  await db("articles")
    .insert(rows)
    .onConflict(["source_id", "url"])
    .merge({
      title: db.raw("excluded.title"),
      date: db.raw("excluded.date"),
      snippet: db.raw("excluded.snippet"),
      ocr_url: db.raw("excluded.ocr_url"),
      updated_at: db.fn.now()
    });

  return rows.length;
};

const run = async () => {
  const query = getEnv("ODNP_QUERY", "Steve Duin");
  const date1 = getEnv("ODNP_DATE1", "1987");
  const date2 = getEnv("ODNP_DATE2", new Date().getFullYear().toString());
  const rows = Number(getEnv("ODNP_ROWS", "50"));
  const maxPages = Number(getEnv("ODNP_MAX_PAGES", "5"));
  const lccn = getEnv("ODNP_LCCN", "sn83025138");

  const sourceId = await upsertSource();
  let totalInserted = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage({
      proxtext: query,
      date1,
      date2,
      ...(lccn ? { lccn } : {}),
      rows,
      page,
      format: "json"
    });

    const items = response.items ?? [];
    if (!items.length) break;

    const inserted = await upsertArticles(sourceId, items);
    totalInserted += inserted;

    const totalItems = response.totalItems ?? 0;
    const fetchedSoFar = page * rows;
    if (totalItems && fetchedSoFar >= totalItems) break;
  }

  console.log(`Inserted/updated ${totalInserted} articles.`);
  await db.destroy();
};

run().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
