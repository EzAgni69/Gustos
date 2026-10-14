import { create } from "zustand";
import type { GSTRate } from "@gusto/core-logic";
import { db } from "../lib/db";

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface POSMenuItem {
  id: string;
  categoryId: string;
  name: string;
  shortCode: string; // e.g. "101", "PBB", "C65"
  description?: string;
  variants?: string; // JSON: [{ name: string, price: number }] — null if no sizes
  price: number;
  gstRate: GSTRate;
  isVeg: boolean;
  isAvailable: boolean;
  availableModifiers?: string[];
}

export interface MenuStoreState {
  categories: MenuCategory[];
  items: POSMenuItem[];
  selectedCategoryId: string | null;
  searchQuery: string;
  shortCodeMap: Record<string, POSMenuItem>;

  // Actions
  setSelectedCategory: (categoryId: string | null) => void;
  setSearchQuery: (query: string) => void;
  getItemByShortCode: (code: string) => POSMenuItem | undefined;
  getFilteredItems: () => POSMenuItem[];
  resetSearch: () => void;
  fetchMenu: () => Promise<void>;
}



export const useMenuStore = create<MenuStoreState>((set, get) => ({
  categories: [],
  items: [],
  selectedCategoryId: null,
  searchQuery: "",
  shortCodeMap: {},

  setSelectedCategory: (categoryId) => set({ selectedCategoryId: categoryId }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  resetSearch: () => set({ searchQuery: "" }),

  getItemByShortCode: (code) => {
    const clean = code.trim().toUpperCase();
    return get().shortCodeMap[clean];
  },

  getFilteredItems: () => {
    const { items, selectedCategoryId, searchQuery } = get();
    const query = searchQuery.trim().toLowerCase();

    if (query) {
      return items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.shortCode?.toLowerCase() === query ||
          (item.description && item.description.toLowerCase().includes(query))
      );
    }

    if (selectedCategoryId) {
      return items.filter((item) => item.categoryId === selectedCategoryId);
    }

    return items;
  },

  fetchMenu: async () => {
    try {
      // 1. Load from local IndexedDB first
      const cachedCategories = await db.menuCategories.toArray();
      const cachedItems = await db.menuItems.toArray();

      if (cachedCategories.length > 0 && cachedItems.length > 0) {
        const shortCodeMap = cachedItems.reduce((acc, item) => {
          if (item.shortCode) acc[item.shortCode.toUpperCase()] = item;
          return acc;
        }, {} as Record<string, POSMenuItem>);

        set({
          categories: cachedCategories.sort((a, b) => a.sortOrder - b.sortOrder),
          items: cachedItems,
          shortCodeMap,
          selectedCategoryId: get().selectedCategoryId || (cachedCategories.length > 0 ? cachedCategories[0]?.id : null),
        });
      }

      // 2. Fetch from backend and update local DB
      const { apiClient } = await import("../api/client");
      const [categoriesRes, itemsRes] = await Promise.all([
        apiClient<{ success: boolean; data: MenuCategory[] }>("/menu/categories").catch(() => null),
        apiClient<{ success: boolean; data: POSMenuItem[] }>("/menu/items").catch(() => null),
      ]);

      if (categoriesRes?.success && itemsRes?.success) {
        const categories = categoriesRes.data;
        const items = itemsRes.data;
        
        // Save to DB
        await db.transaction('rw', db.menuCategories, db.menuItems, async () => {
          await db.menuCategories.clear();
          await db.menuCategories.bulkAdd(categories);
          await db.menuItems.clear();
          await db.menuItems.bulkAdd(items);
        });

        const shortCodeMap = items.reduce((acc, item) => {
          if (item.shortCode) acc[item.shortCode.toUpperCase()] = item;
          return acc;
        }, {} as Record<string, POSMenuItem>);

        set({
          categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
          items,
          shortCodeMap,
          selectedCategoryId: get().selectedCategoryId || (categories.length > 0 ? categories[0]?.id : null),
        });
      }
    } catch (err) {
      console.error("Failed to fetch menu", err);
    }
  },
}));
