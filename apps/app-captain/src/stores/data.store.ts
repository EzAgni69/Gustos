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
  getBaseUrl,
} from "../services/api";
import { onSocketEvent } from "../services/socket";
import { SOCKET_EVENTS } from "../config/constants";
import { DeviceEventEmitter } from "react-native";
import * as Haptics from "expo-haptics";

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
    if (!getBaseUrl()) return;
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
    if (!getBaseUrl()) return;
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
      (data: unknown) => {
        // Refetch tables when orders change to get updated currentOrder
        get().fetchTables();
        DeviceEventEmitter.emit("orderUpdated", data);
      }
    );

    const unsub3 = onSocketEvent(
      SOCKET_EVENTS.KOT_NEW,
      (data: unknown) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        DeviceEventEmitter.emit("kotUpdated", data);
      }
    );

    const unsub4 = onSocketEvent(
      SOCKET_EVENTS.KOT_STATUS_UPDATE,
      (data: unknown) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        DeviceEventEmitter.emit("kotUpdated", data);
      }
    );

    const unsub5 = onSocketEvent(
      SOCKET_EVENTS.SYNC_MENU_UPDATED,
      () => {
        get().fetchMenu();
      }
    );

    const unsub6 = onSocketEvent(
      SOCKET_EVENTS.SYNC_TABLES_UPDATED,
      () => {
        get().fetchTables();
      }
    );

    // Return cleanup function
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
      unsub6();
    };
  },
}));
