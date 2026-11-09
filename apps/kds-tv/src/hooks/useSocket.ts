/**
 * KDS-TV — Socket.IO Connection Hook
 *
 * Manages the WebSocket lifecycle with the local POS server:
 * - Connects and joins the "kitchen" room
 * - Listens for `kot:new` and `kot:status-update` events
 * - On connect, hydrates state by fetching active KOTs via REST
 * - Exposes `markReady()` and `markInProgress()` to update KOT status via REST
 * - On network errors, bumps are queued via `useBumpQueue` for retry on reconnect
 * - Exposes `recallKOT()` to restore a completed KOT back to IN_PROGRESS
 * - Tracks connection status for the UI indicator
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ConnectionStatus,
  KotNewPayload,
  KotStatusUpdatePayload,
  KotCancelledPayload,
  KotModificationPayload,
  KotRushPayload,
  OrderModeChangedPayload,
  KotListItem,
  KotStationStatusPayload,
} from "../types";
import { payloadToKDSKot, listItemToKDSKot } from "./useKOTStore";
import { useBumpQueue } from "./useBumpQueue";
import type { KDSKot } from "../types";

const getInitialServerUrl = (): string => {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const serverParam = params.get("server");
    if (serverParam) return serverParam;

    const stored = localStorage.getItem("gusto_kds_server_url");
    if (stored) return stored;

    // If served directly from the POS local server on port 8080 or /kds
    if (window.location.port === "8080" || window.location.pathname.startsWith("/kds")) {
      return window.location.origin;
    }

    // If loaded on a remote device / tablet over LAN
    if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return `http://${window.location.hostname}:8080`;
    }

    const envUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as Record<string, Record<string, string>>).env
          ?.VITE_POS_SERVER_URL);
    if (envUrl) return envUrl;
  }

  return "http://localhost:8080";
};

const OUTLET_ID =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as Record<string, Record<string, string>>).env
      ?.VITE_OUTLET_ID) ||
  "";

const AUTH_TOKEN =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as Record<string, Record<string, string>>).env
      ?.VITE_AUTH_TOKEN) ||
  "";

interface UseSocketOptions {
  onNewKOT: (kot: KDSKot) => void;
  onStatusUpdate: (kotId: string, status: KDSKot["status"]) => void;
  onHydrate: (kots: KDSKot[]) => void;
  onCancelKOT?: (payload: KotCancelledPayload) => void;
  onModifyKOT?: (payload: KotModificationPayload) => void;
  onRushKOT?: (payload: KotRushPayload) => void;
  onOrderModeChanged?: (payload: OrderModeChangedPayload) => void;
  /** A station marked / recalled its part of a KOT */
  onStationStatus?: (payload: KotStationStatusPayload) => void;
  /** Pass bumped or recalled a whole order (expo:order-ready / expo:order-recalled) */
  onExpoEvent?: (event: "order-ready" | "order-recalled", payload: Record<string, unknown>) => void;
}

