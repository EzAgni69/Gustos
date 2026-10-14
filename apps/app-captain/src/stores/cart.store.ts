/**
 * Gusto Captain — Cart Store
 *
 * Manages the cart (items being assembled before order creation)
 * and a queue of pending orders for offline resilience.
 * Persisted to AsyncStorage so orders aren't lost in Wi-Fi dead zones.
 *
 * Cart items are keyed by a composite key (menuItemId + variantName)
 * so that the same item with different variants creates separate lines.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { asyncStorageAdapter } from "../lib/storage";
import type { MenuItemResponse, AddItemInput, AddItemAddOn } from "../services/api";

export interface CartItemAddOn {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CartItem {
  /** Composite key: menuItemId or menuItemId::variantName */
  cartKey: string;
  menuItemId: string;
  menuItemName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  gstRate: string;
  isVeg: boolean;
  modifiers: string[];
  addOns: CartItemAddOn[];
  notes: string;
}

/** Build a composite key for cart deduplication */
export function buildCartKey(menuItemId: string, variantName?: string): string {
  return variantName ? `${menuItemId}::${variantName}` : menuItemId;
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
  /** Add or update an item with full customization (variant, add-ons, modifiers, notes) */
  upsertItem: (params: {
    menuItem: MenuItemResponse;
    variantName?: string;
    variantPrice?: number;
    quantity: number;
    modifiers: string[];
    addOns: CartItemAddOn[];
    notes: string;
  }) => void;
  removeItem: (cartKey: string) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  setItemModifiers: (cartKey: string, modifiers: string[]) => void;
  setItemAddOns: (cartKey: string, addOns: CartItemAddOn[]) => void;
  setItemNotes: (cartKey: string, notes: string) => void;

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
        const cartKey = buildCartKey(menuItem.id);
        const existing = items.find((i) => i.cartKey === cartKey);

        if (existing) {
          set({
            items: items.map((i) =>
              i.cartKey === cartKey
                ? { ...i, quantity: i.quantity + 1 }
                : i
            ),
          });
        } else {
          set({
            items: [
              ...items,
              {
                cartKey,
                menuItemId: menuItem.id,
                menuItemName: menuItem.name,
                variantName: "",
                quantity: 1,
                unitPrice: menuItem.price,
                gstRate: menuItem.gstRate,
                isVeg: menuItem.isVeg,
                modifiers: [],
                addOns: [],
                notes: "",
              },
            ],
          });
        }
      },

      upsertItem: ({ menuItem, variantName, variantPrice, quantity, modifiers, addOns, notes }) => {
        const { items } = get();
        const cartKey = buildCartKey(menuItem.id, variantName);
        const existing = items.find((i) => i.cartKey === cartKey);

        if (existing) {
          // Update existing line
          set({
            items: items.map((i) =>
              i.cartKey === cartKey
                ? {
                    ...i,
                    quantity,
                    unitPrice: variantPrice ?? menuItem.price,
                    modifiers,
                    addOns,
                    notes,
                  }
                : i
            ),
          });
        } else if (quantity > 0) {
          // Add new line
          set({
            items: [
              ...items,
              {
                cartKey,
                menuItemId: menuItem.id,
                menuItemName: menuItem.name,
                variantName: variantName || "",
                quantity,
                unitPrice: variantPrice ?? menuItem.price,
                gstRate: menuItem.gstRate,
                isVeg: menuItem.isVeg,
                modifiers,
                addOns,
                notes,
              },
            ],
          });
        }
      },

      removeItem: (cartKey) => {
        set({ items: get().items.filter((i) => i.cartKey !== cartKey) });
      },

      updateQuantity: (cartKey, quantity) => {
        if (quantity <= 0) {
          get().removeItem(cartKey);
          return;
        }
        set({
          items: get().items.map((i) =>
            i.cartKey === cartKey ? { ...i, quantity } : i
          ),
        });
      },

      setItemModifiers: (cartKey, modifiers) => {
        set({
          items: get().items.map((i) =>
            i.cartKey === cartKey ? { ...i, modifiers } : i
          ),
        });
      },

      setItemAddOns: (cartKey, addOns) => {
        set({
          items: get().items.map((i) =>
            i.cartKey === cartKey ? { ...i, addOns } : i
          ),
        });
      },

      setItemNotes: (cartKey, notes) => {
        set({
          items: get().items.map((i) =>
            i.cartKey === cartKey ? { ...i, notes } : i
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
        get().items.reduce((sum, i) => {
          let lineTotal = i.unitPrice * i.quantity;
          // Include add-on costs
          for (const addon of i.addOns) {
            lineTotal += addon.unitPrice * addon.quantity * i.quantity;
          }
          return sum + lineTotal;
        }, 0),

      toAddItemInputs: (): AddItemInput[] =>
        get().items.map((item) => {
          // Build add-on inputs with calculated amount
          const addOnInputs: AddItemAddOn[] | undefined =
            item.addOns.length > 0
              ? item.addOns.map((a) => ({
                  name: a.name,
                  quantity: a.quantity,
                  unitPrice: a.unitPrice,
                  amount: Math.round(a.unitPrice * a.quantity * 100) / 100,
                }))
              : undefined;

          return {
            menuItemId: item.menuItemId,
            menuItemName: item.menuItemName,
            variantName: item.variantName || undefined,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            gstRate: item.gstRate,
            modifiers: item.modifiers.length > 0 ? item.modifiers : undefined,
            addOns: addOnInputs,
            notes: item.notes || undefined,
          };
        }),
    }),
    {
      name: "gusto-captain-cart",
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
