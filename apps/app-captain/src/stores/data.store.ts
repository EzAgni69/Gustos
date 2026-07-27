/**
 * Gusto Captain — Data Store
 *
 * Caches server data (tables, menu) and subscribes
 * to Socket.IO events for real-time updates.
 */

import { create } from "zustand";
import type {
  MenuCategoryResponse,
  MenuItemResponse,
  TableResponse,
} from "../services/api";
import {
  getCategories,
  getMenuItems,
  getTables,
} from "../services/api";
import { onSocketEvent } from "../services/socket";
import { SOCKET_EVENTS } from "../config/constants";

interface DataState {
  // Tables
  tables: TableResponse[];
  tablesLoading: boolean;
  fetchTables: () => Promise<void>;

  // Menu
  categories: MenuCategoryResponse[];
  menuItems: MenuItemResponse[];
  menuLoading: boolean;
  selectedCategoryId: string | null;
  fetchMenu: () => Promise<void>;
  selectCategory: (categoryId: string | null) => void;
  getFilteredItems: () => MenuItemResponse[];

  // Socket subscription management
  initSocketListeners: () => () => void;
}

export const useDataStore = create<DataState>()((set, get) => ({
  // ─── Tables ───
  tables: [],
  tablesLoading: false,

  fetchTables: async () => {
    set({ tablesLoading: true });
    try {
      const tables = await getTables();
      set({ tables, tablesLoading: false });
    } catch (err) {
      console.error("[DataStore] Failed to fetch tables:", err);
      set({ tablesLoading: false });
    }
  },

  // ─── Menu ───
  categories: [],
  menuItems: [],
  menuLoading: false,
  selectedCategoryId: null,

  fetchMenu: async () => {
    set({ menuLoading: true });
    try {
      const [categories, menuItems] = await Promise.all([
        getCategories(),
        getMenuItems(),
      ]);
      set({ categories, menuItems, menuLoading: false });
    } catch (err) {
      console.error("[DataStore] Failed to fetch menu:", err);
      set({ menuLoading: false });
    }
  },

  selectCategory: (categoryId) => set({ selectedCategoryId: categoryId }),

  getFilteredItems: () => {
    const { menuItems, selectedCategoryId } = get();
    if (!selectedCategoryId) return menuItems;
    return menuItems.filter((item) => item.categoryId === selectedCategoryId);
  },

  // ─── Socket Listeners ───

  initSocketListeners: () => {
    const unsub1 = onSocketEvent(
      SOCKET_EVENTS.TABLE_STATUS_CHANGED,
      (data: unknown) => {
        const event = data as { tableId: string; status: string; orderId?: string; orderNumber?: string };
        set((state) => ({
          tables: state.tables.map((table) =>
            table.id === event.tableId
              ? { ...table, status: event.status as TableResponse["status"] }
              : table
          ),
        }));
      }
    );

    const unsub2 = onSocketEvent(
      SOCKET_EVENTS.ORDER_UPDATED,
      (_data: unknown) => {
        // Refetch tables when orders change to get updated currentOrder
        get().fetchTables();
      }
    );

    // Return cleanup function
    return () => {
      unsub1();
      unsub2();
    };
  },
}));
