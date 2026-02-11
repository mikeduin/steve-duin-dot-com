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

export type Query = {
  searchArticles: (args: { query: string }) => Promise<Article[]> | Article[];
};

export type Resolvers = {
  Query: {
    searchArticles: ResolverFn<Article[], unknown, unknown, { query: string }>;
  };
};
