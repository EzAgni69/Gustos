import React from "react";
import { useTableStore, type POSTable } from "../../store/useTableStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

export const TableMapView: React.FC = () => {
  const { areas, tables, selectedAreaId, setSelectedArea } = useTableStore();
  const { setOrderMode } = useCartStore();
  const { setActiveView, showNotification } = useUIStore();

  const currentArea = areas.find((a) => a.id === selectedAreaId) || areas[0];
  const areaTables = tables.filter((t) => t.areaId === currentArea?.id);

  // Status counters
  const counts = {
    VACANT: tables.filter((t) => t.status === "VACANT").length,
    OCCUPIED: tables.filter((t) => t.status === "OCCUPIED").length,
    BILLED: tables.filter((t) => t.status === "BILLED").length,
    RESERVED: tables.filter((t) => t.status === "RESERVED").length,
  };

  const handleTableClick = (table: POSTable) => {
    setOrderMode("DINE_IN", table.id, table.tableNumber);
    setActiveView("BILLING");
    if (table.status === "VACANT") {
      showNotification(`🍽️ Seating table: ${table.tableNumber}. Ready for order taking.`);
    } else if (table.status === "OCCUPIED" || table.status === "BILLED") {
      showNotification(`📍 Loaded active order #${table.orderNumber} for table ${table.tableNumber}.`);
    } else {
      showNotification(`🔵 Reserved table ${table.tableNumber} selected.`);
    }
  };

  return (
    <div className="flex-1 bg-gray-950 flex flex-col h-full overflow-hidden select-none">
      {/* Top Section / Area Tabs & Status Bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        {/* Area Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
          {areas.map((area) => {
            const isSelected = area.id === selectedAreaId;
            const activeCount = tables.filter(
              (t) => t.areaId === area.id && (t.status === "OCCUPIED" || t.status === "BILLED")
            ).length;

            return (
              <button
                key={area.id}
                onClick={() => setSelectedArea(area.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isSelected
                    ? "bg-orange-600 text-white shadow-md shadow-orange-600/30"
                    : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-750"
                }`}
              >
                <span>{area.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    isSelected ? "bg-orange-700 text-orange-200" : "bg-gray-900 text-gray-500"
                  }`}
                >
                  {activeCount}/{area.tableCount} Active
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend / Status Counters */}
        <div className="flex items-center gap-3 bg-gray-950 px-3 py-1.5 rounded-xl border border-gray-800 text-xs font-semibold shrink-0">
          <div className="flex items-center gap-1.5 text-gray-300">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-600" />
            <span>Vacant ({counts.VACANT})</span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>Occupied ({counts.OCCUPIED})</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span>Billed ({counts.BILLED})</span>
          </div>
          <div className="flex items-center gap-1.5 text-blue-400">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>Reserved ({counts.RESERVED})</span>
          </div>
        </div>
      </div>

      {/* Tables Grid */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 content-start">
        {areaTables.map((table) => {
          let statusStyle = "border-gray-800 bg-gray-900 hover:border-emerald-500 text-gray-300";
          let badgeText = "VACANT";
          let badgeColor = "bg-gray-800 text-gray-400 border-gray-700";

          if (table.status === "OCCUPIED") {
            statusStyle = "border-rose-500/70 bg-rose-950/20 hover:border-rose-400 text-rose-200 shadow-lg shadow-rose-900/10";
            badgeText = "OCCUPIED";
            badgeColor = "bg-rose-600 text-white font-bold";
          } else if (table.status === "BILLED") {
            statusStyle = "border-amber-500/70 bg-amber-950/20 hover:border-amber-400 text-amber-200 shadow-lg shadow-amber-900/10 animate-pulse";
            badgeText = "BILLED";
            badgeColor = "bg-amber-600 text-white font-bold";
          } else if (table.status === "RESERVED") {
            statusStyle = "border-blue-500/70 bg-blue-950/20 hover:border-blue-400 text-blue-200";
            badgeText = "RESERVED";
            badgeColor = "bg-blue-600 text-white font-bold";
          }

          const elapsedMins = table.seatedSince
            ? Math.round((Date.now() - table.seatedSince.getTime()) / (1000 * 60))
            : null;

          return (
            <div
              key={table.id}
              onClick={() => handleTableClick(table)}
              className={`border rounded-2xl p-4 flex flex-col justify-between transition-all duration-150 cursor-pointer active:scale-[0.97] min-h-[140px] ${statusStyle}`}
            >
              {/* Top: Table Name & Status Badge */}
              <div className="flex items-start justify-between gap-1">
                <div>
                  <div className="text-base font-black tracking-tight">{table.tableNumber}</div>
                  <div className="text-[11px] font-mono opacity-70">Capacity: {table.capacity} Pax</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${badgeColor}`}>
                  {badgeText}
                </span>
              </div>

              {/* Middle / Bottom: Bill Info or Vacant prompt */}
              {(table.status === "OCCUPIED" || table.status === "BILLED") && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-1 text-xs">
                  <div className="flex justify-between items-center font-mono">
                    <span className="opacity-70">Running Bill:</span>
                    <span className="font-extrabold text-sm text-orange-400">
                      ₹{table.currentBillAmount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] opacity-70">
                    <span>{table.assignedWaiter}</span>
                    {elapsedMins !== null && <span>⏱️ {elapsedMins}m ago</span>}
                  </div>
                </div>
              )}

              {table.status === "VACANT" && (
                <div className="mt-auto pt-3 border-t border-gray-800 text-[11px] text-gray-500 text-center font-mono group-hover:text-emerald-400">
                  Tap to start order
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Switch back helper */}
      <div className="bg-gray-900 border-t border-gray-800 px-6 py-3 flex items-center justify-between text-xs text-gray-400 font-mono shrink-0">
        <div>Press F5 anytime to return directly to Billing Counter screen</div>
        <button
          onClick={() => setActiveView("BILLING")}
          className="bg-gray-800 hover:bg-gray-750 text-white px-4 py-1.5 rounded-lg border border-gray-700 font-sans font-bold"
        >
          Return to Billing [F5]
        </button>
      </div>
    </div>
  );
};
