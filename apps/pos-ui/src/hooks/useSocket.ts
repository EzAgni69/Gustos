import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useUIStore } from "../store/useUIStore";
import { useTableStore, type TableStatus } from "../store/useTableStore";
import { useCartStore } from "../store/useCartStore";

const socketUrl = (import.meta as any).env?.VITE_API_URL?.replace("/api", "") || "http://localhost:8080";
const socket: Socket = io(socketUrl, {
  autoConnect: false,
});

export const getSocket = (): Socket => socket;

export const useSocket = (): Socket => {
  const { setOnlineStatus, openOnlineOrderModal } = useUIStore();
  const { fetchTables, setTableStatus, setTableLock } = useTableStore();
  const { activeOrderId, retrieveHeldBill } = useCartStore();

  useEffect(() => {
    socket.connect();

    socket.on("connect", () => {
      setOnlineStatus(true);
    });

    socket.on("disconnect", () => {
      setOnlineStatus(false);
    });

    socket.on("table:status-changed", (data: { tableId: string; status: TableStatus }) => {
      // Optimistically update or fetch tables again
      fetchTables();
    });

    socket.on("online-order:received", (data: any) => {
      openOnlineOrderModal(data);
    });

    socket.on("order:updated", (data: { orderId: string; status: string }) => {
      if (activeOrderId === data.orderId) {
        // If the active order was updated (e.g., from captain app), retrieve it to refresh
        retrieveHeldBill(data.orderId);
      }
    });

    socket.on("kot:status-update", (data: { kotId: string; status: string; orderId: string }) => {
      if (activeOrderId === data.orderId) {
        // If a KOT for the active order is updated (e.g. READY), fetch it again
        retrieveHeldBill(data.orderId);
      }
    });

    socket.on("table:locks-sync", (locks: [string, string][]) => {
      locks.forEach(([tableId, lockedBy]) => {
        setTableLock(tableId, lockedBy);
      });
    });

    socket.on("table:locked", (data: { tableId: string; lockedBy: string }) => {
      setTableLock(data.tableId, data.lockedBy);
    });

    socket.on("table:unlocked", (data: { tableId: string }) => {
      setTableLock(data.tableId, undefined);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("table:status-changed");
      socket.off("online-order:received");
      socket.off("order:updated");
      socket.off("kot:status-update");
      socket.off("table:locks-sync");
      socket.off("table:locked");
      socket.off("table:unlocked");
      socket.disconnect();
    };
  }, [setOnlineStatus, fetchTables, activeOrderId, retrieveHeldBill, setTableLock, openOnlineOrderModal]);

  return socket;
};
