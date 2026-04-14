import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import knex from "knex";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
dotenv.config({ path: envPath });

const isProduction = process.env.NODE_ENV === "production";

const connection = isProduction
	? {
			connectionString: process.env.DATABASE_URL,
			ssl: {
				rejectUnauthorized: false
			}
		}
	: process.env.DATABASE_URL;

const db = knex({
	client: "pg",
	connection,
	migrations: {
		directory: "./migrations"
	},
	seeds: {
		directory: "./seeds"
	}
});

export default db;
