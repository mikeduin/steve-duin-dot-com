import type { GraphQLResolveInfo } from "graphql";

export type Maybe<T> = T | null;
export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export type Source = {
  id: string;
  name: string;
  url?: string | null;
};

export type Article = {
  id: string;
  title: string;
  date: string;
  url?: string | null;
  snippet?: string | null;
  source: Source;
};

export type Column = {
  id: string;
  title: string;
  date: string;
  url?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  sourceMetadata?: string | null;
  publicationName?: string | null;
  byline?: string | null;
  articleSection?: string | null;
  wordCount?: number | null;
  extractionMethod?: string | null;
  contentExtractedAt?: string | null;
  tags: string[];
  source: Source;
};

export type NewsbankRequestConfig = {
  id: string;
  key: string;
  curl: string;
  requestUrl?: string | null;
  method: string;
  cookieHeader?: string | null;
  headers: string;
  bodyText?: string | null;
  updatedAt: string;
};

export type SyncRun = {
  id: string;
  sourceName: string;
  status: string;
  pruneStale: boolean;
  maxPages?: number | null;
  maxArticles?: number | null;
  totalDiscovered: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedExistingCount: number;
  failedCount: number;
  deletedStaleCount: number;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  progressPercent: number;
};

export type NewsbankSyncStatus = {
  isRunning: boolean;
  activeRun?: SyncRun | null;
  latestRun?: SyncRun | null;
};

export type Query = {
  searchArticles: (args: { query: string }) => Promise<Article[]> | Article[];
  searchColumns: (args: { query?: string | null; tags?: string[] | null; limit?: number | null; offset?: number | null }) =>
    Promise<Column[]> | Column[];
  searchColumnsPageForDate: (args: {
    date: string;
    query?: string | null;
    tags?: string[] | null;
    pageSize?: number | null;
  }) => Promise<number> | number;
  neighboringColumns: (args: { id: string; limit?: number | null }) => Promise<Column[]> | Column[];
  column: (args: { id: string }) => Promise<Maybe<Column>> | Maybe<Column>;
  newsbankRequestConfig: () => Promise<Maybe<NewsbankRequestConfig>> | Maybe<NewsbankRequestConfig>;
  newsbankSyncStatus: () => Promise<NewsbankSyncStatus> | NewsbankSyncStatus;
};

export type Mutation = {
  saveNewsbankRequestConfig: (args: { curl: string }) => Promise<NewsbankRequestConfig> | NewsbankRequestConfig;
  startNewsbankSync: (args: {
    maxPages?: number | null;
    maxArticles?: number | null;
    pruneStale?: boolean | null;
  }) => Promise<SyncRun> | SyncRun;
  updateColumnTitle: (args: { id: string; title: string }) => Promise<Column> | Column;
  updateColumnTags: (args: { id: string; tags: string[] }) => Promise<Column> | Column;
  markColumnDuplicate: (args: { id: string }) => Promise<boolean> | boolean;
};

export type Resolvers = {
  Query: {
    searchArticles: ResolverFn<Article[], unknown, unknown, { query: string }>;
    searchColumns: ResolverFn<Column[], unknown, unknown, { query?: string | null; tags?: string[] | null; limit?: number | null; offset?: number | null }>;
    searchColumnsPageForDate: ResolverFn<
      number,
      unknown,
      unknown,
      { date: string; query?: string | null; tags?: string[] | null; pageSize?: number | null }
    >;
    neighboringColumns: ResolverFn<Column[], unknown, unknown, { id: string; limit?: number | null }>;
    column: ResolverFn<Maybe<Column>, unknown, unknown, { id: string }>;
    newsbankRequestConfig: ResolverFn<Maybe<NewsbankRequestConfig>, unknown, unknown, Record<string, never>>;
    newsbankSyncStatus: ResolverFn<NewsbankSyncStatus, unknown, unknown, Record<string, never>>;
  };
  Mutation: {
    saveNewsbankRequestConfig: ResolverFn<NewsbankRequestConfig, unknown, unknown, { curl: string }>;
    startNewsbankSync: ResolverFn<
      SyncRun,
      unknown,
      unknown,
      { maxPages?: number | null; maxArticles?: number | null; pruneStale?: boolean | null }
    >;
    updateColumnTitle: ResolverFn<Column, unknown, unknown, { id: string; title: string }>;
    updateColumnTags: ResolverFn<Column, unknown, unknown, { id: string; tags: string[] }>;
    markColumnDuplicate: ResolverFn<boolean, unknown, unknown, { id: string }>;
  };
};
