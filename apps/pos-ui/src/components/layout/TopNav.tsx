import React from "react";
import { useCartStore, type OrderMode } from "../../store/useCartStore";
import { useMenuStore } from "../../store/useMenuStore";
import { useUIStore } from "../../store/useUIStore";
import { useShiftStore } from "../../store/useShiftStore";
import { usePrinterStore } from "../../store/usePrinterStore";

export const TopNav: React.FC = () => {
  const { orderMode, setOrderMode, tableNumber, paxCount, addItem, heldBills } = useCartStore();
  const { searchQuery, setSearchQuery, getItemByShortCode, resetSearch } = useMenuStore();
  const { activeView, setActiveView, openModal, notification, isOnline, serverIp, fetchServerIp } = useUIStore();
  const { activeShift, shiftWarning, fetchActiveShift, fetchShiftWarning } = useShiftStore();
  const { status: printerStatus } = usePrinterStore();

  React.useEffect(() => {
    fetchServerIp();
    fetchActiveShift();
    fetchShiftWarning();
  }, [fetchServerIp, fetchActiveShift, fetchShiftWarning]);

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
    <header className="relative bg-surface border-b border-border px-4 py-2 flex flex-col md:flex-row items-center justify-between gap-3 text-text-main select-none">
      {/* Left: Brand & Terminal Badge + Mode Switcher */}
      <div className="flex items-center gap-4 w-full md:w-auto overflow-x-auto">
        <div className="flex items-center gap-2 pr-3 border-r border-border-hover shrink-0">
          <img
            src="/logo.png"
            alt="Gusto's"
            className="w-8 h-8 object-contain rounded-md shrink-0"
          />
          <div>
            <div className="font-bold text-sm leading-tight flex items-center gap-1.5">
              <span>Gusto's</span>
              <span className="text-[10px] bg-primary-hover/20 text-primary-hover font-mono px-1.5 py-0.5 rounded border border-primary">
                POS v1.0
              </span>
            </div>
            <div className="text-[11px] text-text-muted font-mono flex items-center gap-1">
              <span>Terminal-01 • LAN</span>
              {serverIp ? (
                <span className="px-1 bg-surface-hover rounded text-primary-hover font-bold">
                  {serverIp}:8080
                </span>
              ) : (
                <span>:8080</span>
              )}
            </div>
          </div>
        </div>

        {/* Order Mode Switcher */}
        <div className="flex items-center bg-background p-1 rounded-lg border border-border shrink-0">
          {modes.map((item) => {
            const isActive = orderMode === item.mode;
            return (
              <button
                key={item.mode}
                onClick={() => setOrderMode(item.mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-primary text-text-inverse shadow-sm font-bold"
                    : "text-text-muted hover:text-text-main hover:bg-surface-hover"
                }`}
                title={`Switch to ${item.label} (${item.shortcut})`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                <span className={`text-[10px] ml-1 px-1 rounded ${isActive ? "bg-orange-700 text-orange-200" : "bg-surface-hover text-text-muted"}`}>
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
            className="flex items-center gap-2 bg-surface-hover hover:bg-surface-hover px-3 py-1.5 rounded-lg border border-border-hover text-xs font-bold text-primary-hover shrink-0 transition-colors"
            title="Press F5 to open Table Floor Grid"
          >
            <span>📍 {tableNumber || "No Table Selected"}</span>
            <span className="bg-surface text-text-main px-1.5 py-0.5 rounded text-[10px]">
              {paxCount} Pax
            </span>
            <span className="text-[10px] text-text-muted">[F5]</span>
          </button>
        )}
      </div>

      {/* Center: High-Speed Search / Short-Code Bar (F2 / Alt+S) */}
      <div className="relative flex-1 max-w-md w-full">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
          <span className="text-sm">🔍</span>
        </div>
        <input
          id="pos-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search item or type Short-Code (e.g. 101, PBB) + Enter..."
          className="w-full bg-background border border-border-hover focus:border-primary rounded-lg pl-9 pr-20 py-1.5 text-xs text-text-main placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all font-mono"
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-1 pr-1.5 pointer-events-none">
          {searchQuery && (
            <span className="text-[10px] bg-primary/30 text-primary-hover px-1 rounded font-sans">
              Press Enter
            </span>
          )}
          <span className="text-[10px] bg-surface-hover text-text-muted px-1.5 py-0.5 rounded border border-border-hover">
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
              ? "bg-highlight-hover/20 text-highlight-hover border-highlight/40 animate-pulse"
              : "bg-surface-hover text-text-muted border-border-hover hover:text-text-main"
          }`}
          title="Parked / Held Bills [F3]"
        >
          <span>⏸️ Held</span>
          <span className="bg-surface px-1.5 py-0.5 rounded-full text-[10px] font-mono">
            {heldBills.length}
          </span>
          <span className="text-[10px] text-text-muted font-normal">[F3]</span>
        </button>

        {/* Shift Status Pill & Warning */}
        <button
          onClick={() => openModal("SHIFT")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
            activeShift
              ? "bg-blue-500/20 text-blue-400 border-blue-500/40 hover:bg-blue-500/30"
              : "bg-amber-500/20 text-amber-400 border-amber-500/50 hover:bg-amber-500/30 animate-pulse"
          }`}
          title={shiftWarning || (activeShift ? `Active Shift: ${activeShift.cashierName}` : "Warning: No shift open. Click to open shift.")}
        >
          <span>
            {activeShift ? `👤 Shift: ${activeShift.cashierName}` : "⚠️ NO SHIFT OPEN"}
          </span>
        </button>

        {/* Printer Queue Status Pill */}
        <button
          onClick={() => openModal("PRINTER")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
            printerStatus?.failed && printerStatus.failed > 0
              ? "bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse"
              : "bg-surface-hover text-text-muted border-border-hover hover:text-text-main"
          }`}
          title="Printer Queue Status"
        >
          <span>🖨️</span>
          {printerStatus?.failed ? (
            <span className="bg-rose-600 text-text-inverse px-1.5 py-0.5 rounded-full text-[10px] font-mono">
              {printerStatus.failed} Failed
            </span>
          ) : (
            <span className="text-[10px] text-text-muted font-normal">Ready</span>
          )}
        </button>

        {/* Sync / Local Server Status */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
            isOnline
              ? "bg-secondary/10 text-secondary-hover border-emerald-500/20"
              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
          }`}
          title="Socket.IO connection status to Local Server"
        >
          <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-secondary-hover animate-ping" : "bg-rose-500"}`} />
          <span>{isOnline ? "Connected" : "Disconnected"}</span>
        </div>
      </div>

      {/* Top Floating Notification Banner */}
      {notification && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-surface/95 text-primary-hover border border-primary shadow-2xl px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 backdrop-blur-md animate-bounce">
          <span>🔔</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Global Shift Warning Banner */}
      {shiftWarning && (
        <div className="absolute top-full left-0 right-0 z-40 bg-rose-600 text-text-inverse px-4 py-1.5 text-xs font-bold text-center shadow-md animate-pulse cursor-pointer" onClick={() => openModal("SHIFT")}>
          {shiftWarning} (Click to manage)
        </div>
      )}
    </header>
  );
};
