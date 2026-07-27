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

dotenv.config();

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://gusto:gusto_dev_password@localhost:5433/gusto_dev";

// Create postgres.js connection
const client = postgres(DATABASE_URL, {
  max: 10, // Connection pool size
  idle_timeout: 20,
  connect_timeout: 10,
});

// Initialize Drizzle ORM with cloud schema
export const db = drizzle(client, { schema });

// Export the raw client for graceful shutdown
export const pgClient = client;
