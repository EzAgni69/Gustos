import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Siren, Printer, Ban, RefreshCw } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";

type KOTStatus = "PENDING" | "IN_PROGRESS" | "READY" | "SERVED" | "CANCELLED";

interface OrderKOT {
  id: string;
  kotNumber: string;
  station: string | null;
  status: KOTStatus;
  isRush: boolean;
  cancelReason: string | null;
  cancelApprovedBy: string | null;
  createdAt: string;
  items: { orderItemId: string; name: string; quantity: number; modifiers: string[]; notes: string | null }[];
}

interface KOTHistoryModalProps {
  orderId: string;
  orderNumber?: string | null;
  onClose: () => void;
}

const STATUS_STYLE: Record<KOTStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-surface-hover text-text-muted border-border" },
  IN_PROGRESS: { label: "Cooking", className: "bg-amber-500/15 text-amber-700 border-amber-400/50" },
  READY: { label: "Ready", className: "bg-emerald-500/15 text-emerald-700 border-emerald-400/50" },
  SERVED: { label: "Served", className: "bg-emerald-500/15 text-emerald-700 border-emerald-400/50" },
  CANCELLED: { label: "Cancelled", className: "bg-rose-500/10 text-rose-600 border-rose-300 line-through" },
};

const CANCEL_REASONS = ["Customer cancelled", "Wrong item punched", "Kitchen unable to prepare", "Duplicate KOT", "Other"];

