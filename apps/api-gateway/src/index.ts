/**
 * Gusto Cloud API Gateway
 *
 * Fastify-based REST API serving the web admin dashboard and
 * handling cloud sync from local POS machines.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

dotenv.config();

// ─── Production Safety Checks ───
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change-me-in-production")
) {
  console.error(
    "FATAL: JWT_SECRET is set to the default insecure value. " +
    "Set a strong random JWT_SECRET before running in production."
  );
  process.exit(1);
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

import { authPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { Server as SocketServer } from "socket.io";
import { initCloudSocket } from "./socket/cloud-events.js";
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
import { integrationRoutes } from "./routes/integration.routes.js";
import { crmRoutes } from "./routes/crm.routes.js";
import { hrRoutes } from "./routes/hr.routes.js";
import { reportingRoutes } from "./routes/reporting.routes.js";
import { posRoutes } from "./routes/pos.routes.js";
import { recipeRoutes } from "./routes/recipe.routes.js";
import { stockRoutes } from "./routes/stock.routes.js";
import { vendorRoutes } from "./routes/vendor.routes.js";
import { pgClient } from "./db/index.js";



const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined, // fallback to standard JSON
  },
});

// ─── CORS Configuration ───
const rawCors = process.env.CORS_ORIGIN;

function checkOriginAllowed(origin: string | undefined): boolean {
  // Allow non-browser requests (no origin header, e.g. curl, mobile apps, server-to-server)
  if (!origin) return true;

  // If CORS_ORIGIN is unset or "*", allow all origins (reflecting request origin)
  if (!rawCors || rawCors.trim() === "*" || rawCors.trim() === "") return true;

  const normalizedOrigin = origin.trim().replace(/\/+$/, "").toLowerCase();

  // Always permit local development and Railway cloud deployments
  if (
    normalizedOrigin.includes("localhost") ||
    normalizedOrigin.includes("127.0.0.1") ||
    normalizedOrigin.endsWith(".up.railway.app") ||
    normalizedOrigin.endsWith(".railway.app")
  ) {
    return true;
  }

  const origins = rawCors.split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase());
  return origins.includes(normalizedOrigin);
}

// ─── Initialize Socket.IO ───
const io = new SocketServer(fastify.server, {
  cors: {
    origin: (origin, callback) => {
      callback(null, checkOriginAllowed(origin));
    },
    credentials: true,
  },
});
initCloudSocket(io);

// ─── Register Plugins ───
await fastify.register(cors, {
  origin: (origin, cb) => {
    cb(null, checkOriginAllowed(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "x-organization-id",
    "x-outlet-id",
    "X-POS-API-Key",
  ],
});
await fastify.register(authPlugin);
await fastify.register(errorHandlerPlugin);

// ─── Content Type Parsers ───
// Allow empty or whitespace-only bodies when Content-Type is application/json (e.g. DELETE requests)
fastify.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body: string, done) => {
    try {
      if (!body || (typeof body === "string" && body.trim() === "")) {
        return done(null, undefined);
      }
      const json = JSON.parse(body);
      done(null, json);
    } catch (err: unknown) {
      const error = err as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  }
);

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
await fastify.register(integrationRoutes);
await fastify.register(crmRoutes);
await fastify.register(hrRoutes);
await fastify.register(reportingRoutes);
await fastify.register(posRoutes);
await fastify.register(recipeRoutes);
await fastify.register(stockRoutes);
await fastify.register(vendorRoutes);

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
const PORT = Number(process.env.PORT ?? process.env.API_GATEWAY_PORT ?? 3001);

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
  Sentry.captureException(err);
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
