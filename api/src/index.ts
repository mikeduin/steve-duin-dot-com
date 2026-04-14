import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { typeDefs } from "./graphql/schema.js";
import { resolvers } from "./graphql/resolvers.js";

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json());

const server = new ApolloServer({
  typeDefs,
  resolvers
});

await server.start();

app.use(
  "/graphql",
  expressMiddleware(server)
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webDistDir = path.resolve(currentDir, "../../web/dist");
  const webIndexPath = path.join(webDistDir, "index.html");

  if (existsSync(webIndexPath)) {
    app.use(express.static(webDistDir));
    app.get("*", (_req, res) => {
      res.sendFile(webIndexPath);
    });
  } else {
    console.warn(`Web build not found at ${webDistDir}; serving API only.`);
  }
}

app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}/graphql`);
});
