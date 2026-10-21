import { create } from "zustand";
import { apiClient } from "../api/client";

interface QueueStatus {
  pending: number;
  printing: number;
  failed: number;
  completed: number;
}

interface PrinterState {
  status: QueueStatus | null;
  isLoading: boolean;
  isRetrying: boolean;
  
  fetchQueueStatus: () => Promise<void>;
  retryFailedJobs: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollingInterval: number | null = null;

export const usePrinterStore = create<PrinterState>((set, get) => ({
  status: null,
  isLoading: false,
  isRetrying: false,

  fetchQueueStatus: async () => {
    try {
      const res = await apiClient<{ success: boolean; data: QueueStatus }>("/print/queue-status");
      if (res.success) {
        set({ status: res.data });
      }
    } catch (err) {
      // Ignore poll errors
    }
  },

  retryFailedJobs: async () => {
    set({ isRetrying: true });
    try {
      const res = await apiClient<{ success: boolean; data: QueueStatus }>("/print/retry", {
        method: "POST",
      });
      if (res.success && res.data) {
        set({ status: res.data });
      } else {
        await get().fetchQueueStatus();
      }
    } catch (err) {
      // Ignore errors
    } finally {
      set({ isRetrying: false });
    }
  },

  startPolling: () => {
    if (pollingInterval) return;
    get().fetchQueueStatus();
    pollingInterval = window.setInterval(() => {
      get().fetchQueueStatus();
    }, 10000);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },
}));
