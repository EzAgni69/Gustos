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
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

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



  const relativeMigrationsFolder = path.resolve(
    __dirname,
    "../../../../packages/db-schema/drizzle/local"
  );
  const cwdMigrationsFolder = path.resolve(
    process.cwd(),
    "packages/db-schema/drizzle/local"
  );

  const migrationsFolder = fs.existsSync(relativeMigrationsFolder)
    ? relativeMigrationsFolder
    : cwdMigrationsFolder;

  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`Migrations folder not found at ${migrationsFolder}`);
  }

  console.log(`[Database] Applying migrations from ${migrationsFolder}...`);

  try {
    migrate(db, { migrationsFolder });
    console.log("[Database] Migrations applied successfully!");
  } catch (error) {
    console.error("[Database] Migration error:", error);
    throw error;
  }
}
