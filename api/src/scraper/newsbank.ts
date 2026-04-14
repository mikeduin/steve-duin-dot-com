import "dotenv/config";
import path from "node:path";
import db from "../db/knex.js";
import { runNewsbankSync } from "./newsbank-sync.js";

const run = async () => {
  const result = await runNewsbankSync({
    onProgress: (progress) => {
      if (progress.processed > 0 && progress.processed % 25 === 0) {
        console.log(`Processed ${progress.processed}/${progress.discovered} articles...`);
      }
    }
  });

  console.log(
    `NewsBank scrape complete. Processed ${result.processed} articles (${result.inserted} inserted, ${result.updated} updated, ${result.deletedStale} stale deleted). Output file: ${path.resolve(process.cwd(), process.env.NEWSBANK_OUTPUT_FILE ?? ".tmp/newsbank-articles.ndjson")}`
  );

  await db.destroy();
};

run().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
