import React from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore, type POSModal } from "../../store/useUIStore";

export const BottomToolbar: React.FC = () => {
  const { items, holdCurrentBill } = useCartStore();
  const { activeView, setActiveView, openModal, showNotification } = useUIStore();

  const buttons: {
    key: string;
    alt: string;
    label: string;
    icon: string;
    color: string;
    action: () => void;
  }[] = [
    {
      key: "F1",
      alt: "Alt+K",
      label: "Save & Print KOT",
      icon: "🖨️",
      color: "bg-emerald-700 hover:bg-emerald-600 border-emerald-600 text-white font-bold",
      action: () => {
        if (items.length === 0) {
          showNotification("⚠️ Cart is empty. Add items before firing KOT.");
          return;
        }
        showNotification("🖨️ KOT Fired! Sent to Kitchen Display & Thermal Printer.");
      },
    },
    {
      key: "F2",
      alt: "Alt+S",
      label: "Short-Code Search",
      icon: "🔍",
      color: "bg-gray-800 hover:bg-gray-750 border-gray-700 text-gray-300",
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
      color: "bg-amber-600 hover:bg-amber-500 border-amber-500 text-white font-bold",
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
      color: "bg-gray-800 hover:bg-gray-750 border-gray-700 text-gray-300",
      action: () => openModal("DISCOUNT"),
    },
    {
      key: "F5",
      alt: "Alt+T",
      label: activeView === "BILLING" ? "Table Floor Map" : "Billing Screen",
      icon: "📍",
      color: "bg-blue-600 hover:bg-blue-500 border-blue-500 text-white font-bold",
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
      icon: "✂️",
      color: "bg-gray-800 hover:bg-gray-750 border-gray-700 text-gray-300",
      action: () => {
        if (items.length > 0) openModal("SPLIT_BILL");
        else showNotification("⚠️ Add items to bill before splitting.");
      },
    },
    {
      key: "F8",
      alt: "Alt+O",
      label: "Open Item / Misc",
      icon: "➕",
      color: "bg-gray-800 hover:bg-gray-750 border-gray-700 text-gray-300",
      action: () => openModal("OPEN_ITEM"),
    },
    {
      key: "F9",
      alt: "Alt+L",
      label: "Customer / CRM",
      icon: "👤",
      color: "bg-gray-800 hover:bg-gray-750 border-gray-700 text-gray-300",
      action: () => openModal("CUSTOMER"),
    },
    {
      key: "F12",
      alt: "Enter",
      label: "Settle & Pay",
      icon: "💵",
      color: "bg-orange-600 hover:bg-orange-500 border-orange-500 text-white font-extrabold shadow-lg shadow-orange-600/30",
      action: () => {
        if (items.length === 0) {
          showNotification("⚠️ Cart is empty. Cannot open settlement screen.");
          return;
        }
        openModal("PAYMENT");
      },
    },
  ];

  return (
    <footer className="bg-gray-900 border-t border-gray-800 px-3 py-2 flex items-center justify-between gap-1.5 overflow-x-auto select-none shrink-0">
      {buttons.map((btn) => (
        <button
          key={btn.key}
          onClick={btn.action}
          className={`flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all shrink-0 active:scale-95 ${btn.color}`}
          title={`${btn.label} [Key: ${btn.key} or ${btn.alt}]`}
        >
          <div className="flex items-center gap-1">
            <span className="bg-gray-950/60 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider border border-white/10">
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
