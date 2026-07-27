/**
 * KDS-TV — Socket.IO Connection Hook
 *
 * Manages the WebSocket lifecycle with the local POS server:
 * - Connects and joins the "kitchen" room
 * - Listens for `kot:new` and `kot:status-update` events
 * - On connect, hydrates state by fetching active KOTs via REST
 * - Exposes `markReady()` to update KOT status via REST API
 * - Tracks connection status for the UI indicator
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ConnectionStatus,
  KotNewPayload,
  KotStatusUpdatePayload,
  KotListItem,
} from "../types";
import { payloadToKDSKot, listItemToKDSKot } from "./useKOTStore";
import type { KDSKot } from "../types";

const SERVER_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as Record<string, Record<string, string>>).env
      ?.VITE_POS_SERVER_URL) ||
  "http://localhost:8080";

interface UseSocketOptions {
  onNewKOT: (kot: KDSKot) => void;
  onStatusUpdate: (kotId: string, status: KDSKot["status"]) => void;
  onHydrate: (kots: KDSKot[]) => void;
}

export function useSocket({ onNewKOT, onStatusUpdate, onHydrate }: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  // Stable refs for callbacks to avoid re-subscribing on every render
  const onNewKOTRef = useRef(onNewKOT);
  const onStatusUpdateRef = useRef(onStatusUpdate);
  const onHydrateRef = useRef(onHydrate);

  useEffect(() => {
    onNewKOTRef.current = onNewKOT;
    onStatusUpdateRef.current = onStatusUpdate;
    onHydrateRef.current = onHydrate;
  }, [onNewKOT, onStatusUpdate, onHydrate]);

  // ─── Fetch active KOTs from REST API ───
  const fetchActiveKOTs = useCallback(async () => {
    try {
      // Fetch PENDING and IN_PROGRESS KOTs
      const [pendingRes, inProgressRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/kots?status=PENDING`),
        fetch(`${SERVER_URL}/api/kots?status=IN_PROGRESS`),
      ]);

      const pendingData = await pendingRes.json();
      const inProgressData = await inProgressRes.json();

      const allKots: KDSKot[] = [];

      if (pendingData.success && Array.isArray(pendingData.data)) {
        allKots.push(
          ...pendingData.data.map((item: KotListItem) => listItemToKDSKot(item))
        );
      }
      if (inProgressData.success && Array.isArray(inProgressData.data)) {
        allKots.push(
          ...inProgressData.data.map((item: KotListItem) => listItemToKDSKot(item))
        );
      }

      onHydrateRef.current(allKots);
    } catch (err) {
      console.error("[KDS] Failed to fetch active KOTs:", err);
    }
  }, []);

  // ─── Socket.IO Connection ───
  useEffect(() => {
    const socket = io(SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[KDS] Connected to POS server:", socket.id);
      setConnectionStatus("connected");

      // Join the kitchen room
      socket.emit("join:kitchen");

      // Hydrate with current active KOTs
      fetchActiveKOTs();
    });

    socket.on("disconnect", () => {
      console.log("[KDS] Disconnected from POS server");
      setConnectionStatus("disconnected");
    });

    socket.io.on("reconnect_attempt", () => {
      setConnectionStatus("reconnecting");
    });

    socket.io.on("reconnect", () => {
      console.log("[KDS] Reconnected to POS server");
      setConnectionStatus("connected");
      socket.emit("join:kitchen");
      fetchActiveKOTs();
    });

    // ─── Listen for new KOTs ───
    socket.on("kot:new", (payload: KotNewPayload) => {
      console.log("[KDS] New KOT received:", payload.kotNumber);
      const kot = payloadToKDSKot(payload);
      onNewKOTRef.current(kot);
    });

    // ─── Listen for KOT status updates ───
    socket.on("kot:status-update", (payload: KotStatusUpdatePayload) => {
      console.log(
        "[KDS] KOT status update:",
        payload.kotId,
        "→",
        payload.status
      );
      onStatusUpdateRef.current(payload.kotId, payload.status);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchActiveKOTs]);

  // ─── Mark KOT as Ready (via REST API) ───
  const markReady = useCallback(async (kotId: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/kots/${kotId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "READY" }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error("[KDS] Failed to mark KOT ready:", data.message);
      }
    } catch (err) {
      console.error("[KDS] Network error marking KOT ready:", err);
    }
  }, []);

  // ─── Mark KOT as In Progress (via REST API) ───
  const markInProgress = useCallback(async (kotId: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/kots/${kotId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error("[KDS] Failed to mark KOT in-progress:", data.message);
      }
    } catch (err) {
      console.error("[KDS] Network error marking KOT in-progress:", err);
    }
  }, []);

  return {
    connectionStatus,
    markReady,
    markInProgress,
    serverUrl: SERVER_URL,
  };
}
