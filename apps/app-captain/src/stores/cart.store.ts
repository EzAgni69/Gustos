/**
 * Gusto Captain — Cart Store
 *
 * Manages the cart (items being assembled before order creation)
 * and a queue of pending orders for offline resilience.
 * Persisted to AsyncStorage so orders aren't lost in Wi-Fi dead zones.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { asyncStorageAdapter } from "../lib/storage";
import type { MenuItemResponse, AddItemInput } from "../services/api";

export interface CartItem {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: string;
  isVeg: boolean;
  modifiers: string[];
  notes: string;
}

interface CartState {
  // Current cart being assembled
  tableId: string | null;
  tableName: string | null;
  paxCount: number;
  orderNotes: string;
  items: CartItem[];

  // Adding items to an existing order (edit mode)
  existingOrderId: string | null;

  // Actions
  setTable: (tableId: string, tableName: string) => void;
  clearTable: () => void;
  setPaxCount: (count: number) => void;
  setOrderNotes: (notes: string) => void;
  setExistingOrder: (orderId: string) => void;

  addItem: (menuItem: MenuItemResponse) => void;
  removeItem: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, quantity: number) => void;
  setItemModifiers: (menuItemId: string, modifiers: string[]) => void;
  setItemNotes: (menuItemId: string, notes: string) => void;

  clearCart: () => void;

  // Computed
  getItemCount: () => number;
  getSubtotal: () => number;
  toAddItemInputs: () => AddItemInput[];
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      tableId: null,
      tableName: null,
      paxCount: 1,
      orderNotes: "",
      items: [],
      existingOrderId: null,

      setTable: (tableId, tableName) => set({ tableId, tableName }),
      clearTable: () => set({ tableId: null, tableName: null }),
      setPaxCount: (count) => set({ paxCount: Math.max(1, count) }),
      setOrderNotes: (notes) => set({ orderNotes: notes }),
      setExistingOrder: (orderId) => set({ existingOrderId: orderId }),

      addItem: (menuItem) => {
        const { items } = get();
        const existing = items.find((i) => i.menuItemId === menuItem.id);

        if (existing) {
          set({
            items: items.map((i) =>
              i.menuItemId === menuItem.id
                ? { ...i, quantity: i.quantity + 1 }
                : i
            ),
          });
        } else {
          set({
            items: [
              ...items,
              {
                menuItemId: menuItem.id,
                menuItemName: menuItem.name,
                quantity: 1,
                unitPrice: menuItem.price,
                gstRate: menuItem.gstRate,
                isVeg: menuItem.isVeg,
                modifiers: [],
                notes: "",
              },
            ],
          });
        }
      },

      removeItem: (menuItemId) => {
        set({ items: get().items.filter((i) => i.menuItemId !== menuItemId) });
      },

      updateQuantity: (menuItemId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(menuItemId);
          return;
        }
        set({
          items: get().items.map((i) =>
            i.menuItemId === menuItemId ? { ...i, quantity } : i
          ),
        });
      },

      setItemModifiers: (menuItemId, modifiers) => {
        set({
          items: get().items.map((i) =>
            i.menuItemId === menuItemId ? { ...i, modifiers } : i
          ),
        });
      },

      setItemNotes: (menuItemId, notes) => {
        set({
          items: get().items.map((i) =>
            i.menuItemId === menuItemId ? { ...i, notes } : i
          ),
        });
      },

      clearCart: () =>
        set({
          tableId: null,
          tableName: null,
          paxCount: 1,
          orderNotes: "",
          items: [],
          existingOrderId: null,
        }),

      getItemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

      getSubtotal: () =>
        get().items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),

      toAddItemInputs: (): AddItemInput[] =>
        get().items.map((item) => ({
          menuItemId: item.menuItemId,
          menuItemName: item.menuItemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          gstRate: item.gstRate,
          modifiers: item.modifiers.length > 0 ? item.modifiers : undefined,
          notes: item.notes || undefined,
        })),
    }),
    {
      name: "gusto-captain-cart",
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
