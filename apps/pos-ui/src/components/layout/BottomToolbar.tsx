import React from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore, type POSModal } from "../../store/useUIStore";
import { CashIcon, SplitIcon } from "../common/PaymentIcons";

export const BottomToolbar: React.FC = () => {
  const { items, holdCurrentBill, fireKOT, tableId, tableNumber, activeOrderId, loadTableOrder, retrieveHeldBill } = useCartStore();
  const { activeView, setActiveView, openModal, showNotification } = useUIStore();

  const buttons: {
    key: string;
    alt: string;
    label: string;
    icon: React.ReactNode;
    color: string;
    action: () => void | Promise<void>;
  }[] = [
    {
      key: "F1",
      alt: "Alt+K",
      label: "Save & Print KOT",
      icon: "🖨️",
      color: "bg-emerald-700 hover:bg-emerald-600 border-emerald-600 text-text-inverse font-bold",
      action: async () => {
        const unfiredItems = items.filter(i => !i.kotId);
        if (items.length === 0) {
          showNotification("⚠️ Cart is empty. Add items before firing KOT.");
          return;
        }
        if (unfiredItems.length === 0) {
          showNotification("ℹ️ All items already fired to kitchen. Add new items to fire another KOT.");
          return;
        }
        await fireKOT();
        showNotification("🖨️ KOT Fired! Sent to Kitchen Display & Thermal Printer.");
      },
    },
    {
      key: "F2",
      alt: "Alt+S",
      label: "Short-Code Search",
      icon: "🔍",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: () => {
        const el = document.getElementById("pos-search-input") as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      },
    },
    {
      key: "F3",
      alt: "Alt+H",
      label: "Hold / Retrieve",
      icon: "⏸️",
      color: "bg-highlight hover:bg-highlight-hover border-highlight text-text-inverse font-bold",
      action: () => {
        if (items.length > 0) {
          holdCurrentBill("Customer parked bill (F3)");
          showNotification("⏸️ Order parked on hold. Screen cleared for next customer.");
        } else {
          openModal("HOLD_BILLS");
        }
      },
    },
    {
      key: "F4",
      alt: "Alt+Z",
      label: "Discount",
      icon: "🏷️",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: () => openModal("DISCOUNT"),
    },
    {
      key: "F5",
      alt: "Alt+T",
      label: activeView === "BILLING" ? "Table Floor Map" : "Billing Screen",
      icon: "📍",
      color: "bg-blue-600 hover:bg-blue-500 border-blue-500 text-text-inverse font-bold",
      action: () => {
        const nextView = activeView === "BILLING" ? "TABLES" : "BILLING";
        setActiveView(nextView);
        showNotification(nextView === "TABLES" ? "📍 Floor & Table Map Mode" : "🧾 Billing Counter Mode");
      },
    },
    {
      key: "F6",
      alt: "Alt+P",
      label: "Split Bill",
      icon: <SplitIcon className="w-3.5 h-3.5" />,
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: () => {
        if (items.length > 0) openModal("SPLIT_BILL");
        else showNotification("⚠️ Add items to bill before splitting.");
      },
    },
    {
      key: "F7",
      alt: "Alt+C",
      label: "Open Drawer",
      icon: "🪙",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: async () => {
        try {
          const { apiClient } = await import("../../api/client");
          await apiClient("/print/open-drawer", { method: "POST" });
          showNotification("🪙 Cash drawer command sent");
        } catch (e) {
          showNotification("⚠️ Failed to open cash drawer (offline?)");
        }
      },
    },
    {
      key: "F8",
      alt: "Alt+O",
      label: "Open Item / Misc",
      icon: "➕",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: () => openModal("OPEN_ITEM"),
    },
    {
      key: "F9",
      alt: "Alt+L",
      label: "Customer / CRM",
      icon: "👤",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: () => openModal("CUSTOMER"),
    },
    {
      key: "F10",
      alt: "Alt+Y",
      label: "Sync Queue",
      icon: "🔄",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: () => openModal("SYNC_QUEUE"),
    },
    {
      key: "F11",
      alt: "Alt+B",
      label: "Bill Paper (Flip)",
      icon: "🧾",
      color: "bg-surface-hover hover:bg-surface-hover border-border-hover text-text-main",
      action: async () => {
        if (items.length === 0) {
          if (tableId) {
            showNotification(`🔄 Loading active bill for ${tableNumber || "table"}...`);
            const hasOrder = await loadTableOrder(tableId, tableNumber || undefined, activeOrderId || undefined);
            if (hasOrder && useCartStore.getState().items.length > 0) {
              openModal("BILL_PREVIEW");
              return;
            }
          } else if (activeOrderId) {
            await retrieveHeldBill(activeOrderId);
            if (useCartStore.getState().items.length > 0) {
              openModal("BILL_PREVIEW");
              return;
            }
          }
          showNotification("⚠️ Cart is empty. Add items before viewing bill paper.");
          return;
        }
        openModal("BILL_PREVIEW");
      },
    },
    {
      key: "F12",
      alt: "Enter",
      label: "Settle & Pay",
      icon: <CashIcon className="w-3.5 h-3.5" />,
      color: "bg-primary hover:bg-primary-hover border-primary text-text-inverse font-extrabold shadow-lg shadow-primary/30",
      action: async () => {
        if (items.length === 0) {
          if (tableId) {
            showNotification(`🔄 Loading active bill for ${tableNumber || "table"}...`);
            const hasOrder = await loadTableOrder(tableId, tableNumber || undefined, activeOrderId || undefined);
            if (hasOrder && useCartStore.getState().items.length > 0) {
              openModal("PAYMENT");
              return;
            }
          } else if (activeOrderId) {
            await retrieveHeldBill(activeOrderId);
            if (useCartStore.getState().items.length > 0) {
              openModal("PAYMENT");
              return;
            }
          }
          showNotification("⚠️ Cart is empty. Cannot open settlement screen.");
          return;
        }
        openModal("PAYMENT");
      },
    },
  ];

  return (
    <footer className="bg-surface border-t border-border px-3 py-2 flex items-center justify-between gap-1.5 overflow-x-auto select-none shrink-0">
      {buttons.map((btn) => (
        <button
          key={btn.key}
          onClick={btn.action}
          className={`flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all shrink-0 active:scale-95 ${btn.color}`}
          title={`${btn.label} [Key: ${btn.key} or ${btn.alt}]`}
        >
          <div className="flex items-center gap-1">
            <span className="bg-background/60 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider border border-white/10">
              {btn.key}
            </span>
            <span>{btn.icon}</span>
          </div>
          <span className="whitespace-nowrap tracking-tight">{btn.label}</span>
        </button>
      ))}
    </footer>
  );
};
