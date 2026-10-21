import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useUIStore } from "../store/useUIStore";
import { useTableStore, type TableStatus } from "../store/useTableStore";
import { useCartStore } from "../store/useCartStore";
import { useMenuStore } from "../store/useMenuStore";

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
      socket.emit("join:pos");
    });

    socket.on("disconnect", () => {
      setOnlineStatus(false);
    });

    socket.on("table:status-changed", (data: { tableId: string; status: any; orderId?: string }) => {
      const normalizedStatus: TableStatus = (data.status === "AVAILABLE" || data.status === "VACANT") ? "VACANT" : data.status;
      setTableStatus(data.tableId, normalizedStatus, undefined, undefined, undefined, data.orderId);
      fetchTables();
      const currentCart = useCartStore.getState();
      if (currentCart.orderMode === "DINE_IN" && currentCart.tableId === data.tableId) {
        if (normalizedStatus === "VACANT") {
          currentCart.clearCart();
        } else if (data.orderId && data.orderId !== currentCart.activeOrderId) {
          currentCart.retrieveHeldBill(data.orderId);
        }
      }
    });

    socket.on("online-order:received", (data: any) => {
      openOnlineOrderModal(data);
    });

    socket.on("order:updated", (data: any) => {
      const updatedOrderId = data?.orderId || data?.order?.id;
      const currentCart = useCartStore.getState();
      if (updatedOrderId && currentCart.activeOrderId === updatedOrderId) {
        currentCart.retrieveHeldBill(updatedOrderId);
      }
      fetchTables();
    });

    socket.on("kot:status-update", (data: { kotId: string; status: string; orderId: string }) => {
      const currentCart = useCartStore.getState();
      const targetOrderId = data?.orderId;
      if (targetOrderId && currentCart.activeOrderId === targetOrderId) {
        currentCart.retrieveHeldBill(targetOrderId);
      }
      fetchTables();
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

    socket.on("sync:menu-updated", () => {
      useMenuStore.getState().fetchMenu();
    });

    socket.on("sync:tables-updated", () => {
      fetchTables();
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
      socket.off("sync:menu-updated");
      socket.off("sync:tables-updated");
      socket.disconnect();
    };
  }, [setOnlineStatus, fetchTables, setTableLock, openOnlineOrderModal]);

  return socket;
};
