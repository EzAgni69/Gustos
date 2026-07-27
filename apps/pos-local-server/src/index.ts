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

const PORT = process.env.POS_LOCAL_PORT ?? 8080;

// ─── Middleware ───
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

// ─── Health Check ───
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "gusto-pos-local-server",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
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
httpServer.listen(PORT, () => {
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
});

export { app, io, httpServer };
