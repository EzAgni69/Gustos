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

// Tracing every request is expensive at production volume — sample by default.
const sentrySampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === "production" ? 0.1 : 1));
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV ?? "development",
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: Number.isFinite(sentrySampleRate) ? sentrySampleRate : 0.1,
  profilesSampleRate: Number.isFinite(sentrySampleRate) ? sentrySampleRate : 0.1,
});

import { authPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { Server as SocketServer } from "socket.io";
import { initCloudSocket, closeCloudSocket } from "./socket/cloud-events.js";
import { redisConnection, posSyncQueue, webhookQueue } from "./config/queue.js";
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
import { recipeRoutes } from "./routes/recipe.routes.js";
import { stockRoutes } from "./routes/stock.routes.js";
import { vendorRoutes } from "./routes/vendor.routes.js";
import { procurementRoutes } from "./routes/procurement.routes.js";
import { pgClient } from "./db/index.js";



const fastify = Fastify({
  // Behind a load balancer / Railway edge the client address is in X-Forwarded-For;
  // rate limiting and audit logs need the real one.
  trustProxy: process.env.TRUST_PROXY !== "false",
  bodyLimit: 1024 * 1024,
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

  // Compare the parsed hostname — a substring test would also accept
  // origins such as "https://localhost.evil.example".
  let hostname = "";
  try {
    hostname = new URL(normalizedOrigin).hostname;
  } catch {
    return false;
  }

  // Local development, and this project's Railway deployments
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".up.railway.app") ||
    hostname.endsWith(".railway.app")
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

// Realtime hub — needs the JWT plugin to authenticate ERP users
initCloudSocket(io, (token) => fastify.jwt.verify(token));

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
      // Kept for webhook signature checks, which must hash the exact bytes received
      (_req as { rawBody?: string }).rawBody = body;
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
await fastify.register(recipeRoutes);
await fastify.register(stockRoutes);
await fastify.register(vendorRoutes);
await fastify.register(procurementRoutes);

// ─── Health Check ───
// Reports the dependencies too, so a load balancer stops routing to an
// instance that has lost its database.
fastify.get("/health", async (_request, reply) => {
  const withTimeout = <T>(p: Promise<T>) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000))]);

  let database = "ok";
  let redis = "ok";
  try {
    await withTimeout(pgClient`select 1`);
  } catch {
    database = "error";
  }
  try {
    await withTimeout(redisConnection.ping());
  } catch {
    redis = "error";
  }

  // Redis only powers sync queues and realtime; the ERP still works without it
  const status = database === "ok" ? (redis === "ok" ? "ok" : "degraded") : "error";
  return reply.status(database === "ok" ? 200 : 503).send({
    status,
    service: "gusto-api-gateway",
    version: "0.1.0",
    database,
    redis,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
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
let shuttingDown = false;
const shutdown = async (signal: string, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info(`[${signal}] Shutting down gracefully...`);

  // Never hang forever on a stuck connection
  setTimeout(() => process.exit(exitCode || 1), 10_000).unref();

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      fastify.log.error({ err }, `Shutdown step failed: ${name}`);
    }
  };

  await step("socket.io", () => new Promise<void>((resolve) => io.close(() => resolve())));
  await step("http", () => fastify.close());
  await step("redis subscriber", () => closeCloudSocket());
  await step("queues", () => Promise.all([posSyncQueue.close(), webhookQueue.close()]));
  await step("redis", () => redisConnection.quit());
  await step("postgres", () => pgClient.end({ timeout: 5 }));
  await Sentry.close(2_000).catch(() => undefined);
  process.exit(exitCode);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
  fastify.log.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
  fastify.log.fatal({ err }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});
