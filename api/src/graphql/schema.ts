import { gql } from "graphql-tag";

export const typeDefs = gql`
  type Source {
    id: ID!
    name: String!
    url: String
  }

  type Article {
    id: ID!
    title: String!
    date: String!
    url: String
    snippet: String
    source: Source!
  }

  type Column {
    id: ID!
    title: String!
    date: String!
    url: String
    snippet: String
    bodyText: String
    sourceMetadata: String
    publicationName: String
    byline: String
    articleSection: String
    wordCount: Int
    extractionMethod: String
    contentExtractedAt: String
    tags: [String!]!
    source: Source!
  }

  type NewsbankRequestConfig {
    id: ID!
    key: String!
    curl: String!
    requestUrl: String
    method: String!
    cookieHeader: String
    headers: String!
    bodyText: String
    updatedAt: String!
  }

  type SyncRun {
    id: ID!
    sourceName: String!
    status: String!
    pruneStale: Boolean!
    maxPages: Int
    maxArticles: Int
    totalDiscovered: Int!
    processedCount: Int!
    insertedCount: Int!
    updatedCount: Int!
    skippedExistingCount: Int!
    failedCount: Int!
    deletedStaleCount: Int!
    errorMessage: String
    startedAt: String!
    finishedAt: String
    progressPercent: Int!
  }

  type NewsbankSyncStatus {
    isRunning: Boolean!
    activeRun: SyncRun
    latestRun: SyncRun
  }

  type Query {
    searchArticles(query: String!): [Article!]!
    searchColumns(query: String, tags: [String!], limit: Int = 25, offset: Int = 0): [Column!]!
    searchColumnsPageForDate(date: String!, query: String, tags: [String!], pageSize: Int = 100): Int!
    neighboringColumns(id: ID!, limit: Int = 21): [Column!]!
    column(id: ID!): Column
    newsbankRequestConfig: NewsbankRequestConfig
    newsbankSyncStatus: NewsbankSyncStatus!
  }

  type Mutation {
    saveNewsbankRequestConfig(curl: String!): NewsbankRequestConfig!
    startNewsbankSync(maxPages: Int, maxArticles: Int, pruneStale: Boolean = false): SyncRun!
    updateColumnTitle(id: ID!, title: String!): Column!
    updateColumnTags(id: ID!, tags: [String!]!): Column!
    markColumnDuplicate(id: ID!): Boolean!
  }
`;
