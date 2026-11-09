import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, ArrowRight, Combine, Receipt, X, ChevronLeft, Loader2 } from "lucide-react";
import { useTableStore, type POSTable } from "../../store/useTableStore";
import { useUIStore } from "../../store/useUIStore";
import { apiClient } from "../../api/client";

type TableAction = "TRANSFER" | "SWAP" | "MERGE";

interface TableActionsSheetProps {
  table: POSTable;
  currentUserName: string;
  onOpenBill: () => void;
  onClose: () => void;
}

const ACTIONS: Record<
  TableAction,
  { label: string; hint: string; pickPrompt: string; icon: React.ElementType; emptyText: string }
> = {
  TRANSFER: {
    label: "Shift / Transfer",
    hint: "Move this order to an empty table",
    pickPrompt: "Move order to which vacant table?",
    icon: ArrowRight,
    emptyText: "No vacant tables available.",
  },
  SWAP: {
    label: "Swap Tables",
    hint: "Exchange orders with another occupied table",
    pickPrompt: "Swap orders with which table?",
    icon: ArrowRightLeft,
    emptyText: "No other occupied tables to swap with.",
  },
  MERGE: {
    label: "Merge Tables",
    hint: "Combine this bill into another table's order",
    pickPrompt: "Merge this bill into which table?",
    icon: Combine,
    emptyText: "No other occupied tables to merge into.",
  },
};

const isActive = (t: POSTable) => (t.status === "OCCUPIED" || t.status === "BILLED") && !!t.currentOrderId;

export const TableActionsSheet: React.FC<TableActionsSheetProps> = ({ table, currentUserName, onOpenBill, onClose }) => {
  const { areas, tables, fetchTables } = useTableStore();
  const { showNotification } = useUIStore();
  const [action, setAction] = useState<TableAction | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the source table live (it may change via socket while the sheet is open)
  const source = tables.find((t) => t.id === table.id) ?? table;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (action) {
          setAction(null);
          setTargetId(null);
          setError(null);
        } else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, onClose]);

  const candidates = useMemo(() => {
    if (!action) return [];
    return tables.filter((t) => {
      if (t.id === source.id) return false;
      if (t.lockedBy && t.lockedBy !== currentUserName) return false;
      return action === "TRANSFER" ? t.status === "VACANT" : isActive(t);
    });
  }, [action, tables, source.id, currentUserName]);

  const candidatesByArea = useMemo(() => {
    return areas
      .map((area) => ({ area, tables: candidates.filter((t) => t.areaId === area.id) }))
      .filter((g) => g.tables.length > 0);
  }, [areas, candidates]);

  const target = tables.find((t) => t.id === targetId) ?? null;

  // If the chosen target stops being eligible (e.g. someone seats it), drop it
  useEffect(() => {
    if (targetId && !candidates.some((t) => t.id === targetId)) setTargetId(null);
  }, [candidates, targetId]);

  const confirmText = (() => {
    if (!action || !target) return null;
    if (action === "TRANSFER") return `Move ${source.tableNumber}'s order to ${target.tableNumber}. ${source.tableNumber} becomes vacant.`;
    if (action === "SWAP") return `${source.tableNumber} and ${target.tableNumber} exchange their orders.`;
    return `${source.tableNumber}'s items move into ${target.tableNumber}'s bill (#${target.orderNumber ?? "active"}). ${source.tableNumber} becomes vacant. This cannot be undone.`;
  })();

  const submit = async () => {
    if (!action || !target) return;
    setSubmitting(true);
    setError(null);
    try {
      const { endpoint, body } =
        action === "TRANSFER"
          ? { endpoint: "/tables/transfer", body: { fromTableId: source.id, toTableId: target.id } }
          : action === "SWAP"
            ? { endpoint: "/tables/swap", body: { tableAId: source.id, tableBId: target.id } }
            : { endpoint: "/tables/merge", body: { sourceTableId: source.id, targetTableId: target.id } };

      const res = await apiClient<{ success: boolean; message?: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.success) throw new Error(res.message || "Operation failed");

      const icon = action === "TRANSFER" ? "➡️" : action === "SWAP" ? "🔄" : "🔗";
      showNotification(`${icon} ${res.message ?? "Tables updated"}`);
      await fetchTables();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
      await fetchTables();
    } finally {
      setSubmitting(false);
    }
  };

  const backToMenu = () => {
    setAction(null);
    setTargetId(null);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for table ${source.tableNumber}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            {action && (
              <button
                onClick={backToMenu}
                className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover"
                aria-label="Back"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-text-main truncate">
                {action ? ACTIONS[action].label : `Table ${source.tableNumber}`}
              </h2>
              <p className="text-xs text-text-muted font-mono">
                {source.tableNumber} · #{source.orderNumber ?? "Active"} · ₹{source.currentBillAmount ?? 0}
                {source.assignedWaiter ? ` · ${source.assignedWaiter}` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Step 1: action menu */}
        {!action && (
          <div className="p-4 space-y-2">
            <button
              autoFocus
              onClick={onOpenBill}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-text-inverse font-bold shadow-xs transition-all active:scale-[0.98]"
            >
              <Receipt size={18} />
              <span>Open Bill</span>
            </button>
            {(Object.keys(ACTIONS) as TableAction[]).map((key) => {
              const { label, hint, icon: Icon } = ACTIONS[key];
              return (
                <button
                  key={key}
                  onClick={() => setAction(key)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:bg-surface-hover hover:border-border-hover text-left transition-all active:scale-[0.98]"
                >
                  <Icon size={18} className="text-text-muted shrink-0" />
                  <span className="flex flex-col">
                    <span className="text-sm font-bold text-text-main">{label}</span>
                    <span className="text-[11px] text-text-muted">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 2: pick target + confirm */}
        {action && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <p className="text-sm font-semibold text-text-main">{ACTIONS[action].pickPrompt}</p>
              {candidatesByArea.length === 0 && (
                <div className="py-8 text-center text-sm text-text-muted">{ACTIONS[action].emptyText}</div>
              )}
              {candidatesByArea.map(({ area, tables: areaTables }) => (
                <div key={area.id}>
                  {areas.length > 1 && (
                    <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">{area.name}</div>
                  )}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {areaTables.map((t) => {
                      const selected = t.id === targetId;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTargetId(t.id)}
                          aria-pressed={selected}
                          className={`rounded-xl border px-2 py-2.5 text-left transition-all active:scale-[0.97] ${
                            selected
                              ? "border-primary bg-primary/10 ring-2 ring-primary/40"
                              : "border-border bg-background hover:border-border-hover"
                          }`}
                        >
                          <div className="text-sm font-black text-text-main">{t.tableNumber}</div>
                          <div className="text-[10px] font-mono text-text-muted">
                            {action === "TRANSFER" ? `${t.capacity} pax` : `₹${t.currentBillAmount ?? 0}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border p-4 space-y-3">
              {confirmText && <p className="text-xs text-text-muted">{confirmText}</p>}
              {error && (
                <p className="text-xs font-semibold text-rose-600 bg-rose-500/10 border border-rose-300 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                onClick={submit}
                disabled={!target || submitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary hover:bg-primary-hover text-text-inverse font-bold shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {target
                  ? action === "TRANSFER"
                    ? `Transfer to ${target.tableNumber}`
                    : action === "SWAP"
                      ? `Swap with ${target.tableNumber}`
                      : `Merge into ${target.tableNumber}`
                  : "Select a table"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
