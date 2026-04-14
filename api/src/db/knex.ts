import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import knex from "knex";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
dotenv.config({ path: envPath });

const db = knex({
	client: "pg",
	connection: process.env.DATABASE_URL,
	migrations: {
		directory: "./migrations"
	},
	seeds: {
		directory: "./seeds"
	}
});

export default db;
