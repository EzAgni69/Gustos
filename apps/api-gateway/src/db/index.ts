/**
 * Gusto API Gateway — PostgreSQL Database Connection
 *
 * Connects to the cloud PostgreSQL database using postgres.js driver
 * and initializes Drizzle ORM with the cloud schema.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@gusto/db-schema/cloud";
import dotenv from "dotenv";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Create postgres.js connection
const client = postgres(DATABASE_URL, {
  max: 10, // Connection pool size
  idle_timeout: 20,
  connect_timeout: 10,
  types: {
    numeric: {
      to: 1700,
      from: [1700],
      parse: parseFloat,
      serialize: (x: any) => x.toString()
    }
  }
});

// Initialize Drizzle ORM with cloud schema
export const db = drizzle(client, { schema });

// Export the raw client for graceful shutdown
export const pgClient = client;
