/**
 * Test Database Helper
 *
 * Creates an in-memory SQLite database for unit tests, built from the real
 * Drizzle migrations so the test schema can never drift from production.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@gusto/db-schema/local";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../../../../packages/db-schema/drizzle/local");

/**
 * Create a fresh in-memory SQLite database with the full local schema.
 * Each call returns an independent DB instance — safe for parallel tests.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
