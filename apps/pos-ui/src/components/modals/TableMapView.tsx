import React, { useMemo } from "react";
import { useTableStore, type POSTable } from "../../store/useTableStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { ReservationModal } from "./ReservationModal";
import { GlobalReservationsModal } from "./GlobalReservationsModal";
import { Calendar, ListTodo, Lock } from "lucide-react";
import { useAuthStore } from "../../store/useAuthStore";
import { getSocket } from "../../hooks/useSocket";

export const TableMapView: React.FC = () => {
  const { areas, tables, selectedAreaId, setSelectedArea } = useTableStore();
  const { loadTableOrder } = useCartStore();
  const { setActiveView, showNotification, openModal } = useUIStore();
  const { user } = useAuthStore();
  const [reservingTable, setReservingTable] = React.useState<POSTable | null>(null);
  const [showGlobalReservations, setShowGlobalReservations] = React.useState(false);

  const currentUserName = user?.name || "Unknown";

  const currentArea = areas.find((a) => a.id === selectedAreaId) || areas[0];
  const areaTables = useMemo(() => tables.filter((t) => t.areaId === currentArea?.id), [tables, currentArea]);

  // Status counters
  const counts = useMemo(() => {
    let vacant = 0, occupied = 0, billed = 0, reserved = 0;
    for (const t of tables) {
      if (t.status === "VACANT") vacant++;
      else if (t.status === "OCCUPIED") occupied++;
      else if (t.status === "BILLED") billed++;
      else if (t.status === "RESERVED") reserved++;
    }
    return { VACANT: vacant, OCCUPIED: occupied, BILLED: billed, RESERVED: reserved };
  }, [tables]);

  // Active counts per area
  const areaActiveCounts = useMemo(() => {
    const countsMap = new Map<string, number>();
    for (const t of tables) {
      if (t.status === "OCCUPIED" || t.status === "BILLED") {
        countsMap.set(t.areaId, (countsMap.get(t.areaId) || 0) + 1);
      }
    }
    return countsMap;
  }, [tables]);

  const handleTableClick = async (table: POSTable) => {
    const isLockedByOther = table.lockedBy && table.lockedBy !== currentUserName;
    if (isLockedByOther) {
      showNotification(`🔒 Table ${table.tableNumber} is currently being edited by ${table.lockedBy}`);
      return;
    }

    // Lock the table for us
    getSocket().emit("table:lock", { tableId: table.id, lockedBy: currentUserName });

    if (table.status === "VACANT") {
      await loadTableOrder(table.id, table.tableNumber);
      setActiveView("BILLING");
      showNotification(`🍽️ Seating table: ${table.tableNumber}. Ready for order taking.`);
    } else {
      showNotification(`⏳ Loading bill for table ${table.tableNumber}...`);
      const hasOrder = await loadTableOrder(table.id, table.tableNumber, table.currentOrderId);
      setActiveView("BILLING");
      if (hasOrder) {
        showNotification(`📍 Loaded active bill for table ${table.tableNumber} (#${table.orderNumber || "Active"}).`);
      } else {
        showNotification(`🍽️ Table ${table.tableNumber} ready for new items.`);
      }
    }
  };

  return (
    <div className="flex-1 bg-background flex flex-col h-full overflow-hidden select-none">
      {/* Top Section / Area Tabs & Status Bar */}
      <div className="bg-surface border-b border-border px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        {/* Area Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
          {areas.map((area) => {
            const isSelected = area.id === selectedAreaId;
            const activeCount = areaActiveCounts.get(area.id) || 0;

            return (
              <button
                key={area.id}
                onClick={() => setSelectedArea(area.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isSelected
                    ? "bg-primary text-text-inverse shadow-md shadow-primary/30"
                    : "bg-surface-hover text-text-muted hover:text-text-main hover:bg-surface-hover"
                }`}
              >
                <span>{area.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    isSelected ? "bg-orange-700 text-orange-200" : "bg-surface text-text-muted"
                  }`}
                >
                  {activeCount}/{area.tableCount} Active
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend / Status Counters */}
        <div className="flex items-center gap-3 bg-background px-3 py-1.5 rounded-xl border border-border text-xs font-semibold shrink-0">
          <div className="flex items-center gap-1.5 text-text-main">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-600" />
            <span>Vacant ({counts.VACANT})</span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>Occupied ({counts.OCCUPIED})</span>
          </div>
          <div className="flex items-center gap-1.5 text-highlight-hover">
            <span className="w-2.5 h-2.5 rounded-full bg-highlight-hover animate-pulse" />
            <span>Billed ({counts.BILLED})</span>
          </div>
          <div className="flex items-center gap-1.5 text-blue-400 border-r border-border pr-3">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>Reserved ({counts.RESERVED})</span>
          </div>
          
          <button
            onClick={() => setShowGlobalReservations(true)}
            className="flex items-center gap-2 text-text-muted hover:text-text-inverse transition-colors"
            title="View All Bookings"
          >
            <ListTodo size={14} />
            <span>All Bookings</span>
          </button>
        </div>
      </div>

      {/* Tables Grid */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 content-start">
        {areaTables.map((table) => {
          let statusStyle = "border-border bg-surface hover:border-emerald-500 text-text-main";
          let badgeText = "VACANT";
          let badgeColor = "bg-surface-hover text-text-muted border-border-hover";

          if (table.status === "OCCUPIED") {
            statusStyle = "border-rose-500/70 bg-rose-950/20 hover:border-rose-400 text-rose-200 shadow-lg shadow-rose-900/10";
            badgeText = "OCCUPIED";
            badgeColor = "bg-rose-600 text-text-inverse font-bold";
          } else if (table.status === "BILLED") {
            statusStyle = "border-highlight/70 bg-amber-950/20 hover:border-highlight text-amber-200 shadow-lg shadow-amber-900/10 animate-pulse";
            badgeText = "BILLED";
            badgeColor = "bg-highlight text-text-inverse font-bold";
          } else if (table.status === "RESERVED") {
            statusStyle = "border-blue-500/70 bg-blue-950/20 hover:border-blue-400 text-blue-200";
            badgeText = "RESERVED";
            badgeColor = "bg-blue-600 text-text-inverse font-bold";
          }

          const elapsedMins = table.seatedSince
            ? Math.round((Date.now() - table.seatedSince.getTime()) / (1000 * 60))
            : null;
            
          const isLockedByOther = table.lockedBy && table.lockedBy !== currentUserName;

          return (
            <div
              key={table.id}
              onClick={() => handleTableClick(table)}
              className={`border rounded-2xl p-4 flex flex-col justify-between transition-all duration-150 min-h-[140px] relative overflow-hidden ${
                isLockedByOther ? "opacity-50 cursor-not-allowed grayscale-[30%]" : "cursor-pointer active:scale-[0.97]"
              } ${statusStyle}`}
            >
              {/* Lock Overlay Layer */}
              {isLockedByOther && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex flex-col items-center justify-center z-10">
                  <Lock size={24} className="text-text-main mb-1" />
                  <span className="text-[10px] font-bold text-text-main bg-surface/80 px-2 py-0.5 rounded">
                    {table.lockedBy}
                  </span>
                </div>
              )}

              {/* Top: Table Name & Status Badge */}
              <div className="flex items-start justify-between gap-1">
                <div>
                  <div className="text-base font-black tracking-tight">{table.tableNumber}</div>
                  <div className="text-[11px] font-mono opacity-70">Capacity: {table.capacity} Pax</div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${badgeColor}`}>
                    {badgeText}
                  </span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setReservingTable(table);
                    }}
                    className="p-1 text-text-muted hover:text-text-main bg-surface-hover hover:bg-surface-hover rounded transition-colors"
                    title="Reservations"
                  >
                    <Calendar size={14} />
                  </button>
                </div>
              </div>

              {/* Middle / Bottom: Bill Info or Vacant prompt */}
              {(table.status === "OCCUPIED" || table.status === "BILLED") && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-2 text-xs">
                  <div className="flex justify-between items-center font-mono">
                    <span className="opacity-70">Running Bill:</span>
                    <span className="font-extrabold text-sm text-primary-hover">
                      ₹{table.currentBillAmount ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] opacity-70">
                    <span>{table.assignedWaiter || "Counter"}</span>
                    {elapsedMins !== null && <span>⏱️ {elapsedMins}m ago</span>}
                  </div>

                  {/* Quick Bill & Settle Action Buttons */}
                  <div className="pt-1.5 flex items-center gap-1.5 border-t border-white/10">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleTableClick(table);
                        openModal("BILL_PREVIEW");
                      }}
                      className="flex-1 bg-surface-hover hover:bg-surface-hover/80 text-[10px] font-bold py-1 px-1.5 rounded text-text-main border border-border-hover flex items-center justify-center gap-1 transition-all"
                      title="Preview / Print Bill Paper [F11]"
                    >
                      <span>🧾</span>
                      <span>Bill</span>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleTableClick(table);
                        openModal("PAYMENT");
                      }}
                      className="flex-1 bg-primary hover:bg-primary-hover text-[10px] font-bold py-1 px-1.5 rounded text-text-inverse shadow-md shadow-primary/20 flex items-center justify-center gap-1 transition-all"
                      title="Settle Payment [F12]"
                    >
                      <span>💳</span>
                      <span>Settle</span>
                    </button>
                  </div>
                </div>
              )}

              {table.status === "VACANT" && (
                <div className="mt-auto pt-3 border-t border-border text-[11px] text-text-muted text-center font-mono group-hover:text-secondary-hover">
                  Tap to start order
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Switch back helper */}
      <div className="bg-surface border-t border-border px-6 py-3 flex items-center justify-between text-xs text-text-muted font-mono shrink-0">
        <div>Press F5 anytime to return directly to Billing Counter screen</div>
        <button
          onClick={() => setActiveView("BILLING")}
          className="bg-surface-hover hover:bg-surface-hover text-text-main px-4 py-1.5 rounded-lg border border-border-hover font-sans font-bold"
        >
          Return to Billing [F5]
        </button>
      </div>

      {reservingTable && (
        <ReservationModal
          table={reservingTable}
          onClose={() => setReservingTable(null)}
        />
      )}

      {showGlobalReservations && (
        <GlobalReservationsModal
          onClose={() => setShowGlobalReservations(false)}
        />
      )}
    </div>
  );
};
