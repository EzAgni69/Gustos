import { create } from "zustand";
import { calculateCartTotals, type CartItem, type CartTotals, type DiscountConfig, type GSTRate } from "@gusto/core-logic";
import type { POSMenuItem } from "./useMenuStore";

export type OrderMode = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QUICK_BILL";

export interface POSCartItem extends CartItem {
  cartItemId: string; // unique instance id for modifier distinction
  notes?: string;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  loyaltyPoints?: number;
}

export interface HeldBill {
  id: string;
  orderNumber: string;
  orderMode: OrderMode;
  tableId: string | null;
  tableNumber: string | null;
  paxCount: number;
  assignedWaiter: string;
  customer: CustomerInfo | null;
  items: POSCartItem[];
  discount: DiscountConfig | undefined;
  heldAt: Date;
  reason?: string;
}

export interface CartStoreState {
  orderMode: OrderMode;
  tableId: string | null;
  tableNumber: string | null;
  paxCount: number;
  assignedWaiter: string;
  customer: CustomerInfo | null;
  items: POSCartItem[];
  discount: DiscountConfig | undefined;
  heldBills: HeldBill[];

  // Actions
  setOrderMode: (mode: OrderMode, tableId?: string | null, tableNumber?: string | null) => void;
  setPaxCount: (count: number) => void;
  setAssignedWaiter: (waiter: string) => void;
  setCustomer: (customer: CustomerInfo | null) => void;
  addItem: (menuItem: POSMenuItem, modifiers?: string[], notes?: string) => void;
  updateQuantity: (cartItemId: string, delta: number) => void;
  removeItem: (cartItemId: string) => void;
  setItemModifiers: (cartItemId: string, modifiers: string[], notes?: string) => void;
  setDiscount: (discount: DiscountConfig | undefined) => void;
  clearCart: () => void;
  holdCurrentBill: (reason?: string) => void;
  retrieveHeldBill: (heldBillId: string) => void;
  getTotals: () => CartTotals;
}

let cartIdCounter = 1;
let heldIdCounter = 1;