/** Authenticated fetch against the POS server (used by the Expo board). */
export async function kdsFetch<T>(serverUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(`${serverUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const data = (await res.json()) as { success: boolean; data: T; message?: string };
  if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
  return data.data;
}

export function useSocket({
  onNewKOT,
  onStatusUpdate,
  onHydrate,
  onCancelKOT,
  onModifyKOT,
  onRushKOT,
  onOrderModeChanged,
  onStationStatus,
  onExpoEvent,
}: UseSocketOptions) {
  const [serverUrl, setServerUrlState] = useState<string>(getInitialServerUrl);
  const socketRef = useRef<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  // ─── Bump Queue (offline resilience) ───
  const { queueLength: bumpQueueLength, enqueue: enqueueBump, flush: flushBumpQueue } = useBumpQueue();

  // Stable refs for callbacks to avoid re-subscribing on every render
  const onNewKOTRef = useRef(onNewKOT);
  const onStatusUpdateRef = useRef(onStatusUpdate);
  const onHydrateRef = useRef(onHydrate);
  const onCancelKOTRef = useRef(onCancelKOT);
  const onModifyKOTRef = useRef(onModifyKOT);
  const onRushKOTRef = useRef(onRushKOT);
  const onOrderModeChangedRef = useRef(onOrderModeChanged);
  const onStationStatusRef = useRef(onStationStatus);
  const onExpoEventRef = useRef(onExpoEvent);

  useEffect(() => {
    onNewKOTRef.current = onNewKOT;
    onStatusUpdateRef.current = onStatusUpdate;
    onHydrateRef.current = onHydrate;
    onCancelKOTRef.current = onCancelKOT;
    onModifyKOTRef.current = onModifyKOT;
    onRushKOTRef.current = onRushKOT;
    onOrderModeChangedRef.current = onOrderModeChanged;
    onStationStatusRef.current = onStationStatus;
    onExpoEventRef.current = onExpoEvent;
  }, [onNewKOT, onStatusUpdate, onHydrate, onCancelKOT, onModifyKOT, onRushKOT, onOrderModeChanged, onStationStatus, onExpoEvent]);

  const setServerUrl = useCallback((url: string) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (typeof window !== "undefined") {
      localStorage.setItem("gusto_kds_server_url", trimmed);
    }
    setServerUrlState(trimmed);
  }, []);

  // ─── Fetch active KOTs from REST API ───
  const fetchActiveKOTs = useCallback(async () => {
    try {
      // Fetch PENDING and IN_PROGRESS KOTs
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (AUTH_TOKEN) {
        headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
      }

      const [pendingRes, inProgressRes] = await Promise.all([
        fetch(`${serverUrl}/api/kots?status=PENDING&outletId=${OUTLET_ID}`, { headers }),
        fetch(`${serverUrl}/api/kots?status=IN_PROGRESS&outletId=${OUTLET_ID}`, { headers }),
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

      // Deduplicate by kotId — PENDING and IN_PROGRESS queries can return overlapping KOTs
      // (e.g. a KOT transitioning between states during the parallel fetch)
      const seen = new Set<string>();
      const uniqueKots = allKots.filter((kot) => {
        if (seen.has(kot.kotId)) return false;
        seen.add(kot.kotId);
        return true;
      });

      onHydrateRef.current(uniqueKots);
    } catch (err) {
      console.error("[KDS] Failed to fetch active KOTs:", err);
    }
  }, [serverUrl]);

  // ─── Socket.IO Connection ───
  useEffect(() => {
    setConnectionStatus("reconnecting");

    const socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ["websocket", "polling"],
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[KDS] Connected to POS server:", socket.id, "at", serverUrl);
      setConnectionStatus("connected");

      // Join the kitchen room
      if (OUTLET_ID) {
        socket.emit("join:kitchen", OUTLET_ID);
      } else {
        socket.emit("join:kitchen");
      }

      // Hydrate with current active KOTs
      fetchActiveKOTs();

      // Flush any pending offline bumps
      flushBumpQueue(serverUrl, AUTH_TOKEN || undefined);
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
      if (OUTLET_ID) {
        socket.emit("join:kitchen", OUTLET_ID);
      } else {
        socket.emit("join:kitchen");
      }
      fetchActiveKOTs();

      // Flush any pending offline bumps on reconnect
      flushBumpQueue(serverUrl, AUTH_TOKEN || undefined);
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

    // ─── Listen for KOT cancellation ───
    socket.on("kot:cancelled", (payload: KotCancelledPayload) => {
      console.log("[KDS] KOT cancelled:", payload.kotNumber, payload.reason);
      onCancelKOTRef.current?.(payload);
    });

    // ─── Listen for RUSH (priority) requests from POS ───
    socket.on("kot:rush", (payload: KotRushPayload) => {
      console.log("[KDS] RUSH KOT:", payload.kotNumber);
      onRushKOTRef.current?.(payload);
    });

    // ─── Order switched dine-in ↔ takeaway ↔ delivery after firing ───
    socket.on("order:mode-changed", (payload: OrderModeChangedPayload) => {
      console.log("[KDS] Order mode changed:", payload.orderNumber, payload.oldMode, "→", payload.newMode);
      onOrderModeChangedRef.current?.(payload);
      // Moving onto a table: re-fetch to pick up the new table name
      if (payload.newMode === "DINE_IN") fetchActiveKOTs();
    });

    // ─── Listen for KOT modification ───
    socket.on("kot:modification", (payload: KotModificationPayload) => {
      console.log("[KDS] KOT modification received:", payload.kotNumber);
      onModifyKOTRef.current?.(payload);
    });

    // ─── Station readiness (multi-station KOTs) ───
    socket.on("kot:station-status", (payload: KotStationStatusPayload) => {
      onStationStatusRef.current?.(payload);
    });

    // ─── Expo / pass ───
    socket.on("expo:order-ready", (payload: Record<string, unknown>) => {
      onExpoEventRef.current?.("order-ready", payload);
    });
    socket.on("expo:order-recalled", (payload: Record<string, unknown>) => {
      onExpoEventRef.current?.("order-recalled", payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // Only reconnect when serverUrl changes — fetchActiveKOTs and flushBumpQueue
    // are accessed via refs to avoid triggering reconnection loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  // ─── Mark KOT as Ready (via REST API) — with offline bump queue ───
  const markReady = useCallback(async (kotId: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (AUTH_TOKEN) {
        headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
      }
      
      const res = await fetch(`${serverUrl}/api/kots/${kotId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "READY" }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error("[KDS] Failed to mark KOT ready:", data.message);
      }
    } catch (err) {
      console.error("[KDS] Network error marking KOT ready, queuing offline:", err);
      enqueueBump(kotId, "READY");
    }
  }, [serverUrl, enqueueBump]);

  // ─── Mark KOT as In Progress (via REST API) — with offline bump queue ───
  const markInProgress = useCallback(async (kotId: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (AUTH_TOKEN) {
        headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
      }
      
      const res = await fetch(`${serverUrl}/api/kots/${kotId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error("[KDS] Failed to mark KOT in-progress:", data.message);
      }
    } catch (err) {
      console.error("[KDS] Network error marking KOT in-progress, queuing offline:", err);
      enqueueBump(kotId, "IN_PROGRESS");
    }
  }, [serverUrl, enqueueBump]);

  // ─── Recall KOT (restore from history → IN_PROGRESS via REST API) ───
  const recallKOT = useCallback(async (kotId: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (AUTH_TOKEN) {
        headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
      }
      
      const res = await fetch(`${serverUrl}/api/kots/${kotId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error("[KDS] Failed to recall KOT:", data.message);
      }
    } catch (err) {
      console.error("[KDS] Network error recalling KOT, queuing offline:", err);
      enqueueBump(kotId, "IN_PROGRESS");
    }
  }, [serverUrl, enqueueBump]);

  // ─── Station-scoped bump: this station finished its part of the KOT ───
  const markStationReady = useCallback(async (kotId: string, stationId: string) => {
    try {
      await kdsFetch(serverUrl, `/api/kots/${kotId}/stations/${stationId}/ready`, { method: "POST" });
    } catch (err) {
      if (err instanceof TypeError) {
        console.error("[KDS] Network error on station bump, queuing offline:", err);
        enqueueBump(kotId, "READY", stationId);
      } else {
        console.error("[KDS] Station bump rejected:", err);
      }
    }
  }, [serverUrl, enqueueBump]);

  // ─── Station-scoped recall (from history) ───
  const recallStation = useCallback(async (kotId: string, stationId: string) => {
    try {
      await kdsFetch(serverUrl, `/api/kots/${kotId}/stations/${stationId}/recall`, { method: "POST" });
    } catch (err) {
      if (err instanceof TypeError) {
        console.error("[KDS] Network error on station recall, queuing offline:", err);
        enqueueBump(kotId, "IN_PROGRESS", stationId);
      } else {
        console.error("[KDS] Station recall rejected:", err);
      }
    }
  }, [serverUrl, enqueueBump]);

  return {
    connectionStatus,
    markReady,
    markInProgress,
    recallKOT,
    markStationReady,
    recallStation,
    /** Re-fetch active KOTs from the server (source of truth) */
    refresh: fetchActiveKOTs,
    serverUrl,
    setServerUrl,
    bumpQueueLength,
  };
}
