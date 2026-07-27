import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/cloud/index.ts",
  out: "./drizzle/cloud",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://gusto:gusto_dev_password@localhost:5433/gusto_dev",
  },
});
