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
import { initializeDatabase } from "./db/index.js";
import { initSocketEvents } from "./socket/events.js";
import { authMiddleware } from "./middleware/auth.js";

// Routes
import { authRoutes } from "./routes/auth.routes.js";
import { menuRoutes } from "./routes/menu.routes.js";
import { tableRoutes } from "./routes/table.routes.js";
import { orderRoutes } from "./routes/order.routes.js";
import { kotRoutes } from "./routes/kot.routes.js";
import { checkoutRoutes } from "./routes/checkout.routes.js";
import { printRoutes } from "./routes/print.routes.js";
import { shiftRoutes } from "./routes/shift.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { startCloudSyncPoller } from "./services/cloud-sync.service.js";
import { startPrintRetryLoop } from "./services/print.service.js";
import { initRealtimeUplink } from "./services/realtime-uplink.service.js";

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ─── Middleware ───
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== "object") req.body = {};
  next();
});
app.use(authMiddleware);

import os from "os";

// ─── Health Check ───
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "gusto-pos-local-server",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
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

// ─── Global Error Handler ───
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[Error]", err.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
);

// ─── Initialize Socket.IO ───
initSocketEvents(io);

// ─── Start Server ───
httpServer.listen(PORT as number, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         🍽️  Gusto POS Local Server          ║
╠══════════════════════════════════════════════╣
║  REST API:    http://localhost:${PORT}          ║
║  Socket.IO:   ws://localhost:${PORT}            ║
║  Version:     0.1.0                          ║
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
  setInterval(async () => {
    try {
      const { pushToCloud } = await import("./services/sync.service.js");
      const synced = await pushToCloud();
      if (synced > 0) {
        console.log(`[Sync Cron] ✅ Retried and synced ${synced} pending outbox event(s) to cloud`);
      }
    } catch (err) {
      // Silent — cloud may be unreachable
    }
  }, 120_000); // Every 2 minutes
});

export { app, io, httpServer };
