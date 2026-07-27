import React from "react";
import { useCartStore, type OrderMode } from "../../store/useCartStore";
import { useMenuStore } from "../../store/useMenuStore";
import { useUIStore } from "../../store/useUIStore";

export const TopNav: React.FC = () => {
  const { orderMode, setOrderMode, tableNumber, paxCount, addItem, heldBills } = useCartStore();
  const { searchQuery, setSearchQuery, getItemByShortCode, resetSearch } = useMenuStore();
  const { activeView, setActiveView, openModal, notification, isOnline } = useUIStore();

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const match = getItemByShortCode(searchQuery.trim());
      if (match) {
        addItem(match);
        resetSearch();
      }
    }
  };

  const modes: { mode: OrderMode; label: string; shortcut: string; icon: string }[] = [
    { mode: "DINE_IN", label: "Dine-In", shortcut: "Alt+D", icon: "🍽️" },
    { mode: "TAKEAWAY", label: "Takeaway", shortcut: "Alt+X", icon: "🛍️" },
    { mode: "DELIVERY", label: "Delivery", shortcut: "Alt+V", icon: "🛵" },
    { mode: "QUICK_BILL", label: "Quick Bill", shortcut: "Alt+Q", icon: "⚡" },
  ];

  return (
    <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex flex-col md:flex-row items-center justify-between gap-3 text-white select-none">
      {/* Left: Brand & Terminal Badge + Mode Switcher */}
      <div className="flex items-center gap-4 w-full md:w-auto overflow-x-auto">
        <div className="flex items-center gap-2 pr-3 border-r border-gray-700 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center font-black text-lg shadow-inner">
            P
          </div>
          <div>
            <div className="font-bold text-sm leading-tight flex items-center gap-1.5">
              <span>PETPOOJA CLONE</span>
              <span className="text-[10px] bg-orange-500/20 text-orange-400 font-mono px-1.5 py-0.5 rounded border border-orange-500/30">
                POS v1.0
              </span>
            </div>
            <div className="text-[11px] text-gray-400 font-mono">Terminal-01 • LAN :8080</div>
          </div>
        </div>

        {/* Order Mode Switcher */}
        <div className="flex items-center bg-gray-950 p-1 rounded-lg border border-gray-800 shrink-0">
          {modes.map((item) => {
            const isActive = orderMode === item.mode;
            return (
              <button
                key={item.mode}
                onClick={() => setOrderMode(item.mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-orange-600 text-white shadow-sm font-bold"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
                title={`Switch to ${item.label} (${item.shortcut})`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                <span className={`text-[10px] ml-1 px-1 rounded ${isActive ? "bg-orange-700 text-orange-200" : "bg-gray-800 text-gray-500"}`}>
                  {item.shortcut.replace("Alt+", "")}
                </span>
              </button>
            );
          })}
        </div>

        {/* If Dine-In, show Table Badge */}
        {orderMode === "DINE_IN" && (
          <button
            onClick={() => setActiveView(activeView === "TABLES" ? "BILLING" : "TABLES")}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-750 px-3 py-1.5 rounded-lg border border-gray-700 text-xs font-bold text-orange-400 shrink-0 transition-colors"
            title="Press F5 to open Table Floor Grid"
          >
            <span>📍 {tableNumber || "No Table Selected"}</span>
            <span className="bg-gray-900 text-gray-300 px-1.5 py-0.5 rounded text-[10px]">
              {paxCount} Pax
            </span>
            <span className="text-[10px] text-gray-500">[F5]</span>
          </button>
        )}
      </div>

      {/* Center: High-Speed Search / Short-Code Bar (F2 / Alt+S) */}
      <div className="relative flex-1 max-w-md w-full">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
          <span className="text-sm">🔍</span>
        </div>
        <input
          id="pos-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search item or type Short-Code (e.g. 101, PBB) + Enter..."
          className="w-full bg-gray-950 border border-gray-700 focus:border-orange-500 rounded-lg pl-9 pr-20 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all font-mono"
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-1 pr-1.5 pointer-events-none">
          {searchQuery && (
            <span className="text-[10px] bg-orange-600/30 text-orange-300 px-1 rounded font-sans">
              Press Enter
            </span>
          )}
          <span className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
            F2
          </span>
        </div>
      </div>

      {/* Right: Status Pills & Notification Banner */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Held Bills Counter Pill (F3) */}
        <button
          onClick={() => openModal("HOLD_BILLS")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
            heldBills.length > 0
              ? "bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse"
              : "bg-gray-800 text-gray-400 border-gray-700 hover:text-white"
          }`}
          title="Parked / Held Bills [F3]"
        >
          <span>⏸️ Held</span>
          <span className="bg-gray-900 px-1.5 py-0.5 rounded-full text-[10px] font-mono">
            {heldBills.length}
          </span>
          <span className="text-[10px] text-gray-500 font-normal">[F3]</span>
        </button>

        {/* Sync / Local Server Status */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
            !isOnline
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
          }`}
          title="Local SQLite server active on localhost:8080"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Local POS Active</span>
        </div>
      </div>

      {/* Top Floating Notification Banner */}
      {notification && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-gray-900/95 text-orange-300 border border-orange-500/50 shadow-2xl px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 backdrop-blur-md animate-bounce">
          <span>🔔</span>
          <span>{notification}</span>
        </div>
      )}
    </header>
  );
};
