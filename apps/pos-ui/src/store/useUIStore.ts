import { create } from "zustand";

export type POSView = "BILLING" | "TABLES";
export type POSModal =
  | "NONE"
  | "PAYMENT"
  | "MODIFIERS"
  | "CUSTOMER"
  | "HOLD_BILLS"
  | "DISCOUNT"
  | "OPEN_ITEM"
  | "SPLIT_BILL"
  | "SHIFT"
  | "PRINTER"
  | "SYNC_QUEUE"
  | "BILL_PREVIEW"
  | "ONLINE_ORDER"
  | "ITEM_CUSTOMIZER";

export interface BillPreviewData {
  orderId?: string;
  orderNumber?: string;
  isPaid?: boolean;
  invoiceNumber?: string;
  tableName?: string;
  orderMode?: string;
  customerName?: string;
  items?: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    amount?: number;
    variantName?: string;
    modifiers?: string[];
    notes?: string;
  }>;
  subtotal?: number;
  discountAmount?: number;
  taxAmount?: number;
  grandTotal?: number;
  paymentMode?: string;
  date?: string | Date;
}

export interface UIStoreState {
  activeView: POSView;
  activeModal: POSModal;
  selectedCartItemIdForModifiers: string | null;
  customizerItemId: string | null; // menuItem.id currently open in the customizer
  billPreviewData: BillPreviewData | null;
  incomingOnlineOrder: any | null;
  notification: string | null;
  isOnline: boolean;
  serverIp: string | null;

  // Actions
  setActiveView: (view: POSView) => void;
  openModal: (modal: POSModal, cartItemId?: string | null) => void;
  openItemCustomizer: (menuItemId: string) => void;
  openBillPreview: (data?: BillPreviewData | null) => void;
  openOnlineOrderModal: (order: any) => void;
  closeModal: () => void;
  showNotification: (message: string) => void;
  setOnlineStatus: (online: boolean) => void;
  fetchServerIp: () => Promise<void>;
}

export const useUIStore = create<UIStoreState>((set) => ({
  activeView: "BILLING",
  activeModal: "NONE",
  selectedCartItemIdForModifiers: null,
  customizerItemId: null,
  billPreviewData: null,
  incomingOnlineOrder: null,
  notification: null,
  serverIp: null,
  isOnline: false, // Default: Local server offline mode active

  setActiveView: (view) => set({ activeView: view }),

  openModal: (modal, cartItemId = null) =>
    set({
      activeModal: modal,
      selectedCartItemIdForModifiers: cartItemId,
    }),

  openItemCustomizer: (menuItemId) =>
    set({
      activeModal: "ITEM_CUSTOMIZER",
      customizerItemId: menuItemId,
    }),

  openBillPreview: (data = null) =>
    set({
      activeModal: "BILL_PREVIEW",
      billPreviewData: data,
    }),

  openOnlineOrderModal: (order) =>
    set({
      activeModal: "ONLINE_ORDER",
      incomingOnlineOrder: order,
    }),

  closeModal: () =>
    set({
      activeModal: "NONE",
      selectedCartItemIdForModifiers: null,
      customizerItemId: null,
      billPreviewData: null,
      incomingOnlineOrder: null,
    }),

  showNotification: (message) => {
    set({ notification: message });
    setTimeout(() => {
      set((state) => (state.notification === message ? { notification: null } : state));
    }, 3000);
  },

  setOnlineStatus: (online) => set({ isOnline: online }),

  fetchServerIp: async () => {
    try {
      // Assuming pos-local-server runs on port 8080 or is accessible via relative path in production
      const res = await fetch("http://localhost:8080/api/system/network");
      if (res.ok) {
        const data = await res.json();
        if (data.ipAddresses && data.ipAddresses.length > 0) {
          set({ serverIp: data.ipAddresses[0] });
        }
      }
    } catch (err) {
      console.error("Failed to fetch server IP", err);
    }
  },
}));
