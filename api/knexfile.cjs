const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const isProduction = process.env.NODE_ENV === "production";

const connection = isProduction
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    }
  : process.env.DATABASE_URL;

module.exports = {
  client: "pg",
  connection,
  migrations: {
    directory: "./migrations",
    extension: "cjs"
  },
  seeds: {
    directory: "./seeds"
  }
};
