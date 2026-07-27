/**
 * Gusto Cloud API Gateway
 *
 * Fastify-based REST API serving the web admin dashboard and
 * handling cloud sync from local POS machines.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";

import { authPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { authRoutes } from "./routes/auth.routes.js";
import { organizationRoutes } from "./routes/organization.routes.js";
import { franchiseRoutes } from "./routes/franchise.routes.js";
import { outletRoutes } from "./routes/outlet.routes.js";
import { userRoutes } from "./routes/user.routes.js";
import { menuRoutes } from "./routes/menu.routes.js";
import { tableRoutes } from "./routes/table.routes.js";
import { customerRoutes } from "./routes/customer.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { inventoryRoutes } from "./routes/inventory.routes.js";
import { orderRoutes } from "./routes/order.routes.js";
import { pgClient } from "./db/index.js";

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ─── Register Plugins ───
await fastify.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
});
await fastify.register(authPlugin);
await fastify.register(errorHandlerPlugin);

// ─── Register Routes ───
await fastify.register(authRoutes);
await fastify.register(organizationRoutes);
await fastify.register(franchiseRoutes);
await fastify.register(outletRoutes);
await fastify.register(userRoutes);
await fastify.register(menuRoutes);
await fastify.register(tableRoutes);
await fastify.register(customerRoutes);
await fastify.register(syncRoutes);
await fastify.register(inventoryRoutes);
await fastify.register(orderRoutes);

// ─── Health Check ───
fastify.get("/health", async () => {
  return {
    status: "ok",
    service: "gusto-api-gateway",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  };
});

// ─── Start Server ───
const PORT = Number(process.env.API_GATEWAY_PORT ?? 3001);

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`
╔══════════════════════════════════════════════╗
║       ☁️  Gusto Cloud API Gateway            ║
╠══════════════════════════════════════════════╣
║  REST API:    http://localhost:${PORT}         ║
║  Version:     0.1.0                          ║
║  Status:      ✅ Running                      ║
╚══════════════════════════════════════════════╝
  `);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// ─── Graceful Shutdown ───
const shutdown = async (signal: string) => {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  await fastify.close();
  await pgClient.end();
  console.log("Server closed.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
