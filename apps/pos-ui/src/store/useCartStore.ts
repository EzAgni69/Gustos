import { create } from "zustand";
import { calculateCartTotals, type CartItem, type CartItemAddOn, type CartTotals, type DiscountConfig, type GSTRate } from "@gusto/core-logic";
import type { POSMenuItem } from "./useMenuStore";
import { apiClient } from "../api/client";
import { db } from "../lib/db";

export type OrderMode = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QUICK_BILL";

export interface POSCartItem extends CartItem {
  cartItemId: string; // unique instance id for modifier distinction, maps to backend id if saved
  variantName?: string;
  addOns?: CartItemAddOn[];
  notes?: string;
  isSaved?: boolean;
}

export interface CustomerInfo {
  id?: string;
  name: string;
  phone: string;
  loyaltyPoints?: number;
}

export interface HeldBill {
  id: string; // This will map to the backend order.id
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
  activeOrderId: string | null; // Track if we are editing an existing backend order
  orderNumber: string | null;
  orderMode: OrderMode;
  tableId: string | null;
  tableNumber: string | null;
  paxCount: number;
  assignedWaiter: string;
  customer: CustomerInfo | null;
  items: POSCartItem[];
  discount: DiscountConfig | undefined;
  isProcessingPayment: boolean;
  
  // Modals use this
  heldBills: HeldBill[];

  // Actions
  setOrderMode: (mode: OrderMode, tableId?: string | null, tableNumber?: string | null) => void;
  setPaxCount: (count: number) => void;
  setAssignedWaiter: (waiter: string) => void;
  setCustomer: (customer: CustomerInfo | null) => void;
  addItem: (menuItem: POSMenuItem, modifiers?: string[], notes?: string) => void;
  addItemWithCustomization: (params: {
    menuItem: POSMenuItem;
    variantName?: string;
    variantPrice?: number;
    quantity: number;
    modifiers: string[];
    addOns: CartItemAddOn[];
    notes: string;
  }) => void;
  updateQuantity: (cartItemId: string, delta: number) => void;
  removeItem: (cartItemId: string) => void;
  setItemModifiers: (cartItemId: string, modifiers: string[], notes?: string) => void;
  setDiscount: (discount: DiscountConfig | undefined) => void;
  clearCart: () => void;
  
  // Split Bill Actions
  splitItemQuantity: (cartItemId: string, splitQuantity: number) => Promise<void>;
  moveItemsToNewOrder: (cartItemIds: string[]) => Promise<{ success: boolean; newOrderId?: string; error?: string }>;
  
  // Async Actions
  syncOrderToBackend: (reason?: string) => Promise<string | null>;
  holdCurrentBill: (reason?: string) => Promise<void>;
  fetchHeldBills: () => Promise<void>;
  retrieveHeldBill: (heldBillId: string) => Promise<void>;
  loadTableOrder: (tableId: string, tableNumber?: string, orderId?: string) => Promise<boolean>;
  fireKOT: () => Promise<void>;
  checkoutOrder: (payload: {
    paymentMode: string;
    paymentSubMethod?: string;
    paymentSplits?: { mode: string; subMethod?: string; amount: number; reference?: string }[];
    tipAmount?: number;
    tenderedAmount?: number;
    changeDue?: number;
  }) => Promise<{ success: boolean; printed: boolean; invoiceNumber?: string; error?: string }>;
  getTotals: () => CartTotals;
}

let cartIdCounter = 1;

