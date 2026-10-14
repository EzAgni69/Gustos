import { io, Socket } from "socket.io-client";
import { getUnsyncedEvents, pushToCloud } from "./sync.service.js";
import { emitOrderUpdated } from "../socket/events.js";
import { createOnlineOrderFromWebhook, acceptOnlineOrder } from "./order.service.js";
import { pullFromCloud } from "./cloud-sync.service.js";
import { generateKOT } from "./kot.service.js";

let socket: Socket | null = null;
const API_URL = process.env.CLOUD_API_URL ?? "http://localhost:3001";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID ?? "org_default";
const OUTLET_ID = process.env.OUTLET_ID ?? "outlet_default";

export function initRealtimeUplink() {
  console.log(`[Realtime Uplink] Connecting to Cloud API at ${API_URL}`);
  
  socket = io(API_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on("connect", () => {
    console.log(`[Realtime Uplink] Connected to Cloud ERP!`);
    
    // Authenticate / Join Store Room
    socket?.emit("join:store", {
      organizationId: ORGANIZATION_ID,
      outletId: OUTLET_ID,
    });
    
    // Flush outbox on connect
    flushOutbox();
  });

  socket.on("store:joined", (data) => {
    console.log(`[Realtime Uplink] Successfully joined room: ${data.room}`);
  });

  socket.on("cloud:sync_update", (data) => {
    console.log(`[Realtime Uplink] Received real-time update from Cloud ERP`, data);
    
    const downlinkEvents = ["MENU_UPDATED", "TABLE_UPDATED", "CONFIG_UPDATED", "USER_UPDATED"];
    if (downlinkEvents.includes(data.eventType)) {
      console.log(`[Realtime Uplink] Downlink config changed (${data.eventType}). Pulling immediately...`);
      pullFromCloud().catch(err => console.error("[Realtime Uplink] Pull error:", err));
    }
    else if (data.eventType === "ORDER_COMPLETED" && data.payload) {
      // Broadcast this back down to the local LAN so Captains / KDS see the update
      emitOrderUpdated(data.payload);
    }
    else if (data.eventType === "ONLINE_ORDER_RECEIVED" && data.payload) {
      try {
        console.log(`[Realtime Uplink] New Online Order from Zomato. Creating local DRAFT...`);
        const order = createOnlineOrderFromWebhook(data.payload);

        // Auto-KOT Pipeline
        const isAutoKOTEnabled = process.env.AUTO_KOT_ONLINE_ORDERS === "true";
        if (isAutoKOTEnabled && order) {
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
  if (syncedCount > 0) {
    // Notify the socket room so other clients connected to the Cloud ERP get real-time UI updates
    socket.emit("sync:push_realtime", {
      organizationId: ORGANIZATION_ID,
      outletId: OUTLET_ID,
      count: syncedCount,
      timestamp: new Date().toISOString(),
    });
  }
}
