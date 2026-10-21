import { useEffect } from "react";
import { useUIStore } from "../store/useUIStore";
import { db } from "../lib/db";
import { apiClient } from "../api/client";
import { useCartStore } from "../store/useCartStore";

export const useOfflineSync = () => {
  const { isOnline, showNotification } = useUIStore();
  const { fetchHeldBills } = useCartStore();

  useEffect(() => {
    if (isOnline) {
      processSyncQueue();
    }
  }, [isOnline]);

  const processSyncQueue = async () => {
    const queue = await db.syncQueue.where("status").equals("PENDING").toArray();
    if (queue.length === 0) return;

    showNotification(`🔄 Syncing ${queue.length} offline actions...`);

    for (const item of queue) {
      try {
        if (item.action === "CREATE_ORDER") {
          // Note: When replacing a local orderId with a remote one, we'd need to update mapping.
          // For Phase 1 simplicity, we just send it to backend.
          await apiClient("/orders", { method: "POST", body: JSON.stringify(item.payload) });
        } else if (item.action === "UPDATE_ITEMS") {
          await apiClient(`/orders/${item.orderId}/items`, { method: "POST", body: JSON.stringify(item.payload) });
        } else if (item.action === "HOLD_ORDER") {
          await apiClient(`/orders/${item.orderId}/hold`, { method: "POST", body: JSON.stringify({}) });
        } else if (item.action === "CHECKOUT") {
          await apiClient(`/orders/${item.orderId}/checkout`, { method: "POST", body: JSON.stringify(item.payload) });
        } else if (item.action === "FIRE_KOT") {
          await apiClient(`/orders/${item.orderId}/kot`, { method: "POST", body: JSON.stringify({}) });
        }

        await db.syncQueue.delete(item.id!);
      } catch (err) {
        console.error("Sync item failed", err);
        await db.syncQueue.update(item.id!, { retryCount: item.retryCount + 1, error: String(err) });
      }
    }
    
    fetchHeldBills();
    showNotification("✅ Offline sync completed!");
  };
};
