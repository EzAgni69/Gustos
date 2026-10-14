import { create } from "zustand";
import { apiClient } from "../api/client";

export interface Shift {
  id: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  status: "OPEN" | "CLOSED";
}

export interface ShiftReport {
  shift: Shift;
  totalCashSales: number;
  totalCardSales: number;
  totalUpiSales: number;
  totalOnlineSales: number;
  totalSplitSales: number;
  totalOrders: number;
  totalDiscounts: number;
  totalTips: number;
  expectedCashInDrawer: number;
  actualCashInDrawer: number;
  cashVariance: number;
}

interface ShiftState {
  activeShift: Shift | null;
  shiftWarning: string | null;
  isLoading: boolean;
  error: string | null;
  
  fetchActiveShift: () => Promise<void>;
  openShift: (cashierId: string, cashierName: string, openingFloat: number) => Promise<Shift>;
  closeShift: (actualCashInDrawer: number, notes?: string) => Promise<ShiftReport>;
  generateXReport: () => Promise<ShiftReport>;
  fetchShiftWarning: () => Promise<void>;
}

export const useShiftStore = create<ShiftState>((set, get) => ({
  activeShift: null,
  shiftWarning: null,
  isLoading: false,
  error: null,

  fetchActiveShift: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await apiClient<{ success: boolean; data: Shift | null }>("/shifts/active");
      if (res.success) {
        set({ activeShift: res.data, isLoading: false });
        if (res.data) {
          set({ shiftWarning: null });
        }
      }
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  openShift: async (cashierId, cashierName, openingFloat) => {
    set({ isLoading: true, error: null });
    try {
      const res = await apiClient<{ success: boolean; data: Shift }>("/shifts/open", {
        method: "POST",
        body: JSON.stringify({ cashierId, cashierName, openingFloat }),
      });
      if (res.success) {
        set({ activeShift: res.data, shiftWarning: null, isLoading: false });
        return res.data;
      }
      throw new Error("Failed to open shift");
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      throw err;
    }
  },

  closeShift: async (actualCashInDrawer, notes) => {
    const { activeShift } = get();
    if (!activeShift) throw new Error("No active shift to close");

    set({ isLoading: true, error: null });
    try {
      const res = await apiClient<{ success: boolean; data: ShiftReport }>(`/shifts/${activeShift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ actualCashInDrawer, notes }),
      });
      if (res.success) {
        set({ activeShift: null, isLoading: false });
        await get().fetchShiftWarning();
        return res.data;
      }
      throw new Error("Failed to close shift");
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      throw err;
    }
  },

  generateXReport: async () => {
    const { activeShift } = get();
    if (!activeShift) throw new Error("No active shift");

    set({ isLoading: true, error: null });
    try {
      const res = await apiClient<{ success: boolean; data: ShiftReport }>(`/shifts/${activeShift.id}/x-report`);
      if (res.success) {
        set({ isLoading: false });
        return res.data;
      }
      throw new Error("Failed to generate X-Report");
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      throw err;
    }
  },

  fetchShiftWarning: async () => {
    try {
      const res = await apiClient<{ success: boolean; data: { warning: string | null; hasActiveShift: boolean } }>("/shifts/warning");
      if (res.success) {
        set({ shiftWarning: res.data.warning });
      }
    } catch (err) {
      // Ignore errors for shift warning polling
    }
  },
}));
