"use client";

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useToast } from "@/lib/toast";
import { apiFetch } from "@/lib/api-client";
import { getPersistedOutletId } from "@/lib/outlet-context";

export interface SyncUpdateData {
  eventType: string;
  organizationId?: string;
  outletId?: string;
  payload: any;
  timestamp?: string;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  lastSyncEvent: SyncUpdateData | null;
  currentOutletId: string | null;
  setOutletId: (outletId: string | null) => void;
  subscribe: (eventType: string, callback: (data: SyncUpdateData) => void) => () => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  lastSyncEvent: null,
  currentOutletId: null,
  setOutletId: () => {},
  subscribe: () => () => {},
});

function getSocketServerUrl(): string {
  if (typeof window === "undefined") {
    return process.env.API_GATEWAY_URL || "http://localhost:3001";
  }

  // 1. Explicit socket URL
  const explicitSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (explicitSocketUrl && explicitSocketUrl.trim() !== "") {
    return explicitSocketUrl.trim().replace(/\/+$/, "");
  }

  // 2. Derive from NEXT_PUBLIC_API_URL
  const envApiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envApiUrl && envApiUrl.trim() !== "") {
    return envApiUrl.trim().replace(/\/+$/, "").replace(/\/api\/v1\/?$/, "");
  }

  // 3. Fallback to localhost:3001
  return "http://localhost:3001";
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastSyncEvent, setLastSyncEvent] = useState<SyncUpdateData | null>(null);
  const [currentOutletId, setCurrentOutletId] = useState<string | null>(null);
  const organizationIdRef = useRef<string | null>(null);
  const listenersRef = useRef<Map<string, Set<(data: SyncUpdateData) => void>>>(new Map());

  // Initialize outlet and organization
  useEffect(() => {
    const savedOutlet = getPersistedOutletId();
    if (savedOutlet && savedOutlet !== "all") {
      setCurrentOutletId(savedOutlet);
    }

    const fetchUserProfile = async () => {
      try {
        const res = await apiFetch<{ organizationId: string; outletId?: string }>("/auth/me");
        if (res.success && res.data) {
          organizationIdRef.current = res.data.organizationId;
          if (!currentOutletId && res.data.outletId) {
            setCurrentOutletId(res.data.outletId);
          }
        }
      } catch (err) {
        console.warn("[Realtime Socket] Could not load user profile for socket room:", err);
      }
    };
    fetchUserProfile();
  }, []);

  // Initialize socket connection
  useEffect(() => {
    const serverUrl = getSocketServerUrl();
    console.log(`[Realtime Socket] Connecting to Cloud ERP Socket at ${serverUrl}`);

    const newSocket = io(serverUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    newSocket.on("connect", () => {
      console.log(`[Realtime Socket] ✅ Connected to Cloud ERP Socket (id: ${newSocket.id})`);
      setIsConnected(true);

      // Join room for this organization / outlet
      const orgId = organizationIdRef.current || "00000000-0000-0000-0000-000000000001";
      const outletId = currentOutletId || undefined;
      newSocket.emit("join:store", {
        organizationId: orgId,
        outletId,
      });
    });

    newSocket.on("disconnect", (reason) => {
      console.log(`[Realtime Socket] ⚠️ Disconnected: ${reason}`);
      setIsConnected(false);
    });

    newSocket.on("cloud:sync_update", (data: SyncUpdateData) => {
      console.log(`[Realtime Socket] ⚡ Received cloud:sync_update:`, data);
      setLastSyncEvent(data);

      // Trigger specific listeners
      const eventType = data?.eventType;
      if (eventType && listenersRef.current.has(eventType)) {
        listenersRef.current.get(eventType)?.forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[Realtime Socket] Listener error for ${eventType}:`, e);
          }
        });
      }

      // Trigger wildcard listeners
      if (listenersRef.current.has("*")) {
        listenersRef.current.get("*")?.forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[Realtime Socket] Wildcard listener error:`, e);
          }
        });
      }

      // Show toast alerts for important events
      if (eventType === "ORDER_COMPLETED") {
        const orderNum = data.payload?.orderNumber || data.payload?.orderId?.slice(0, 8);
        toast({
          title: `Order #${orderNum} Completed`,
          description: "Sync from POS received and processed successfully.",
          variant: "success",
        });
      } else if (eventType === "ORDER_CREATED") {
        const orderNum = data.payload?.orderNumber || data.payload?.orderId?.slice(0, 8);
        toast({
          title: `New Order Placed (#${orderNum})`,
          description: "A new order was placed at the POS.",
          variant: "default",
        });
      } else if (eventType === "ORDER_CANCELLED") {
        const orderNum = data.payload?.orderNumber || data.payload?.orderId?.slice(0, 8);
        toast({
          title: `Order #${orderNum} Cancelled`,
          description: "Order was cancelled at the POS.",
          variant: "error",
        });
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // When currentOutletId changes, rejoin room
  useEffect(() => {
    if (socket?.connected && currentOutletId) {
      const orgId = organizationIdRef.current || "00000000-0000-0000-0000-000000000001";
      console.log(`[Realtime Socket] Re-joining store room: ${currentOutletId}`);
      socket.emit("join:store", {
        organizationId: orgId,
        outletId: currentOutletId,
      });
    }
  }, [currentOutletId, socket]);

  const setOutletId = useCallback((outletId: string | null) => {
    setCurrentOutletId(outletId);
  }, []);

  const subscribe = useCallback((eventType: string, callback: (data: SyncUpdateData) => void) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType)?.add(callback);

    return () => {
      listenersRef.current.get(eventType)?.delete(callback);
    };
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        lastSyncEvent,
        currentOutletId,
        setOutletId,
        subscribe,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useRealtimeSocket() {
  return useContext(SocketContext);
}

/**
 * Hook to run a callback whenever specific real-time sync events arrive from POS / Cloud ERP
 */
export function useRealtimeEvent(
  events: string | string[],
  callback: (data: SyncUpdateData) => void
) {
  const { subscribe } = useRealtimeSocket();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const eventList = Array.isArray(events) ? events : [events];
    const unsubscribes = eventList.map((ev) =>
      subscribe(ev, (data) => {
        callbackRef.current(data);
      })
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [events, subscribe]);
}
