/**
 * Gusto Sync Worker — Cloud Database Connection
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@gusto/db-schema/cloud";
import dotenv from "dotenv";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/gustos_cloud";

// Create postgres connection
const client = postgres(connectionString, { max: 5 });

// Initialize Drizzle ORM
export const db = drizzle(client, { schema });
