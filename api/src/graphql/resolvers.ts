import type { Resolvers } from "./types";

export const resolvers: Resolvers = {
  Query: {
    searchArticles: async (_parent, args) => {
      const query = args.query.trim();

      if (!query) {
        return [];
      }

      return [
        {
          id: "demo-1",
          title: `Sample result for "${query}"`,
          date: new Date().toISOString().slice(0, 10),
          url: null,
          snippet: "This is a placeholder result until the DB is wired.",
          source: {
            id: "oregonian",
            name: "The Oregonian",
            url: "https://www.oregonlive.com"
          }
        }
      ];
    }
  }
};