export const useCartStore = create<CartStoreState>((set, get) => ({
  orderMode: "DINE_IN",
  tableId: "table-ac-4",
  tableNumber: "T-04 (AC)",
  paxCount: 4,
  assignedWaiter: "Capt. Rahul",
  customer: null,
  items: [
    // Pre-load a few items for immediate muscle-memory & UI testing
    {
      cartItemId: "seed-1",
      menuItemId: "item-103",
      menuItemName: "Pav Bhaji Butter",
      quantity: 2,
      unitPrice: 180,
      gstRate: "5" as GSTRate,
      modifiers: ["Extra Butter"],
    },
    {
      cartItemId: "seed-2",
      menuItemId: "item-201",
      menuItemName: "Paneer Butter Masala",
      quantity: 1,
      unitPrice: 320,
      gstRate: "5" as GSTRate,
      modifiers: ["Less Spicy"],
    },
    {
      cartItemId: "seed-3",
      menuItemId: "item-303",
      menuItemName: "Butter Naan",
      quantity: 4,
      unitPrice: 65,
      gstRate: "5" as GSTRate,
    },
  ],
  discount: undefined,
  heldBills: [
    {
      id: "HOLD-01",
      orderNumber: "OUT-20260715-0039",
      orderMode: "TAKEAWAY",
      tableId: null,
      tableNumber: null,
      paxCount: 1,
      assignedWaiter: "Counter",
      customer: { name: "Amit Sharma", phone: "9876543210", loyaltyPoints: 140 },
      items: [
        {
          cartItemId: "h-1",
          menuItemId: "item-404",
          menuItemName: "Chicken Dum Biryani",
          quantity: 2,
          unitPrice: 390,
          gstRate: "5",
          modifiers: ["Extra Raita Side"],
        },
      ],
      discount: undefined,
      heldAt: new Date(Date.now() - 14 * 60 * 1000),
      reason: "Waiting for UPI phone",
    },
  ],

  setOrderMode: (mode, tableId = null, tableNumber = null) =>
    set({
      orderMode: mode,
      tableId: mode === "DINE_IN" ? (tableId ?? get().tableId) : null,
      tableNumber: mode === "DINE_IN" ? (tableNumber ?? get().tableNumber) : null,
    }),

  setPaxCount: (count) => set({ paxCount: Math.max(1, count) }),
  setAssignedWaiter: (waiter) => set({ assignedWaiter: waiter }),
  setCustomer: (customer) => set({ customer }),

  addItem: (menuItem, modifiers = [], notes = "") => {
    const { items } = get();
    // Check if item with identical modifiers already exists in cart
    const modString = [...modifiers].sort().join("|") + `|${notes}`;
    const existingIndex = items.findIndex((item) => {
      const itemModStr = [...(item.modifiers || [])].sort().join("|") + `|${item.notes || ""}`;
      return item.menuItemId === menuItem.id && itemModStr === modString;
    });

    if (existingIndex >= 0 && existingIndex < items.length) {
      const updated = [...items];
      const target = updated[existingIndex];
      if (target) {
        updated[existingIndex] = { ...target, quantity: target.quantity + 1 };
        set({ items: updated });
      }
    } else {
      const newItem: POSCartItem = {
        cartItemId: `cart-item-${cartIdCounter++}`,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        quantity: 1,
        unitPrice: menuItem.price,
        gstRate: menuItem.gstRate,
        modifiers,
        notes,
      };
      set({ items: [...items, newItem] });
    }
  },

  updateQuantity: (cartItemId, delta) => {
    const { items } = get();
    const updated = items
      .map((item) => {
        if (item.cartItemId === cartItemId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      })
      .filter((item): item is POSCartItem => item !== null);

    set({ items: updated });
  },

  removeItem: (cartItemId) => {
    set({ items: get().items.filter((item) => item.cartItemId !== cartItemId) });
  },

  setItemModifiers: (cartItemId, modifiers, notes) => {
    set({
      items: get().items.map((item) =>
        item.cartItemId === cartItemId ? { ...item, modifiers, notes } : item
      ),
    });
  },

  setDiscount: (discount) => set({ discount }),

  clearCart: () =>
    set({
      items: [],
      discount: undefined,
      customer: null,
    }),

  holdCurrentBill: (reason = "Customer parked") => {
    const { items, orderMode, tableId, tableNumber, paxCount, assignedWaiter, customer, discount, heldBills } =
      get();
    if (items.length === 0) return;

    const newHeld: HeldBill = {
      id: `HOLD-0${heldIdCounter++}`,
      orderNumber: `OUT-20260715-004${heldIdCounter + 1}`,
      orderMode,
      tableId,
      tableNumber,
      paxCount,
      assignedWaiter,
      customer,
      items: [...items],
      discount,
      heldAt: new Date(),
      reason,
    };

    set({
      heldBills: [newHeld, ...heldBills],
      items: [],
      discount: undefined,
      customer: null,
    });
  },

  retrieveHeldBill: (heldBillId) => {
    const { heldBills, items, orderMode, tableId, tableNumber, paxCount, assignedWaiter, customer, discount } =
      get();
    const target = heldBills.find((b) => b.id === heldBillId);
    if (!target) return;

    // If current cart has items, hold it first automatically so we don't lose anything
    let updatedHeld = heldBills.filter((b) => b.id !== heldBillId);
    if (items.length > 0) {
      const autoHold: HeldBill = {
        id: `HOLD-0${heldIdCounter++}`,
        orderNumber: `OUT-20260715-004${heldIdCounter + 1}`,
        orderMode,
        tableId,
        tableNumber,
        paxCount,
        assignedWaiter,
        customer,
        items: [...items],
        discount,
        heldAt: new Date(),
        reason: "Auto-held during retrieval",
      };
      updatedHeld = [autoHold, ...updatedHeld];
    }

    set({
      heldBills: updatedHeld,
      orderMode: target.orderMode,
      tableId: target.tableId,
      tableNumber: target.tableNumber,
      paxCount: target.paxCount,
      assignedWaiter: target.assignedWaiter,
      customer: target.customer,
      items: target.items,
      discount: target.discount,
    });
  },

  getTotals: () => {
    const { items, discount } = get();
    // Convert POSCartItem to CartItem expected by @gusto/core-logic
    const coreItems: CartItem[] = items.map((i) => ({
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      gstRate: i.gstRate,
      modifiers: i.modifiers,
    }));
    return calculateCartTotals(coreItems, discount);
  },
}));
