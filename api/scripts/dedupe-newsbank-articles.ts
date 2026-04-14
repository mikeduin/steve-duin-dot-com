import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import knex from 'knex';
import knexConfig from '../knexfile.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface CliOptions {
  apply: boolean;
  tableName: string;
  sampleSize: number;
  textColumn?: string;
}

interface DuplicateMatchRow {
  duplicate_article_id: string;
  canonical_article_id: string;
  duplicate_headline: string;
  canonical_headline: string;
}

interface ArticleRow {
  id: number;
  date: Date | string;
  text_value: string;
}

interface RowFeatures {
  id: number;
  dateMs: number;
  headline: string;
  norm: string;
  words4: string;
  words4Compact: string;
  words2: string;
  stevePos: number;
}

interface MatchCandidate {
  duplicateId: number;
  canonicalId: number;
  duplicateHeadline: string;
  canonicalHeadline: string;
  baseLen: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    tableName: 'articles',
    sampleSize: 20,
    textColumn: undefined,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }

    if (arg.startsWith('--table=')) {
      options.tableName = arg.slice('--table='.length).trim() || 'articles';
      continue;
    }

    if (arg.startsWith('--sample=')) {
      const parsed = Number(arg.slice('--sample='.length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.sampleSize = Math.floor(parsed);
      }
      continue;
    }

    if (arg.startsWith('--text-column=')) {
      const value = arg.slice('--text-column='.length).trim();
      options.textColumn = value || undefined;
    }
  }

  return options;
}

function sanitizeTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

function sanitizeColumnName(columnName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
    throw new Error(`Invalid column name: ${columnName}`);
  }
  return columnName;
}

function normalizeWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeAlnum(value: string): string {
  return normalizeWhitespace(value).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstNWords(value: string, count: number): string {
  return normalizeAlnum(value).split(' ').filter(Boolean).slice(0, count).join(' ');
}

function firstNWordsCompact(value: string, count: number): string {
  return normalizeAlnum(value)
    .split(' ')
    .filter((word) => word.length > 0 && !['and', 'or', 'the', 'a', 'an'].includes(word))
    .slice(0, count)
    .join(' ');
}

function first2WordsNoLeadingArticle(value: string): string {
  return normalizeAlnum(value).replace(/^(a|an|the)\s+/, '').split(' ').filter(Boolean).slice(0, 2).join(' ');
}

function buildFeatures(row: ArticleRow): RowFeatures {
  const headline = row.text_value;
  const norm = normalizeWhitespace(headline);
  const stevePos = (() => {
    const steve = norm.indexOf('steve duin');
    if (steve >= 0) return steve + 1;
    const duinSpaced = norm.indexOf('duin :');
    if (duinSpaced >= 0) return duinSpaced + 1;
    const duinCompact = norm.indexOf('duin:');
    if (duinCompact >= 0) return duinCompact + 1;
    return 0;
  })();

  return {
    id: row.id,
    dateMs: Date.parse(String(row.date)),
    headline,
    norm,
    words4: firstNWords(headline, 4),
    words4Compact: firstNWordsCompact(headline, 4),
    words2: first2WordsNoLeadingArticle(headline),
    stevePos,
  };
}

function isLikelySteveHeadline(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes('steve duin') || lower.includes('duin :') || lower.includes('duin:');
}

function dateWithinOneDay(aMs: number, bMs: number): boolean {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  return Math.abs(aMs - bMs) <= 24 * 60 * 60 * 1000;
}

function findBestMatchForSteve(steve: RowFeatures, baseRows: RowFeatures[]): MatchCandidate | null {
  let best: MatchCandidate | null = null;

  for (const base of baseRows) {
    if (base.id === steve.id) continue;
    if (base.norm.length < 12) continue;

    const exactPrefixMatch =
      steve.stevePos > 20 &&
      steve.norm.startsWith(base.norm) &&
      steve.stevePos >= base.norm.length - 6 &&
      steve.norm.length >= base.norm.length + 12;

    const words4NearDateMatch =
      steve.stevePos > 12 &&
      steve.words4.length > 0 &&
      steve.words4 === base.words4 &&
      dateWithinOneDay(steve.dateMs, base.dateMs);

    const words4CompactNearDateMatch =
      steve.stevePos > 12 &&
      steve.words4Compact.length > 0 &&
      steve.words4Compact === base.words4Compact &&
      dateWithinOneDay(steve.dateMs, base.dateMs);

    const words2NearDateMatch =
      steve.stevePos > 12 &&
      steve.words2.length > 0 &&
      steve.words2 === base.words2 &&
      dateWithinOneDay(steve.dateMs, base.dateMs);

    if (!exactPrefixMatch && !words4NearDateMatch && !words4CompactNearDateMatch && !words2NearDateMatch) {
      continue;
    }

    const candidate: MatchCandidate = {
      duplicateId: steve.id,
      canonicalId: base.id,
      duplicateHeadline: steve.headline,
      canonicalHeadline: base.headline,
      baseLen: base.norm.length,
    };

    if (!best || candidate.baseLen > best.baseLen || (candidate.baseLen === best.baseLen && candidate.canonicalId < best.canonicalId)) {
      best = candidate;
    }
  }

  return best;
}

async function findDuplicateMatches(
  db: ReturnType<typeof knex>,
  tableName: string,
  textColumn: string
): Promise<MatchCandidate[]> {
  const rows = await db(tableName)
    .select<ArticleRow[]>(['id', 'date', db.ref(textColumn).as('text_value')])
    .whereNotNull(textColumn)
    .whereRaw(`trim(${textColumn}) <> ''`);

  const featured = rows
    .map(buildFeatures)
    .filter((row) => row.headline.trim().length > 0);

  const baseRows = featured.filter((row) => !isLikelySteveHeadline(row.headline));
  const steveRows = featured.filter((row) => isLikelySteveHeadline(row.headline));

  const matches: MatchCandidate[] = [];
  for (const steve of steveRows) {
    const best = findBestMatchForSteve(steve, baseRows);
    if (best) matches.push(best);
  }

  matches.sort((a, b) => a.duplicateId - b.duplicateId || a.canonicalId - b.canonicalId);
  return matches;
}

async function resolveTextColumn(
  db: ReturnType<typeof knex>,
  tableName: string,
  configuredTextColumn?: string
): Promise<string> {
  if (configuredTextColumn) {
    const safeConfigured = sanitizeColumnName(configuredTextColumn);
    const hasConfigured = await db.schema.hasColumn(tableName, safeConfigured);
    if (!hasConfigured) {
      throw new Error(`Configured text column '${safeConfigured}' does not exist on table '${tableName}'.`);
    }
    return safeConfigured;
  }

  const hasHeadline = await db.schema.hasColumn(tableName, 'headline');
  if (hasHeadline) return 'headline';

  const hasTitle = await db.schema.hasColumn(tableName, 'title');
  if (hasTitle) return 'title';

  throw new Error(`Table '${tableName}' must include either 'headline' or 'title' for dedupe matching.`);
}

async function ensureTableAndColumnsExist(
  db: ReturnType<typeof knex>,
  tableName: string,
  configuredTextColumn?: string
): Promise<string> {
  const tableExists = await db.schema.hasTable(tableName);
  if (!tableExists) {
    throw new Error(`Table '${tableName}' does not exist in the configured database.`);
  }

  const hasId = await db.schema.hasColumn(tableName, 'id');
  if (!hasId) {
    throw new Error(`Table '${tableName}' must have an 'id' column.`);
  }

  return resolveTextColumn(db, tableName, configuredTextColumn);
}

async function runDryRun(
  db: ReturnType<typeof knex>,
  tableName: string,
  textColumn: string,
  sampleSize: number
): Promise<void> {
  const matches = await findDuplicateMatches(db, tableName, textColumn);
  const duplicateCount = matches.length;

  console.log(`Mode: dry-run`);
  console.log(`Table: ${tableName}`);
  console.log(`Text column: ${textColumn}`);
  console.log(`Candidate duplicates to flag: ${duplicateCount}`);

  if (duplicateCount === 0) {
    console.log('No candidate duplicates found with the current matching rules.');
    return;
  }

  const sampleRows: DuplicateMatchRow[] = matches.slice(0, sampleSize).map((m) => ({
    duplicate_article_id: String(m.duplicateId),
    canonical_article_id: String(m.canonicalId),
    duplicate_headline: m.duplicateHeadline,
    canonical_headline: m.canonicalHeadline,
  }));

  console.log('Sample matches (duplicate -> canonical):');
  for (const row of sampleRows) {
    console.log(`- duplicate ${row.duplicate_article_id} -> canonical ${row.canonical_article_id}`);
    console.log(`  duplicate headline: ${row.duplicate_headline}`);
    console.log(`  canonical headline: ${row.canonical_headline}`);
  }
}

async function runApply(db: ReturnType<typeof knex>, tableName: string, textColumn: string): Promise<void> {
  const tx = await db.transaction();

  try {
    const hasFlagColumn = await tx.schema.hasColumn(tableName, 'is_newsbank_duplicate');
    if (!hasFlagColumn) {
      await tx.schema.alterTable(tableName, (t) => {
        t.boolean('is_newsbank_duplicate').notNullable().defaultTo(false);
      });
      console.log(`Added column ${tableName}.is_newsbank_duplicate`);
    }

    await tx(tableName)
      .where('is_newsbank_duplicate', true)
      .update({ is_newsbank_duplicate: false });

    const matches = await findDuplicateMatches(tx as unknown as ReturnType<typeof knex>, tableName, textColumn);
    const idsToFlag = matches.map((m) => m.duplicateId);

    if (idsToFlag.length > 0) {
      await tx(tableName)
        .whereIn('id', idsToFlag)
        .update({ is_newsbank_duplicate: true });
    }

    const summary = await tx(tableName)
      .select('is_newsbank_duplicate')
      .count<{ is_newsbank_duplicate: boolean; count: string }[]>('* as count')
      .groupBy('is_newsbank_duplicate')
      .orderBy('is_newsbank_duplicate', 'asc');

    await tx.commit();

    console.log('Mode: apply');
    console.log(`Table: ${tableName}`);
    console.log(`Text column: ${textColumn}`);
    console.log('Applied duplicate flags. Current breakdown:');
    for (const row of summary) {
      console.log(`- is_newsbank_duplicate=${row.is_newsbank_duplicate}: ${row.count}`);
    }
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tableName = sanitizeTableName(options.tableName);

  const env = (process.env.NODE_ENV ?? 'development') as keyof typeof knexConfig;
  const resolvedConfig =
    typeof (knexConfig as { client?: unknown }).client !== 'undefined'
      ? (knexConfig as knex.Knex.Config)
      : ((knexConfig as Record<string, knex.Knex.Config>)[env] ??
        (knexConfig as Record<string, knex.Knex.Config>).development);

  if (!resolvedConfig) {
    throw new Error(`Unable to resolve knex config for environment '${String(env)}'.`);
  }

  const db = knex(resolvedConfig);

  try {
    const textColumn = await ensureTableAndColumnsExist(db, tableName, options.textColumn);

    if (options.apply) {
      await runApply(db, tableName, textColumn);
    } else {
      await runDryRun(db, tableName, textColumn, options.sampleSize);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
