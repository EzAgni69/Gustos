/**
 * Gusto POS Local Server
 *
 * The single source of truth for the local restaurant network.
 * - Express REST API on localhost:8080
 * - SQLite database for offline-first operation
 * - Socket.IO hub for LAN communication (Captain App, KDS)
 * - Thermal printer interface (simulated)
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import { initializeDatabase, sqlite } from "./db/index.js";
import { initSocketEvents } from "./socket/events.js";
import { authMiddleware } from "./middleware/auth.js";

// Routes
import { authRoutes } from "./routes/auth.routes.js";
import { menuRoutes } from "./routes/menu.routes.js";
import { tableRoutes } from "./routes/table.routes.js";
import { orderRoutes } from "./routes/order.routes.js";
import { kotRoutes } from "./routes/kot.routes.js";
import { checkoutRoutes } from "./routes/checkout.routes.js";
import { expoRoutes } from "./routes/expo.routes.js";
import { printRoutes } from "./routes/print.routes.js";
import { shiftRoutes } from "./routes/shift.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { startCloudSyncPoller, stopCloudSyncPoller } from "./services/cloud-sync.service.js";
import { startPrintRetryLoop, stopPrintRetryLoop } from "./services/print.service.js";
import { initRealtimeUplink, stopRealtimeUplink } from "./services/realtime-uplink.service.js";

import os from "os";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

// ─── Initialize Local Database ───
try {
  initializeDatabase();
} catch (err) {
  console.error("Failed to initialize database:", err);
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*", // LAN access — all local devices
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

const PORT = Number(process.env.PORT ?? process.env.POS_LOCAL_PORT ?? 8080);
const SERVER_VERSION = "0.1.0";

// ─── Middleware ───
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== "object") req.body = {};
  next();
});
app.use(authMiddleware);

// ─── Health Check ───
app.get("/health", (_req, res) => {
  let database = "ok";
  try {
    sqlite.prepare("SELECT 1").get();
  } catch {
    database = "error";
  }
  res.status(database === "ok" ? 200 : 503).json({
    status: database === "ok" ? "ok" : "degraded",
    service: "gusto-pos-local-server",
    version: SERVER_VERSION,
    database,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ─── API access control ───
// Everything under /api needs a signed-in staff member, except:
//  - logging in and the staff list shown on the login screen
//  - network discovery used by the Captain app's connect screen
//  - the kitchen screens (KDS / Expo), which are shared wall-mounted devices
//    with no user; they can only read tickets and bump their cooking status.
const PUBLIC_API_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/auth\/(login|pin-login)\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/users\/?$/ },
  { method: "GET", pattern: /^\/api\/system\/network\/?$/ },
  { method: "GET", pattern: /^\/api\/kots\/?$/ },
  { method: "PATCH", pattern: /^\/api\/kots\/[^/]+\/status\/?$/ },
  { method: "POST", pattern: /^\/api\/kots\/[^/]+\/stations\/[^/]+\/(ready|recall)\/?$/ },
  { method: "GET", pattern: /^\/api\/expo\/(orders|recent)\/?$/ },
  { method: "POST", pattern: /^\/api\/expo\/orders\/[^/]+\/(bump|recall)\/?$/ },
];

app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS" || req.currentUser) return next();
  const fullPath = req.baseUrl + req.path;
  if (PUBLIC_API_ROUTES.some((r) => r.method === req.method && r.pattern.test(fullPath))) return next();
  res.status(401).json({ success: false, message: "Authentication required", code: "UNAUTHENTICATED" });
});

// ─── Network Info ───
app.get("/api/system/network", (_req, res) => {
  const nets = os.networkInterfaces();
  const results: string[] = [];

  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;
    for (const net of interfaces) {
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }

  res.json({
    success: true,
    ipAddresses: results,
  });
});

// ─── Register Routes ───
app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api", kotRoutes);        // /api/orders/:id/kot, /api/kots, /api/kots/:id/status
app.use("/api", checkoutRoutes);    // /api/orders/:id/checkout, /api/orders/:id/invoice
app.use("/api", expoRoutes);        // /api/kots/:id/stations/*, /api/expo/*
app.use("/api/print", printRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/sync", syncRoutes);

// ─── Static Frontends: KDS TV & POS UI ───
const possibleKdsPaths = [
  path.resolve(__dirname, "../../kds-tv/dist"),
  path.resolve(__dirname, "../kds-tv-dist"),
  path.resolve(process.cwd(), "apps/kds-tv/dist"),
  path.resolve(process.cwd(), "public/kds"),
];
const kdsDist = possibleKdsPaths.find((p) => fs.existsSync(p));
if (kdsDist) {
  console.log(`[Static] Serving KDS TV from: ${kdsDist}`);
  app.use("/kds", (req, res, next) => {
    if (req.originalUrl === "/kds") {
      return res.redirect(301, "/kds/");
    }
    next();
  });
  app.use("/kds", express.static(kdsDist));
  app.use("/kds", (_req, res) => {
    res.sendFile(path.join(kdsDist, "index.html"));
  });
}

const possiblePosUiPaths = [
  path.resolve(__dirname, "../../pos-ui/dist"),
  path.resolve(__dirname, "../pos-ui-dist"),
  path.resolve(process.cwd(), "apps/pos-ui/dist"),
  path.resolve(process.cwd(), "public/pos"),
];
const posUiDist = possiblePosUiPaths.find((p) => fs.existsSync(p));
if (posUiDist) {
  console.log(`[Static] Serving POS UI from: ${posUiDist}`);
  app.use(express.static(posUiDist));
  // Fallback static lookup for KDS assets if requested at /assets
  if (kdsDist && fs.existsSync(path.join(kdsDist, "assets"))) {
    app.use("/assets", express.static(path.join(kdsDist, "assets")));
  }
  app.use((req, res, next) => {
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/socket.io") ||
      req.path.startsWith("/health") ||
      req.path.startsWith("/kds") ||
      req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)
    ) {
      return next();
    }
    res.sendFile(path.join(posUiDist, "index.html"));
  });
}

// ─── Unknown API routes ───
app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Global Error Handler ───
app.use(
  (
    err: Error & { status?: number; statusCode?: number; type?: string },
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (res.headersSent) return;

    // Malformed / oversized request bodies are the client's fault, not ours
    const status = err.status ?? err.statusCode;
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ success: false, message: "Request body is not valid JSON" });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ success: false, message: "Request body is too large" });
      return;
    }
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ success: false, message: err.message || "Bad request" });
      return;
    }

    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
);

// ─── Initialize Socket.IO ───
initSocketEvents(io);

const timers: Array<ReturnType<typeof setInterval>> = [];

// ─── Start Server ───
httpServer.listen(PORT as number, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         🍽️  Gusto POS Local Server          ║
╠══════════════════════════════════════════════╣
║  REST API:    http://localhost:${PORT}          ║
║  Socket.IO:   ws://localhost:${PORT}            ║
║  Version:     ${SERVER_VERSION}                          ║
║  Status:      ✅ Running                      ║
╚══════════════════════════════════════════════╝
  `);

  // Start cloud sync poller — pulls menu, tables, users from cloud
  startCloudSyncPoller((changes) => {
    if (
      changes.menuItemsUpdated > 0 ||
      changes.menuCategoriesUpdated > 0 ||
      changes.menuCategoriesPruned > 0 ||
      changes.menuItemsPruned > 0
    ) {
      io.emit("sync:menu-updated", {
        menuItemsUpdated: changes.menuItemsUpdated,
        menuCategoriesUpdated: changes.menuCategoriesUpdated,
        menuItemsPruned: changes.menuItemsPruned,
        menuCategoriesPruned: changes.menuCategoriesPruned,
        timestamp: changes.timestamp,
      });
    }
    if (changes.diningTablesUpdated > 0 || changes.diningTablesPruned > 0) {
      io.emit("sync:tables-updated", {
        tablesUpdated: changes.diningTablesUpdated,
        tablesPruned: changes.diningTablesPruned,
        timestamp: changes.timestamp,
      });
    }
    if (changes.usersUpdated > 0 || changes.usersPruned > 0) {
      io.emit("sync:users-updated", {
        usersUpdated: changes.usersUpdated,
        usersPruned: changes.usersPruned,
        timestamp: changes.timestamp,
      });
    }
  });

  // Start print retry loop for failed print jobs
  startPrintRetryLoop();

  // Initialize real-time cloud ERP uplink
  initRealtimeUplink();

  // Periodic sync outbox retry — ensures FAILED events are retried even if socket is down
  timers.push(
    setInterval(async () => {
      try {
        const { pushToCloud } = await import("./services/sync.service.js");
        const synced = await pushToCloud();
        if (synced > 0) {
          console.log(`[Sync Cron] ✅ Retried and synced ${synced} pending outbox event(s) to cloud`);
        }
      } catch {
        // Silent — cloud may be unreachable
      }
    }, 120_000) // Every 2 minutes
  );

  // Order snapshot reconciliation — keeps Cloud ERP orders (items, totals, status)
  // identical to local orders and backfills any history that never synced.
  const reconcileOrders = async () => {
    try {
      const { reconcileOrderSnapshots } = await import("./services/order-sync.service.js");
      if (reconcileOrderSnapshots() > 0) {
        const { pushToCloud } = await import("./services/sync.service.js");
        await pushToCloud();
      }
    } catch (err) {
      console.warn("[OrderSync] Reconcile error:", err instanceof Error ? err.message : err);
    }
  };
  timers.push(setTimeout(reconcileOrders, 10_000));
  timers.push(setInterval(reconcileOrders, 300_000)); // Every 5 minutes

  // Housekeeping — keep the local database from growing without bound
  const housekeeping = async () => {
    try {
      const { pruneSyncedEvents } = await import("./services/sync.service.js");
      const { prunePrintQueue } = await import("./services/print.service.js");
      const events = pruneSyncedEvents();
      const jobs = prunePrintQueue();
      if (events > 0 || jobs > 0) {
        console.log(`[Housekeeping] Pruned ${events} synced event(s) and ${jobs} finished print job(s)`);
      }
    } catch (err) {
      console.warn("[Housekeeping] Error:", err instanceof Error ? err.message : err);
    }
  };
  timers.push(setTimeout(housekeeping, 60_000));
  timers.push(setInterval(housekeeping, 6 * 3_600_000)); // Every 6 hours
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[Server] Port ${PORT} is already in use. Is another POS server running?`);
  } else {
    console.error("[Server] Failed to start:", err);
  }
  process.exit(1);
});

// ─── Graceful shutdown ───
// Stop accepting work, let in-flight requests finish, then checkpoint and
// close SQLite so the WAL is flushed and the database file is consistent.
let shuttingDown = false;
function shutdown(signal: string, exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down...`);

  for (const t of timers) clearInterval(t);
  stopCloudSyncPoller();
  stopPrintRetryLoop();
  stopRealtimeUplink();

  const finish = () => {
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
      sqlite.close();
    } catch (err) {
      console.error("[Server] Error closing database:", err);
    }
    process.exit(exitCode);
  };

  // Force-exit if connections refuse to drain
  setTimeout(finish, 5_000).unref();
  io.close(() => finish());
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  // State may be inconsistent — log, flush the database and let the process
  // supervisor (or the desktop launcher) restart us.
  console.error("[Server] Uncaught exception:", err);
  shutdown("uncaughtException", 1);
});

export { app, io, httpServer };
