import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/local/index.ts",
  out: "./drizzle/local",
  dbCredentials: {
    url: process.env.POS_LOCAL_DB_PATH || "../../data/local.sqlite",
  },
});