function safeParseJson<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (Array.isArray(val) || (typeof val === "object" && val !== null)) return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export const useCartStore = create<CartStoreState>((set, get) => ({
  activeOrderId: null,
  orderNumber: null,
  orderMode: "DINE_IN",
  tableId: null,
  tableNumber: null,
  paxCount: 1,
  assignedWaiter: "Counter",
  customer: null,
  items: [],
  discount: undefined,
  isProcessingPayment: false,
  heldBills: [],

  setOrderMode: (mode, tableId = null, tableNumber = null) => {
    const oldTableId = get().tableId;
    const newTableId = mode === "DINE_IN" ? (tableId ?? get().tableId) : null;
    
    if (oldTableId && oldTableId !== newTableId) {
      import("../hooks/useSocket").then(({ getSocket }) => {
        getSocket().emit("table:unlock", { tableId: oldTableId });
      }).catch(() => {});
    }

    set({
      orderMode: mode,
      tableId: newTableId,
      tableNumber: mode === "DINE_IN" ? (tableNumber ?? get().tableNumber) : null,
    });
  },

  setPaxCount: (count) => set({ paxCount: Math.max(1, count) }),
  setAssignedWaiter: (waiter) => set({ assignedWaiter: waiter }),
  setCustomer: (customer) => {
    set({ customer });
    const { activeOrderId } = get();
    if (activeOrderId && customer) {
      apiClient(`/orders/${activeOrderId}/customer`, {
        method: "PATCH",
        body: JSON.stringify(customer)
      }).catch(console.error);
    }
  },

  addItem: (menuItem, modifiers = [], notes = "") => {
    const { items } = get();
    // For unsaved items, check if identical modifiers exist
    const modString = [...modifiers].sort().join("|") + `|${notes}`;
    const existingIndex = items.findIndex((item) => {
      if (item.isSaved) return false; // Don't merge with saved items
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
        cartItemId: `local-${cartIdCounter++}`,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        quantity: 1,
        unitPrice: menuItem.price,
        gstRate: menuItem.gstRate,
        modifiers,
        notes,
        isSaved: false,
      };
      set({ items: [...items, newItem] });
    }
  },

  addItemWithCustomization: ({ menuItem, variantName, variantPrice, quantity, modifiers, addOns, notes }) => {
    const { items } = get();
    const newItem: POSCartItem = {
      cartItemId: `local-${cartIdCounter++}`,
      menuItemId: menuItem.id,
      menuItemName: variantName ? `${menuItem.name} (${variantName})` : menuItem.name,
      variantName,
      quantity,
      unitPrice: variantPrice ?? menuItem.price,
      gstRate: menuItem.gstRate,
      modifiers,
      addOns: addOns.length > 0 ? addOns : undefined,
      notes,
      isSaved: false,
    };
    set({ items: [...items, newItem] });
  },
  updateQuantity: (cartItemId, delta) => {
    const { items, activeOrderId } = get();
    const item = items.find(i => i.cartItemId === cartItemId);
    if (!item) return;

    if (item.isSaved && activeOrderId) {
      // Async update to backend
      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        apiClient(`/orders/${activeOrderId}/items/${item.cartItemId}`, { method: "DELETE" })
          .then(() => get().retrieveHeldBill(activeOrderId))
          .catch(console.error);
      } else {
        apiClient(`/orders/${activeOrderId}/items/${item.cartItemId}`, {
          method: "PATCH",
          body: JSON.stringify({ quantity: newQty }),
        })
          .then(() => get().retrieveHeldBill(activeOrderId))
          .catch(console.error);
      }
      
      // Optimistic update
      const updated = items.map((i) => {
        if (i.cartItemId === cartItemId) {
          return newQty > 0 ? { ...i, quantity: newQty } : null;
        }
        return i;
      }).filter((i): i is POSCartItem => i !== null);
      set({ items: updated });
    } else {
      // Local update
      const updated = items.map((i) => {
        if (i.cartItemId === cartItemId) {
          const newQty = i.quantity + delta;
          return newQty > 0 ? { ...i, quantity: newQty } : null;
        }
        return i;
      }).filter((i): i is POSCartItem => i !== null);
      set({ items: updated });
    }
  },

  removeItem: (cartItemId) => {
    const { items, activeOrderId } = get();
    const item = items.find(i => i.cartItemId === cartItemId);
    
    if (item?.isSaved && activeOrderId) {
      apiClient(`/orders/${activeOrderId}/items/${item.cartItemId}`, { method: "DELETE" })
        .then(() => get().retrieveHeldBill(activeOrderId))
        .catch(console.error);
    }
    
    set({ items: get().items.filter((item) => item.cartItemId !== cartItemId) });
  },

  setItemModifiers: (cartItemId, modifiers, notes) => {
    set({
      items: get().items.map((item) =>
        item.cartItemId === cartItemId ? { ...item, modifiers, notes } : item
      ),
    });
  },

  setDiscount: (discount) => {
    set({ discount });
    const { activeOrderId } = get();
    if (activeOrderId) {
      apiClient(`/orders/${activeOrderId}/discount`, {
        method: "PATCH",
        body: JSON.stringify({ discount })
      }).catch(console.error);
    }
  },

  clearCart: () => {
    const { tableId, orderMode } = get();
    if (orderMode === "DINE_IN" && tableId) {
      import("../hooks/useSocket").then(({ getSocket }) => {
        getSocket().emit("table:unlock", { tableId });
      }).catch(() => {});
    }

    set({
      activeOrderId: null,
      orderNumber: null,
      items: [],
      discount: undefined,
      customer: null,
      isProcessingPayment: false,
    });
  },

  syncOrderToBackend: async (reason = "Customer parked") => {
    const { activeOrderId, orderMode, tableId, paxCount, assignedWaiter, customer, items, discount } = get();
    
    let orderId = activeOrderId;

    // 1. Create order if it doesn't exist
    if (!orderId) {
      const payload = {
        orderMode,
        tableId,
        waiterName: assignedWaiter,
        paxCount,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        notes: reason,
      };
      
      try {
        const createRes = await apiClient<{ success: boolean; data: any }>("/orders", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (createRes.success) {
          orderId = createRes.data.id;
          set({ activeOrderId: orderId, orderNumber: createRes.data.orderNumber });
        } else {
          return null;
        }
      } catch (err) {
        console.error("Failed to create order, queuing offline", err);
        orderId = `local-order-${Date.now()}`;
        set({ activeOrderId: orderId, orderNumber: `OFFLINE-${orderId.slice(-4)}` });
        await db.syncQueue.add({
          action: "CREATE_ORDER",
          payload: { ...payload, localId: orderId },
          status: "PENDING",
          createdAt: new Date().toISOString(),
          retryCount: 0,
        });
      }
    }

    // 2. Sync unsaved items
    if (orderId) {
      const unsavedItems = items.filter(i => !i.isSaved);
      if (unsavedItems.length > 0) {
        const payload = unsavedItems.map(i => ({
          menuItemId: i.menuItemId,
          menuItemName: i.menuItemName,
          variantName: i.variantName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          gstRate: i.gstRate,
          modifiers: i.modifiers,
          addOns: i.addOns,
          notes: i.notes,
        }));
        
        try {
          await apiClient(`/orders/${orderId}/items`, {
            method: "POST",
            body: JSON.stringify({ items: payload })
          });
          set({ items: get().items.map(i => ({ ...i, isSaved: true })) });
        } catch (err) {
          console.error("Failed to add items to order, queuing offline", err);
          await db.syncQueue.add({
            action: "UPDATE_ITEMS",
            orderId: orderId,
            payload: { items: payload },
            status: "PENDING",
            createdAt: new Date().toISOString(),
            retryCount: 0,
          });
          set({ items: get().items.map(i => ({ ...i, isSaved: true })) });
        }
      }

      // 3. Sync discount if needed
      if (discount) {
        try {
          await apiClient(`/orders/${orderId}/discount`, {
            method: "PATCH",
            body: JSON.stringify({ discount })
          });
        } catch (e) {
          console.error("Discount sync failed", e);
        }
      }

      return orderId;
    }
    
    return null;
  },

  holdCurrentBill: async (reason = "Customer parked") => {
    const { items } = get();
    if (items.length === 0) return;

    const orderId = await get().syncOrderToBackend(reason);
    if (orderId) {
      try {
        await apiClient(`/orders/${orderId}/hold`, { method: "POST" });
      } catch (e) {
        console.error("Hold order failed, queuing offline", e);
        await db.syncQueue.add({
          action: "HOLD_ORDER",
          orderId: orderId,
          payload: { reason },
          status: "PENDING",
          createdAt: new Date().toISOString(),
          retryCount: 0,
        });
      }
    }
    
    get().clearCart();
    get().fetchHeldBills(); // Refresh hold list
  },

  fetchHeldBills: async () => {
    try {
      // Query all active orders first
      const activeRes = await apiClient<{ success: boolean; data: any[] }>("/orders?active=true").catch(() => null);
      let allOrders: any[] = [];
      if (activeRes?.success && Array.isArray(activeRes.data)) {
        allOrders = activeRes.data;
      } else {
        const [draftRes, progressRes, placedRes] = await Promise.all([
          apiClient<{ success: boolean; data: any[] }>("/orders?status=DRAFT").catch(() => ({ success: false, data: [] })),
          apiClient<{ success: boolean; data: any[] }>("/orders?status=IN_PROGRESS").catch(() => ({ success: false, data: [] })),
          apiClient<{ success: boolean; data: any[] }>("/orders?status=PLACED").catch(() => ({ success: false, data: [] })),
        ]);
        if (draftRes.success) allOrders.push(...draftRes.data);
        if (progressRes.success) allOrders.push(...progressRes.data);
        if (placedRes.success) allOrders.push(...placedRes.data);
      }

      // Map table names from useTableStore so bills display human-friendly table numbers
      const { useTableStore } = await import("./useTableStore");
      const tables = useTableStore.getState().tables;
      const tableMap = new Map(tables.map(t => [t.id, t.tableNumber]));

      const bills: HeldBill[] = allOrders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderMode: order.orderMode as OrderMode,
        tableId: order.tableId,
        tableNumber: order.tableId ? (tableMap.get(order.tableId) || order.tableNumber || `Table ${order.tableId}`) : null,
        paxCount: order.paxCount || 1,
        assignedWaiter: order.waiterName || "Counter",
        customer: order.customerName ? { name: order.customerName, phone: order.customerPhone || "" } : null,
        items: (order.items || []).map((i: any) => ({
          cartItemId: i.id,
          menuItemId: i.menuItemId,
          menuItemName: i.menuItemName,
          variantName: i.variantName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          gstRate: i.gstRate,
          modifiers: safeParseJson<string[]>(i.modifiers, []),
          addOns: safeParseJson<CartItemAddOn[] | undefined>(i.addOns, undefined),
          notes: i.notes || "",
          isSaved: true,
        })),
        discount: order.discountType ? { type: order.discountType, value: order.discountValue } : undefined,
        heldAt: new Date(order.createdAt),
        reason: order.notes,
      }));
      set({ heldBills: bills });
    } catch (e) {
      console.error("Failed to fetch held bills", e);
    }
  },

  retrieveHeldBill: async (heldBillId) => {
    // If current cart has unsaved items, hold it first automatically
    if (get().items.length > 0 && get().activeOrderId !== heldBillId && get().items.some(i => !i.isSaved)) {
      await get().holdCurrentBill("Auto-held during retrieval");
    }

    try {
      const res = await apiClient<{ success: boolean; data: any }>(`/orders/${heldBillId}`);
      if (res.success) {
        const order = res.data;
        const mappedItems: POSCartItem[] = (order.items || []).map((i: any) => ({
          cartItemId: i.id, // Use backend order_item.id
          menuItemId: i.menuItemId,
          menuItemName: i.menuItemName,
          variantName: i.variantName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          gstRate: i.gstRate,
          modifiers: safeParseJson<string[]>(i.modifiers, []),
          addOns: safeParseJson<CartItemAddOn[] | undefined>(i.addOns, undefined),
          notes: i.notes || "",
          isSaved: true,
        }));

        const { useTableStore } = await import("./useTableStore");
        const tables = useTableStore.getState().tables;
        const foundTable = tables.find(t => t.id === order.tableId);
        const resolvedTableNumber = foundTable?.tableNumber || order.tableNumber || (order.tableId ? `Table ${order.tableId}` : null);

        set({
          activeOrderId: order.id,
          orderNumber: order.orderNumber,
          orderMode: (order.orderMode as OrderMode) || "DINE_IN",
          tableId: order.tableId || null,
          tableNumber: resolvedTableNumber,
          paxCount: order.paxCount || 1,
          assignedWaiter: order.waiterName || "Counter",
          customer: order.customerName ? { name: order.customerName, phone: order.customerPhone || "" } : null,
          items: mappedItems,
          discount: order.discountType ? { type: order.discountType, value: order.discountValue } : undefined,
        });
      }
    } catch (e) {
      console.error("Failed to retrieve order", e);
    }
  },

  loadTableOrder: async (tableId: string, tableNumber?: string, orderId?: string) => {
    const { activeOrderId, items } = get();
    const { useTableStore } = await import("./useTableStore");
    const tableStore = useTableStore.getState();
    const targetTable = tableStore.tables.find(t => t.id === tableId);
    const resolvedTableNumber = tableNumber || targetTable?.tableNumber || tableId;

    // If there's unsaved work on a different table/order, hold it first if applicable
    if (items.length > 0 && activeOrderId && activeOrderId !== orderId && items.some(i => !i.isSaved)) {
      await get().holdCurrentBill("Auto-held during table switch");
    }

    // Determine orderId to fetch
    let targetOrderId = orderId || targetTable?.currentOrderId;

    // If we don't have targetOrderId, query backend for active order on this table
    if (!targetOrderId) {
      try {
        const res = await apiClient<{ success: boolean; data: any }>(`/tables/${tableId}/order`);
        if (res.success && res.data) {
          targetOrderId = res.data.id;
        }
      } catch {
        try {
          const orderListRes = await apiClient<{ success: boolean; data: any[] }>(`/orders?tableId=${tableId}&active=true`);
          if (orderListRes.success && orderListRes.data?.length > 0) {
            const activeOrder = orderListRes.data[0];
            if (activeOrder) {
              targetOrderId = activeOrder.id;
            }
          }
        } catch (err) {
          console.error("Failed to query order for table", err);
        }
      }
    }

    if (targetOrderId) {
      // Retrieve full order
      await get().retrieveHeldBill(targetOrderId);
      set({
        orderMode: "DINE_IN",
        tableId,
        tableNumber: resolvedTableNumber,
      });
      return true;
    } else {
      // Vacant table: initialize a clean cart for this table
      set({
        activeOrderId: null,
        orderNumber: null,
        orderMode: "DINE_IN",
        tableId,
        tableNumber: resolvedTableNumber,
        items: [],
        discount: undefined,
        customer: null,
        paxCount: targetTable?.capacity || 1,
        assignedWaiter: targetTable?.assignedWaiter || "Counter",
        isProcessingPayment: false,
      });
      return false;
    }
  },

  fireKOT: async () => {
    const orderId = await get().syncOrderToBackend("Fire KOT");
    if (orderId) {
      try {
        await apiClient(`/orders/${orderId}/kot`, { method: "POST" });
        await get().retrieveHeldBill(orderId);
      } catch (e) {
        console.error("Failed to fire KOT, queuing offline", e);
        await db.syncQueue.add({
          action: "FIRE_KOT",
          orderId: orderId,
          payload: {},
          status: "PENDING",
          createdAt: new Date().toISOString(),
          retryCount: 0,
        });
      }
    }
  },

  splitItemQuantity: async (cartItemId, splitQuantity) => {
    const { activeOrderId } = get();
    if (!activeOrderId) return; // Cannot split an unsaved order.
    try {
      await apiClient(`/orders/${activeOrderId}/items/${cartItemId}/split`, {
        method: "POST",
        body: JSON.stringify({ splitQuantity })
      });
      await get().retrieveHeldBill(activeOrderId);
    } catch (e) {
      console.error("Failed to split item quantity", e);
    }
  },

  moveItemsToNewOrder: async (cartItemIds) => {
    const { activeOrderId } = get();
    if (!activeOrderId || cartItemIds.length === 0) return { success: false };
    try {
      const res = await apiClient<{ success: boolean; data: { targetOrder: { id: string } } }>(
        `/orders/${activeOrderId}/move-items`,
        {
          method: "POST",
          body: JSON.stringify({ itemIds: cartItemIds })
        }
      );
      if (res.success) {
        // Refresh the current order
        await get().retrieveHeldBill(activeOrderId);
        return { success: true, newOrderId: res.data.targetOrder.id };
      }
      return { success: false, error: "API returned false" };
    } catch (e) {
      console.error("Failed to move items", e);
      return { success: false, error: String(e) };
    }
  },

  checkoutOrder: async (payload) => {
    if (get().isProcessingPayment) {
      return { success: false, printed: false, error: "Payment is already processing." };
    }
    set({ isProcessingPayment: true });

    const orderId = await get().syncOrderToBackend("Checkout");
    if (!orderId) {
      set({ isProcessingPayment: false });
      return { success: false, printed: false, error: "Could not sync order before checkout." };
    }

    try {
      const res = await apiClient<{ success: boolean; data?: { orderId: string; invoiceNumber?: string } }>(`/orders/${orderId}/checkout`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      if (res.success) {
        let printed = false;
        try {
          await apiClient(`/print/bill/${res.data?.orderId || orderId}`, {
            method: "POST",
            body: JSON.stringify({ source: "pos" }),
          });
          printed = true;
        } catch (printError) {
          console.error("Failed to print bill", printError);
        }
        const finalTableId = get().tableId;
        set({ isProcessingPayment: false });
        get().clearCart();
        if (finalTableId) {
          import("./useTableStore").then(({ useTableStore }) => {
            useTableStore.getState().setTableStatus(finalTableId, "VACANT");
            useTableStore.getState().fetchTables();
          }).catch(() => {});
        }
        return { success: true, printed, invoiceNumber: res.data?.invoiceNumber };
      }
      set({ isProcessingPayment: false });
      return { success: false, printed: false, error: "Checkout was not accepted by the server." };
    } catch (e) {
      console.error("Failed to checkout, queuing offline", e);
      await db.syncQueue.add({
        action: "CHECKOUT",
        orderId: orderId,
        payload,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        retryCount: 0,
      });
      get().clearCart();
      set({ isProcessingPayment: false });
      return { success: true, printed: false, invoiceNumber: `OFFLINE-${orderId.slice(-4)}` };
    }
  },

  getTotals: () => {
    const { items, discount } = get();
    // Convert POSCartItem to CartItem expected by @gusto/core-logic
    const coreItems: CartItem[] = items.map((i) => ({
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      variantName: i.variantName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      gstRate: i.gstRate,
      modifiers: i.modifiers,
      addOns: i.addOns,
    }));
    return calculateCartTotals(coreItems, discount);
  },
}));
