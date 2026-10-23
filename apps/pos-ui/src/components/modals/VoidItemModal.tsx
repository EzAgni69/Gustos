import React, { useState, useEffect } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";
import { apiClient } from "../../api/client";

const DEFAULT_REASON = "Accidental punch / Mistake";

const QUICK_REASONS = [
  DEFAULT_REASON,
  "Entered excess quantity",
  "Customer changed mind",
  "Kitchen unable to prepare",
  "Wrong table selected",
  "Other",
];

export const VoidItemModal: React.FC = () => {
  const { voidItem } = useCartStore();
  const { activeModal, closeModal, voidItemTarget, showNotification } = useUIStore();
  const { user } = useAuthStore();

  const [voidQuantity, setVoidQuantity] = useState<number>(1);
  const [selectedReason, setSelectedReason] = useState<string>(DEFAULT_REASON);
  const [customReason, setCustomReason] = useState<string>("");
  const [approvedBy, setApprovedBy] = useState<string>("");
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeModal === "VOID_ITEM" && voidItemTarget) {
      setVoidQuantity(1);
      setSelectedReason(DEFAULT_REASON);
      setCustomReason("");
      setError(null);

      // Default approvedBy to current user or first manager
      setApprovedBy(user?.name || "Manager");

      // Fetch active users for manager approval list
      apiClient<{ success: boolean; data: Array<{ id: string; name: string; role: string }> }>("/auth/users")
        .then((res) => {
          if (res.success && res.data) {
            setStaffUsers(res.data);
            const manager = res.data.find((u) => u.role === "MANAGER" || u.role === "OWNER" || u.role === "ADMIN");
            if (manager && !user) {
              setApprovedBy(manager.name);
            }
          }
        })
        .catch(() => {});
    }
  }, [activeModal, voidItemTarget, user]);

  if (activeModal !== "VOID_ITEM" || !voidItemTarget) return null;

  const maxQty = voidItemTarget.quantity;
  const isFullVoid = voidQuantity >= maxQty;
  const finalReason = selectedReason === "Other" && customReason.trim()
    ? customReason.trim()
    : selectedReason;

  const handleConfirm = async () => {
    if (!voidItemTarget) return;
    if (!finalReason) {
      setError("Please select or enter a reason for voiding.");
      return;
    }
    const approver = approvedBy.trim() || user?.name || "Manager";

    setIsSubmitting(true);
    setError(null);
    try {
      await voidItem(
        voidItemTarget.cartItemId,
        finalReason,
        approver,
        voidQuantity
      );
      showNotification(`✅ Voided ${voidQuantity}x ${voidItemTarget.menuItemName}. Kitchen alerted.`);
      closeModal();
    } catch (err) {
      console.error("Void error:", err);
      setError(err instanceof Error ? err.message : "Failed to void item");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-surface border border-rose-500/40 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-rose-950/30 px-6 py-4 border-b border-rose-900/40 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-rose-300 flex items-center gap-2">
              <span>⚠️ VOID / CANCEL FIRED ITEM (NCR)</span>
            </h2>
            <p className="text-xs text-rose-400/80 font-mono mt-0.5">
              Item already fired to kitchen • Correction ticket will be generated
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Target Item Summary */}
          <div className="bg-background border border-border p-4 rounded-xl flex items-center justify-between">
            <div>
              <div className="font-bold text-sm text-text-main">
                {voidItemTarget.menuItemName}
              </div>
              <div className="text-xs text-text-muted font-mono mt-0.5">
                Unit Price: ₹{voidItemTarget.unitPrice} • Currently on Order: <span className="text-primary-hover font-bold">{voidItemTarget.quantity}</span>
              </div>
            </div>
            <span className="text-xs bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-1 rounded font-mono font-semibold">
              KOT Fired
            </span>
          </div>

          {/* Quantity Selector */}
          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider block mb-2">
              Quantity to Void / Cancel:
            </label>
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-background border border-border rounded-lg p-1 gap-2">
                <button
                  type="button"
                  onClick={() => setVoidQuantity((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 bg-surface hover:bg-surface-hover text-text-main rounded-md flex items-center justify-center font-bold text-base"
                >
                  -
                </button>
                <span className="w-12 text-center text-lg font-black text-rose-400 font-mono">
                  {voidQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setVoidQuantity((q) => Math.min(maxQty, q + 1))}
                  className="w-9 h-9 bg-surface hover:bg-surface-hover text-text-main rounded-md flex items-center justify-center font-bold text-base"
                >
                  +
                </button>
              </div>

              {maxQty > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVoidQuantity(1)}
                    className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                      voidQuantity === 1
                        ? "bg-rose-500/20 border-rose-500 text-rose-300"
                        : "bg-surface border-border text-text-muted hover:text-text-main"
                    }`}
                  >
                    Void 1 (Keep {maxQty - 1})
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoidQuantity(maxQty)}
                    className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                      voidQuantity === maxQty
                        ? "bg-rose-500/20 border-rose-500 text-rose-300"
                        : "bg-surface border-border text-text-muted hover:text-text-main"
                    }`}
                  >
                    Void All ({maxQty})
                  </button>
                </div>
              )}
            </div>

            <p className="text-[11px] text-text-muted font-mono mt-1.5">
              {isFullVoid
                ? "⚠️ Entire item will be voided and removed from customer bill."
                : `💡 ${maxQty - voidQuantity}x ${voidItemTarget.menuItemName} will remain on the bill. Kitchen will be notified of 1 cancelled.`}
            </p>
          </div>

          {/* Reason Selection */}
          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider block mb-2">
              Reason for Void (Mandatory for NCR Audit):
            </label>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedReason(r)}
                  className={`text-left p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                    selectedReason === r
                      ? "bg-primary/20 border-primary text-primary-hover font-bold"
                      : "bg-background border-border text-text-muted hover:text-text-main hover:bg-surface"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            {selectedReason === "Other" && (
              <input
                type="text"
                placeholder="Enter specific reason..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="w-full mt-2 bg-background border border-border rounded-lg px-3 py-2 text-xs text-text-main focus:outline-none focus:border-primary"
              />
            )}
          </div>

          {/* Manager Approval */}
          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider block mb-1.5">
              Authorized Staff / Manager:
            </label>
            <div className="flex gap-2">
              {staffUsers.length > 0 ? (
                <select
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-text-main focus:outline-none focus:border-primary"
                >
                  {staffUsers.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Manager name"
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-text-main focus:outline-none focus:border-primary"
                />
              )}
            </div>
          </div>

          {/* Error Notice */}
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-lg text-xs">
              ⚠️ {error}
            </div>
          )}

          {/* Kitchen Notice */}
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg text-xs flex items-center gap-2">
            <span>📢</span>
            <span>
              This sends a modification slip to the kitchen printer and updates the KDS TV display in real time.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-background px-6 py-4 border-t border-border flex items-center justify-between">
          <button
            type="button"
            onClick={closeModal}
            disabled={isSubmitting}
            className="px-4 py-2.5 bg-surface hover:bg-surface-hover text-text-muted hover:text-text-main text-xs font-bold rounded-lg border border-border"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-lg shadow-rose-900/30 flex items-center gap-2 transition-colors"
          >
            {isSubmitting ? "Processing..." : `Confirm Void (${voidQuantity}x) & Alert Kitchen`}
          </button>
        </div>
      </div>
    </div>
  );
};
