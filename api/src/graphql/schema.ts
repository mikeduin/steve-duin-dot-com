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

  type Query {
    searchArticles(query: String!): [Article!]!
  }
`;
