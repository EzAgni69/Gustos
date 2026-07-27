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
  | "SPLIT_BILL";

export interface UIStoreState {
  activeView: POSView;
  activeModal: POSModal;
  selectedCartItemIdForModifiers: string | null;
  notification: string | null;
  isOnline: boolean;

  // Actions
  setActiveView: (view: POSView) => void;
  openModal: (modal: POSModal, cartItemId?: string | null) => void;
  closeModal: () => void;
  showNotification: (message: string) => void;
  setOnlineStatus: (online: boolean) => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  activeView: "BILLING",
  activeModal: "NONE",
  selectedCartItemIdForModifiers: null,
  notification: null,
  isOnline: false, // Default: Local server offline mode active

  setActiveView: (view) => set({ activeView: view }),

  openModal: (modal, cartItemId = null) =>
    set({
      activeModal: modal,
      selectedCartItemIdForModifiers: cartItemId,
    }),

  closeModal: () =>
    set({
      activeModal: "NONE",
      selectedCartItemIdForModifiers: null,
    }),

  showNotification: (message) => {
    set({ notification: message });
    setTimeout(() => {
      set((state) => (state.notification === message ? { notification: null } : state));
    }, 3000);
  },

  setOnlineStatus: (online) => set({ isOnline: online }),
}));
