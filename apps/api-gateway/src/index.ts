/**
 * Gusto Cloud API Gateway
 *
 * Fastify-based REST API + Socket.IO real-time hub
 * serving the web admin dashboard, captain app, and KDS.
 *
 * Cloud-Only MVP: This is the single source of truth.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
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
import { kotRoutes } from "./routes/kot.routes.js";
import { checkoutRoutes } from "./routes/checkout.routes.js";
import { pgClient } from "./db/index.js";
import { initSocketEvents } from "./socket/events.js";

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  // Disable Fastify's built-in HTTP server creation — we'll manage our own
  serverFactory: (handler) => {
    const httpServer = createServer((req, res) => {
      handler(req, res);
    });
    return httpServer;
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
await fastify.register(kotRoutes);
await fastify.register(checkoutRoutes);

// ─── Health Check ───
fastify.get("/health", async () => {
  return {
    status: "ok",
    service: "gusto-api-gateway",
    version: "0.2.0",
    mode: "cloud-only-mvp",
    timestamp: new Date().toISOString(),
  };
});

// ─── Initialize Socket.IO ───
const httpServer = fastify.server;
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

initSocketEvents(io);

// ─── Start Server ───
const PORT = Number(process.env.API_GATEWAY_PORT ?? 3001);

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`
╔══════════════════════════════════════════════╗
║       ☁️  Gusto Cloud API Gateway            ║
╠══════════════════════════════════════════════╣
║  REST API:    http://localhost:${PORT}         ║
║  Socket.IO:   ws://localhost:${PORT}           ║
║  Mode:        Cloud-Only MVP                 ║
║  Version:     0.2.0                          ║
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
  io.close();
  await fastify.close();
  await pgClient.end();
  console.log("Server closed.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { fastify, io, httpServer };