const isLive = (k: OrderKOT) => k.status === "PENDING" || k.status === "IN_PROGRESS";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export const KOTHistoryModal: React.FC<KOTHistoryModalProps> = ({ orderId, orderNumber, onClose }) => {
  const { retrieveHeldBill } = useCartStore();
  const { showNotification } = useUIStore();
  const { user } = useAuthStore();

  const [kots, setKots] = useState<OrderKOT[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // `${kotId}:${action}`
  const [error, setError] = useState<string | null>(null);

  // Cancel flow
  const [cancelling, setCancelling] = useState<OrderKOT | null>(null);
  const [reason, setReason] = useState(CANCEL_REASONS[0]!);
  const [customReason, setCustomReason] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [approvedBy, setApprovedBy] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiClient<{ success: boolean; data: OrderKOT[] }>(`/orders/${orderId}/kots`);
      if (res.success) setKots(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load KOTs");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cancelling) setCancelling(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelling, onClose]);

  const runAction = async (kot: OrderKOT, action: "rush" | "reprint") => {
    setBusy(`${kot.id}:${action}`);
    setError(null);
    try {
      const res = await apiClient<{ success: boolean; message?: string }>(`/orders/${orderId}/kot/${kot.id}/${action}`, {
        method: "POST",
      });
      showNotification(action === "rush" ? `🚨 ${res.message ?? `KOT ${kot.kotNumber} rushed`}` : `🔁 ${res.message ?? `KOT ${kot.kotNumber} reprinted`}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} KOT`);
    } finally {
      setBusy(null);
    }
  };

  const openCancel = (kot: OrderKOT) => {
    setCancelling(kot);
    setReason(CANCEL_REASONS[0]!);
    setCustomReason("");
    setError(null);
    apiClient<{ success: boolean; data: Array<{ name: string; role: string }> }>("/auth/users")
      .then((res) => {
        if (!res.success) return;
        const managers = res.data.filter((u) => ["MANAGER", "OWNER", "ADMIN"].includes(u.role)).map((u) => u.name);
        const list = managers.length > 0 ? managers : res.data.map((u) => u.name);
        setApprovers(list);
        setApprovedBy(user?.name && list.includes(user.name) ? user.name : list[0] ?? "");
      })
      .catch(() => setApprovers([]));
  };

  const finalReason = reason === "Other" ? customReason.trim() : reason;

  const confirmCancel = async () => {
    if (!cancelling) return;
    if (!finalReason) return setError("Enter a reason for cancelling.");
    if (!approvedBy.trim()) return setError("Select the manager approving this cancellation.");
    setBusy(`${cancelling.id}:cancel`);
    setError(null);
    try {
      const res = await apiClient<{ success: boolean; message?: string }>(`/orders/${orderId}/kot/${cancelling.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: finalReason, approvedBy: approvedBy.trim() }),
      });
      showNotification(`❌ ${res.message ?? `KOT ${cancelling.kotNumber} cancelled`}`);
      setCancelling(null);
      await load();
      // Items on the KOT were voided server-side — refresh the cart
      await retrieveHeldBill(orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel KOT");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Kitchen tickets"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-text-main">Kitchen Tickets</h2>
            <p className="text-xs text-text-muted font-mono">
              Order #{orderNumber ?? "Active"} · {kots.length} KOT{kots.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover"
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <p className="mx-4 mt-3 text-xs font-semibold text-rose-600 bg-rose-500/10 border border-rose-300 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* KOT list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && kots.length === 0 && (
            <div className="py-10 flex justify-center text-text-muted">
              <Loader2 className="animate-spin" size={20} />
            </div>
          )}
          {!loading && kots.length === 0 && (
            <div className="py-10 text-center text-sm text-text-muted">No KOTs fired for this order yet.</div>
          )}

          {kots.map((kot) => {
            const status = STATUS_STYLE[kot.status] ?? STATUS_STYLE.PENDING;
            const cancelled = kot.status === "CANCELLED";
            return (
              <div
                key={kot.id}
                className={`rounded-xl border p-3 ${kot.isRush && isLive(kot) ? "border-rose-400 bg-rose-500/5" : "border-border bg-background"} ${cancelled ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-black text-text-main font-mono">KOT {kot.kotNumber}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${status.className}`}>{status.label}</span>
                      {kot.isRush && !cancelled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold">🚨 RUSH</span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted font-mono mt-0.5">
                      {formatTime(kot.createdAt)}
                      {kot.station ? ` · ${kot.station}` : ""}
                    </div>
                  </div>
                </div>

                <ul className="mt-2 space-y-0.5 text-xs text-text-main">
                  {kot.items.map((item) => (
                    <li key={item.orderItemId}>
                      <span className="font-bold font-mono">{item.quantity}×</span> {item.name}
                      {item.modifiers.length > 0 && <span className="text-text-muted"> · {item.modifiers.join(", ")}</span>}
                      {item.notes && <span className="text-text-muted italic"> · {item.notes}</span>}
                    </li>
                  ))}
                </ul>

                {cancelled && kot.cancelReason && (
                  <p className="mt-2 text-[11px] text-rose-600">
                    {kot.cancelReason}
                    {kot.cancelApprovedBy ? ` — approved by ${kot.cancelApprovedBy}` : ""}
                  </p>
                )}

                {!cancelled && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <button
                      onClick={() => runAction(kot, "rush")}
                      disabled={!isLive(kot) || !!busy}
                      title={
                        !isLive(kot)
                          ? "Already ready/served"
                          : kot.isRush
                            ? "Rush again: re-alerts the KDS and prints another urgent slip"
                            : "Alert the KDS and print an urgent kitchen slip"
                      }
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-all"
                    >
                      {busy === `${kot.id}:rush` ? <Loader2 size={12} className="animate-spin" /> : <Siren size={12} />}
                      {kot.isRush ? "Rush Again" : "Rush"}
                    </button>
                    <button
                      onClick={() => runAction(kot, "reprint")}
                      disabled={!!busy}
                      title="Reprint this kitchen ticket (printer jam / lost slip)"
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold border border-border-hover bg-surface hover:bg-surface-hover text-text-main disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-all"
                    >
                      {busy === `${kot.id}:reprint` ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                      Reprint
                    </button>
                    <button
                      onClick={() => openCancel(kot)}
                      disabled={!isLive(kot) || !!busy}
                      title={isLive(kot) ? "Cancel this KOT (manager approval)" : "Already ready/served — void items from the bill instead"}
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold border border-rose-300 text-rose-600 bg-surface hover:bg-rose-500/10 disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-all"
                    >
                      <Ban size={12} />
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Cancel confirmation */}
        {cancelling && (
          <div className="border-t border-border p-4 space-y-3 bg-background">
            <div className="text-sm font-bold text-text-main">Cancel KOT {cancelling.kotNumber}?</div>
            <p className="text-[11px] text-text-muted">
              All {cancelling.items.length} item(s) on this ticket are voided from the bill and the kitchen gets a cancellation slip.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  className={`text-[11px] px-2 py-1 rounded-lg border font-semibold ${
                    reason === r ? "border-primary bg-primary/10 text-text-main" : "border-border text-text-muted hover:text-text-main"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === "Other" && (
              <input
                autoFocus
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Reason"
                className="w-full h-9 rounded-lg border border-border bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            )}
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <span className="shrink-0 font-semibold">Approved by</span>
              {approvers.length > 0 ? (
                <select
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  className="flex-1 h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text-main"
                >
                  {approvers.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  placeholder="Manager name"
                  className="flex-1 h-9 rounded-lg border border-border bg-surface px-3 text-sm text-text-main"
                />
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCancelling(null)}
                className="py-2 rounded-lg text-xs font-bold border border-border-hover bg-surface hover:bg-surface-hover text-text-main"
              >
                Keep KOT
              </button>
              <button
                onClick={confirmCancel}
                disabled={!!busy}
                className="py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {busy === `${cancelling.id}:cancel` && <Loader2 size={12} className="animate-spin" />}
                Cancel KOT
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
