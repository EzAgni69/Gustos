/**
 * Gusto Captain — Socket.IO Client
 *
 * Connects to the pos-local-server Socket.IO hub on the LAN.
 * Joins the "captains" room and relays real-time events to stores.
 */

import { io, Socket } from "socket.io-client";
import { SOCKET_EVENTS } from "../config/constants";
import { drainOfflineQueue } from "../lib/offlineQueue";

let socket: Socket | null = null;

type EventCallback = (data: unknown) => void;
const listeners = new Map<string, Set<EventCallback>>();

/**
 * Connect to the POS server.
 */
export function connectSocket(serverUrl: string, userId?: string | null): void {
  if (socket?.connected) {
    socket.disconnect();
  }

  const url = serverUrl.startsWith("http")
    ? serverUrl
    : `http://${serverUrl}`;

  socket = io(url, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  socket.on("connect", () => {
    console.log("[Socket.IO] Connected to POS server");
    // Join captains channel
    socket?.emit(SOCKET_EVENTS.JOIN_CAPTAIN);
    
    // Drain offline queue on connect/reconnect
    drainOfflineQueue(url, userId).catch(err => {
      console.error("[Socket.IO] Error draining offline queue:", err);
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket.IO] Disconnected: ${reason}`);
  });

  socket.on("connect_error", (error) => {
    console.log(`[Socket.IO] Connection error: ${error.message}`);
  });

  // ─── Relay server events to registered listeners ───

  socket.on(SOCKET_EVENTS.TABLE_STATUS_CHANGED, (data) => {
    emit(SOCKET_EVENTS.TABLE_STATUS_CHANGED, data);
  });

  socket.on(SOCKET_EVENTS.ORDER_UPDATED, (data) => {
    emit(SOCKET_EVENTS.ORDER_UPDATED, data);
  });

  socket.on(SOCKET_EVENTS.KOT_STATUS_UPDATE, (data) => {
    emit(SOCKET_EVENTS.KOT_STATUS_UPDATE, data);
  });

  socket.on(SOCKET_EVENTS.KOT_NEW, (data) => {
    emit(SOCKET_EVENTS.KOT_NEW, data);
  });
}

/**
 * Disconnect from the POS server.
 */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/**
 * Check if socket is connected.
 */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Get the raw socket instance (for advanced use).
 */
export function getSocket(): Socket | null {
  return socket;
}

// ─── Simple Event Bus for Store Subscriptions ───

function emit(event: string, data: unknown): void {
  const callbacks = listeners.get(event);
  if (callbacks) {
    for (const cb of callbacks) {
      try {
        cb(data);
      } catch (err) {
        console.error(`[Socket] Error in listener for ${event}:`, err);
      }
    }
  }
}

/**
 * Subscribe to a socket event. Returns an unsubscribe function.
 */
export function onSocketEvent(
  event: string,
  callback: EventCallback
): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(callback);

  return () => {
    listeners.get(event)?.delete(callback);
  };
}
