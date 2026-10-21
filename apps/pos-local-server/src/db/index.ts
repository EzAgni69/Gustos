import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@gusto/db-schema/local";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load environment from project root or current working directory
dotenv.config();
if (fs.existsSync(path.resolve(__dirname, "../../../../.env"))) {
  dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
}

// Resolve database path from environment variables or default
const dbPath = process.env.POS_LOCAL_DB_PATH || "./data/local.sqlite";

// Ensure data directory exists
const resolvedDbPath = path.resolve(dbPath);
const dbDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite database connection
export const sqlite: DatabaseType = new Database(resolvedDbPath);

// Optimize database for concurrent read/write across local LAN clients (Captain app, KDS, POS UI)
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Initialize Drizzle ORM
export const db = drizzle(sqlite, { schema });

/**
 * Initializes the SQLite database schema by running any pending Drizzle migrations.
 */
export function initializeDatabase(): void {
  console.log(`[Database] Initializing SQLite database at ${resolvedDbPath}...`);

  const candidates = [
    path.resolve(__dirname, "../../../../packages/db-schema/drizzle/local"),
    path.resolve(__dirname, "../../packages/db-schema/drizzle/local"),
    path.resolve(__dirname, "../packages/db-schema/drizzle/local"),
    path.resolve(__dirname, "../server/db-schema/drizzle/local"),
    path.resolve(__dirname, "../db-schema/drizzle/local"),
    path.resolve(process.cwd(), "packages/db-schema/drizzle/local"),
    path.resolve(process.cwd(), "server/db-schema/drizzle/local"),
  ];

  const migrationsFolder = candidates.find((p) => fs.existsSync(p));

  // Check if tables already exist in SQLite database
  const existingTables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='dining_tables'"
    )
    .get();

  if (migrationsFolder) {
    console.log(`[Database] Applying migrations from ${migrationsFolder}...`);
    try {
      migrate(db, { migrationsFolder });
      console.log("[Database] Migrations applied successfully!");
    } catch (error: any) {
      if (
        error?.message?.includes("already exists") ||
        error?.cause?.message?.includes("already exists")
      ) {
        console.log("[Database] Existing SQLite schema verified. Continuing...");
      } else {
        console.error("[Database] Migration error:", error);
        throw error;
      }
    }
  } else if (existingTables) {
    console.log("[Database] Pre-seeded SQLite database ready (no migrations folder required).");
  } else {
    throw new Error(
      `Migrations folder not found and SQLite database is uninitialized.`
    );
  }
}
