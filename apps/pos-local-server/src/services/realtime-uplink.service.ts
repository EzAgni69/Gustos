import { io, Socket } from "socket.io-client";
import { getUnsyncedEvents, pushToCloud } from "./sync.service.js";
import { emitOrderUpdated } from "../socket/events.js";
import { createOnlineOrderFromWebhook, acceptOnlineOrder } from "./order.service.js";
import { pullFromCloud } from "./cloud-sync.service.js";
import { generateKOT } from "./kot.service.js";
import { pullCloudCommands } from "./cloud-commands.service.js";

let socket: Socket | null = null;
const API_URL =
  process.env.API_GATEWAY_URL ||
  process.env.CLOUD_API_URL ||
  "http://localhost:3001";
const ORGANIZATION_ID =
  process.env.ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";
const OUTLET_ID =
  process.env.OUTLET_ID ?? "00000000-0000-0000-0000-000000000003";

// If explicitly disabled, skip uplink entirely (standalone client desktops)
const CLOUD_SYNC_ENABLED =
  process.env.CLOUD_SYNC_ENABLED !== "false" &&
  !!API_URL &&
  API_URL !== "";

let hasLoggedUplinkOffline = false;

export function initRealtimeUplink() {
  if (!CLOUD_SYNC_ENABLED) {
    console.log(`[Realtime Uplink] Cloud sync disabled — skipping ERP uplink`);
    return;
  }

  console.log(`[Realtime Uplink] Connecting to Cloud API at ${API_URL}`);
  startHeartbeat();
  
  socket = io(API_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000, // Back off more aggressively when unreachable
    // The cloud only lets an outlet's POS into its store room with the POS key
    auth: {
      posApiKey: process.env.POS_API_KEY || undefined,
      organizationId: ORGANIZATION_ID,
      outletId: OUTLET_ID,
    },
  });

  socket.on("connect", () => {
    hasLoggedUplinkOffline = false;
    console.log(`[Realtime Uplink] Connected to Cloud ERP!`);
    
    // Authenticate / Join Store Room
    socket?.emit("join:store", {
      organizationId: ORGANIZATION_ID,
      outletId: OUTLET_ID,
      posApiKey: process.env.POS_API_KEY || undefined,
    });
    
    // Flush outbox on connect, and pick up ERP edits made while we were offline
    flushOutbox();
    pullCloudCommands().catch(() => {});
  });

  // Suppress noisy reconnection errors — log once then go silent
  socket.on("connect_error", () => {
    if (!hasLoggedUplinkOffline) {
      console.log(`[Realtime Uplink] Cloud ERP unreachable — operating in offline mode (retrying silently)`);
      hasLoggedUplinkOffline = true;
    }
  });

  socket.on("store:joined", (data) => {
    console.log(`[Realtime Uplink] Successfully joined room: ${data.room}`);
  });

  socket.on("cloud:sync_update", (data) => {
    if (!data || typeof data.eventType !== "string") return;

    const downlinkEvents = ["MENU_UPDATED", "TABLE_UPDATED", "CONFIG_UPDATED", "USER_UPDATED"];
    if (downlinkEvents.includes(data.eventType)) {
      console.log(`[Realtime Uplink] Downlink config changed (${data.eventType}). Pulling immediately...`);
      pullFromCloud(true).catch(err => console.error("[Realtime Uplink] Pull error:", err));
    }
    else if (data.eventType === "ORDER_COMMAND") {
      // An ERP user edited/deleted one of our orders
      pullCloudCommands().catch(err => console.error("[Realtime Uplink] Command pull error:", err));
    }
    else if (data.eventType === "ORDER_COMPLETED" && data.payload) {
      // Broadcast this back down to the local LAN so Captains / KDS see the update
      emitOrderUpdated(data.payload);
    }
    else if (data.eventType === "ONLINE_ORDER_RECEIVED" && data.payload) {
      try {
        const { order, created } = createOnlineOrderFromWebhook(data.payload);
        if (!created) {
          console.log(`[Realtime Uplink] Online order ${order?.orderNumber} already received — ignoring duplicate delivery`);
          return;
        }
        console.log(`[Realtime Uplink] New online order ${order?.orderNumber} created as DRAFT`);

        // Auto-KOT Pipeline
        const isAutoKOTEnabled = process.env.AUTO_KOT_ONLINE_ORDERS === "true";
        if (isAutoKOTEnabled && order && order.items.length > 0) {
          console.log(`[Realtime Uplink] AUTO_KOT is enabled. Auto-accepting order ${order.orderNumber}...`);
          acceptOnlineOrder(order.id, "system");
          generateKOT(order.id, undefined, undefined, "system");
        }
      } catch (err) {
        console.error(`[Realtime Uplink] Error processing online order:`, err);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Realtime Uplink] Disconnected from Cloud ERP. Falling back to offline mode.`);
  });
}

// ─── Heartbeat ───
// Tells the Cloud ERP this outlet's POS is alive and how far behind its uploads
// are (shown in the ERP's Edge Sync Monitor). Plain HTTP so it also works when
// the websocket is blocked.

const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastLatencyMs = 0;

async function sendHeartbeat(): Promise<void> {
  try {
    const { getOutboxCounts } = await import("./sync.service.js");
    const counts = getOutboxCounts();
    const headers: Record<string, string> = { "Content-Type": "application/json", "x-outlet-id": OUTLET_ID };
    if (process.env.POS_API_KEY) headers["X-POS-API-Key"] = process.env.POS_API_KEY;

    const started = Date.now();
    const res = await fetch(`${API_URL}/api/v1/sync/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        outletId: OUTLET_ID,
        latencyMs: lastLatencyMs,
        pendingUploads: counts.pending + counts.failed,
        deadUploads: counts.dead,
        posVersion: process.env.npm_package_version ?? "0.1.0",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) lastLatencyMs = Date.now() - started;
  } catch {
    // Offline — the ERP will show this outlet as late / offline, which is the truth
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

/** Disconnect from the cloud (graceful shutdown). */
export function stopRealtimeUplink(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

/**
 * When the socket connects or an event is queued, flush immediately.
 */
export async function flushOutbox() {
  if (!socket?.connected) {
    return; // Wait for cron or next connection
  }

  // Instead of HTTP, we can push via WS or just use the HTTP logic immediately.
  // We'll reuse the robust HTTP logic but trigger it instantly instead of waiting for the cron job.
  const syncedCount = await pushToCloud();
  if (syncedCount > 0 && socket?.connected) {
    // Notify the socket room so other clients connected to the Cloud ERP get real-time UI updates
    socket.emit("sync:push_realtime", {
      organizationId: ORGANIZATION_ID,
      outletId: OUTLET_ID,
      count: syncedCount,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Notify Cloud ERP of local table status changes (e.g. OCCUPIED, AVAILABLE)
 */
export function notifyCloudTableStatus(tableId: string, status: string, tableName?: string): void {
  if (socket?.connected) {
    socket.emit("sync:push_realtime", {
      eventType: "TABLE_STATUS_CHANGED",
      organizationId: ORGANIZATION_ID,
      outletId: OUTLET_ID,
      payload: { tableId, tableName, status },
    });
  }
}

