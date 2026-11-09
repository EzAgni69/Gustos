import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";

// ─── Types (subset of GET /api/orders/history) ───

interface Split {
  mode: string;
  subMethod?: string;
  amount: number;
}

interface PastOrder {
  id: string;
  orderNumber: string;
  orderMode: string;
  status: string;
  tableName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cashierName: string | null;
  createdAt: string;
  settlementLock: string | null;
  items: { id: string; menuItemName: string; variantName: string | null; quantity: number; unitPrice: number; status: string }[];
  invoice: {
    invoiceNumber: string;
    receiptStatus: string;
    subtotal: number;
    discountAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    totalAmount: number;
    tipAmount: number;
    paymentMode: string;
    paymentSubMethod: string | null;
    paymentSplits: Split[];
    isPaid: boolean;
    createdAt: string;
  } | null;
}

type Action = "NONE" | "CORRECT" | "VOID";
type Mode = "CASH" | "CARD" | "UPI" | "ONLINE" | "SPLIT";

const MODES: { id: Mode; label: string }[] = [
  { id: "CASH", label: "💵 Cash" },
  { id: "CARD", label: "💳 Card" },
  { id: "UPI", label: "📱 UPI" },
  { id: "ONLINE", label: "🌐 Online" },
  { id: "SPLIT", label: "➗ Split" },
];

const SUB_METHODS: Partial<Record<Mode, { id: string; label: string }[]>> = {
  UPI: [
    { id: "PHONEPE", label: "PhonePe" },
    { id: "GPAY", label: "GPay" },
    { id: "PAYTM", label: "Paytm" },
    { id: "OTHER_UPI", label: "Other UPI" },
  ],
  CARD: [
    { id: "VISA", label: "Visa" },
    { id: "MASTERCARD", label: "Mastercard" },
    { id: "RUPAY", label: "RuPay" },
    { id: "AMEX", label: "Amex" },
    { id: "OTHER_CARD", label: "Other" },
  ],
};

const CORRECTION_REASONS = ["Wrong mode selected by cashier", "Customer changed payment method", "UPI received, cash returned", "Card machine slip mismatch"];
const VOID_REASONS = ["Customer refund", "Duplicate settlement", "Billed to wrong table", "Order not served", "Test bill"];

const MODE_LABEL: Record<string, string> = { DINE_IN: "Dine-In", TAKEAWAY: "Takeaway", DELIVERY: "Delivery", ONLINE: "Online" };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const inr = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const isVoided = (o: PastOrder) => o.invoice?.receiptStatus === "VOIDED";
const payable = (o: PastOrder) => round2((o.invoice?.totalAmount ?? 0) + (o.invoice?.tipAmount ?? 0));

function tenderLabel(o: PastOrder): string {
  const inv = o.invoice;
  if (!inv) return "—";
  if (inv.paymentMode === "SPLIT" && inv.paymentSplits.length) {
    return inv.paymentSplits.map((s) => `${s.mode}${s.subMethod ? `/${s.subMethod}` : ""} ${inr(s.amount)}`).join(" + ");
  }
  return `${inv.paymentMode}${inv.paymentSubMethod ? ` · ${inv.paymentSubMethod}` : ""}`;
}

// ─── Component ───

export const PastOrdersModal: React.FC = () => {
  const { activeModal, closeModal, showNotification } = useUIStore();
  const { user } = useAuthStore();

  const [orders, setOrders] = useState<PastOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showVoided, setShowVoided] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>("NONE");
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<{ id: string; name: string; role: string }[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);
  const isVisible = activeModal === "PAST_ORDERS";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<{ success: boolean; data: { orders: PastOrder[] }; message?: string }>(
        `/orders/history?date=${todayStr()}`
      );
      if (!res.success) throw new Error(res.message || "Failed to load bills");
      const settled = res.data.orders
        .filter((o) => o.invoice && (o.invoice.isPaid || o.invoice.receiptStatus === "VOIDED"))
        .sort((a, b) => (b.invoice!.createdAt).localeCompare(a.invoice!.createdAt));
      setOrders(settled);
      setSelectedId((prev) => (prev && settled.some((o) => o.id === prev) ? prev : settled[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    setQuery("");
    setAction("NONE");
    load();
    setTimeout(() => searchRef.current?.focus(), 50);
    apiClient<{ success: boolean; data: { id: string; name: string; role: string }[] }>("/auth/users")
      .then((res) => res.success && setStaff(res.data))
      .catch(() => {});
  }, [isVisible, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return orders.filter((o) => {
      if (!showVoided && isVoided(o)) return false;
      if (!q) return true;
      const text = [o.invoice?.invoiceNumber, o.orderNumber, o.tableName, o.customerName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
      const phone = digits.length >= 3 && (o.customerPhone ?? "").replace(/\D/g, "").includes(digits);
      return text || phone;
    });
  }, [orders, query, showVoided]);

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  // Reset the action panel whenever the selection changes
  useEffect(() => setAction("NONE"), [selectedId]);

  if (!isVisible) return null;

  const settledCount = orders.filter((o) => !isVoided(o)).length;
  const settledTotal = round2(orders.filter((o) => !isVoided(o)).reduce((n, o) => n + payable(o), 0));

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = filtered.findIndex((o) => o.id === selectedId);
    const next = e.key === "ArrowDown" ? Math.min(filtered.length - 1, idx + 1) : Math.max(0, idx - 1);
    const target = filtered[next];
    if (target) setSelectedId(target.id);
  };

  const reprint = async (o: PastOrder) => {
    setBusy(true);
    try {
      await apiClient(`/print/reprint/${o.id}`, { method: "POST", body: JSON.stringify({ source: "pos" }) });
      showNotification(`🖨️ Duplicate bill queued for ${o.invoice?.invoiceNumber ?? o.orderNumber}`);
    } catch (e) {
      showNotification(`⚠️ Reprint failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 backdrop-blur-sm select-none">
      <div className="bg-background border border-border-hover rounded-2xl w-full max-w-6xl h-[90vh] overflow-hidden shadow-2xl flex flex-col text-text-main">
        {/* Header */}
        <div className="bg-surface px-5 py-3 border-b border-border flex items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span>🧾 Past Orders — Today</span>
              <span className="text-[10px] font-mono bg-highlight/20 text-highlight-hover px-2 py-0.5 rounded border border-highlight/30">Alt+R</span>
            </h2>
            <p className="text-xs text-text-muted font-mono">
              {settledCount} settled bills · {inr(settledTotal)} · duplicate print, payment-mode correction, post-settlement void
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="h-8 px-3 rounded-lg bg-background border border-border-hover hover:bg-surface-hover text-xs font-bold disabled:opacity-50"
          >
            {loading ? "…" : "⟳ Refresh"}
          </button>
          <button onClick={closeModal} className="w-8 h-8 rounded-lg bg-surface-hover text-text-muted hover:text-text-main font-bold">
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* List */}
          <div className="w-[40%] min-w-[320px] border-r border-border flex flex-col min-h-0">
            <div className="p-3 border-b border-border space-y-2">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search Bill #, Table #, or Customer Phone…"
                className="w-full h-10 px-3 rounded-lg bg-surface border border-border-hover text-sm focus:outline-none focus:border-primary"
              />
              <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer w-fit">
                <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
                Show voided bills
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {error ? (
                <div className="p-6 text-center text-sm">
                  <p className="font-semibold mb-2">⚠️ {error}</p>
                  <button onClick={load} className="px-4 py-2 rounded-lg bg-primary text-text-inverse text-xs font-bold">Retry</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-text-muted text-sm">
                  <div className="text-3xl mb-2">📭</div>
                  {loading ? "Loading…" : orders.length === 0 ? "No bills settled today yet" : "No bills match your search"}
                </div>
              ) : (
                filtered.map((o) => {
                  const voided = isVoided(o);
                  return (
                    <button
                      key={o.id}
                      onClick={() => setSelectedId(o.id)}
                      className={`w-full text-left px-3 py-2.5 border-b border-border flex items-center gap-3 ${
                        o.id === selectedId ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-surface"
                      } ${voided ? "opacity-60" : ""}`}
                    >
                      <div className="text-[11px] font-mono text-text-muted w-14 shrink-0">{time(o.invoice!.createdAt)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-black">{o.invoice!.invoiceNumber}</span>
                          {voided && <span className="text-[10px] px-1.5 rounded border bg-rose-100 text-rose-700 border-rose-300 font-bold">VOIDED</span>}
                          {o.invoice!.receiptStatus === "CORRECTED" && (
                            <span className="text-[10px] px-1.5 rounded border bg-amber-100 text-amber-700 border-amber-300 font-bold">CORRECTED</span>
                          )}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {o.tableName ? `📍 ${o.tableName}` : MODE_LABEL[o.orderMode] ?? o.orderMode}
                          {o.customerPhone ? ` · ${o.customerPhone}` : o.customerName ? ` · ${o.customerName}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-mono font-black text-sm ${voided ? "line-through" : ""}`}>{inr(payable(o))}</div>
                        <div className="text-[10px] font-mono text-text-muted">{o.invoice!.paymentMode}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Detail + actions */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {selected ? (
              <BillDetail
                key={selected.id}
                order={selected}
                action={action}
                setAction={setAction}
                busy={busy}
                setBusy={setBusy}
                staff={staff}
                defaultApprover={user?.name ?? ""}
                onReprint={() => reprint(selected)}
                onDone={async (msg) => {
                  showNotification(msg);
                  setAction("NONE");
                  await load();
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-text-muted">Select a bill</div>
            )}
          </div>
        </div>

        <div className="bg-surface px-5 py-2 border-t border-border text-[11px] text-text-muted font-mono flex gap-4">
          <span>↑/↓ select bill</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
};

// ─── Detail ───

const BillDetail: React.FC<{
  order: PastOrder;
  action: Action;
  setAction: (a: Action) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  staff: { id: string; name: string; role: string }[];
  defaultApprover: string;
  onReprint: () => void;
  onDone: (message: string) => Promise<void>;
}> = ({ order: o, action, setAction, busy, setBusy, staff, defaultApprover, onReprint, onDone }) => {
  const inv = o.invoice!;
  const voided = isVoided(o);
  const live = o.items.filter((i) => i.status !== "VOIDED");
  const locked = o.settlementLock;

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-black font-mono">{inv.invoiceNumber}</h3>
            {voided && <span className="text-xs px-2 py-0.5 rounded border bg-rose-100 text-rose-700 border-rose-300 font-bold">VOIDED</span>}
          </div>
          <div className="text-xs text-text-muted mt-1">
            Order #{o.orderNumber} · {MODE_LABEL[o.orderMode] ?? o.orderMode}
            {o.tableName && ` · 📍 ${o.tableName}`} · Settled {time(inv.createdAt)}
            {o.cashierName && ` · ${o.cashierName}`}
          </div>
          {(o.customerName || o.customerPhone) && (
            <div className="text-xs text-text-muted">👤 {[o.customerName, o.customerPhone].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-2xl font-black font-mono ${voided ? "line-through text-text-muted" : ""}`}>{inr(payable(o))}</div>
          <div className="text-xs font-mono text-text-muted">{tenderLabel(o)}</div>
        </div>
      </div>

      {/* Actions */}
      {!voided && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onReprint}
            disabled={busy}
            className="py-3 rounded-xl bg-highlight hover:bg-highlight-hover text-text-inverse text-sm font-black disabled:opacity-50"
          >
            🖨️ Duplicate Bill
          </button>
          <button
            onClick={() => setAction(action === "CORRECT" ? "NONE" : "CORRECT")}
            disabled={busy || !!locked}
            title={locked ?? undefined}
            className={`py-3 rounded-xl text-sm font-black border-2 disabled:opacity-40 ${
              action === "CORRECT" ? "bg-secondary text-text-inverse border-secondary" : "bg-background border-secondary text-secondary hover:bg-secondary/10"
            }`}
          >
            🔁 Correct Payment Mode
          </button>
          <button
            onClick={() => setAction(action === "VOID" ? "NONE" : "VOID")}
            disabled={busy || !!locked}
            title={locked ?? undefined}
            className={`py-3 rounded-xl text-sm font-black border-2 disabled:opacity-40 ${
              action === "VOID" ? "bg-primary text-text-inverse border-primary" : "bg-background border-primary text-primary hover:bg-primary/10"
            }`}
          >
            🚫 Void Bill
          </button>
        </div>
      )}

      {locked && !voided && (
        <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800">
          🔒 {locked}. Only duplicate print is available.
        </div>
      )}

      {action === "CORRECT" && (
        <CorrectionForm order={o} busy={busy} setBusy={setBusy} staff={staff} defaultApprover={defaultApprover} onDone={onDone} onCancel={() => setAction("NONE")} />
      )}
      {action === "VOID" && (
        <VoidForm order={o} busy={busy} setBusy={setBusy} staff={staff} defaultApprover={defaultApprover} onDone={onDone} onCancel={() => setAction("NONE")} />
      )}

      {/* Items */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {live.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">
                  {i.menuItemName}
                  {i.variantName && <span className="text-text-muted"> {i.variantName}</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono w-12">×{i.quantity}</td>
                <td className="px-3 py-1.5 text-right font-mono w-24">{inr(i.unitPrice * i.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-surface border-t border-border px-3 py-2 text-xs font-mono space-y-0.5">
          <Line label="Subtotal" value={inr(inv.subtotal)} />
          {inv.discountAmount > 0 && <Line label="Discount" value={`− ${inr(inv.discountAmount)}`} />}
          <Line label="Tax" value={inr(inv.cgstAmount + inv.sgstAmount)} />
          {inv.tipAmount > 0 && <Line label="Tip" value={inr(inv.tipAmount)} />}
          <div className="flex justify-between font-black text-sm pt-1 border-t border-border mt-1">
            <span>Total paid</span>
            <span>{inr(payable(o))}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Shared: reason + approver ───

const ReasonApprover: React.FC<{
  reasons: string[];
  reason: string;
  setReason: (r: string) => void;
  approvedBy: string;
  setApprovedBy: (a: string) => void;
  staff: { id: string; name: string; role: string }[];
}> = ({ reasons, reason, setReason, approvedBy, setApprovedBy, staff }) => {
  const approvers = staff.filter((u) => u.role !== "WAITER" && u.role !== "CAPTAIN");
  return (
    <>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Reason</div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {reasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                reason === r ? "bg-text-main text-text-inverse border-text-main" : "bg-background border-border-hover text-text-muted"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Or type a reason…"
          className="w-full h-9 px-3 rounded-lg bg-background border border-border-hover text-sm"
        />
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Approved by</div>
        {approvers.length > 0 ? (
          <select
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            className="w-full h-9 px-2 rounded-lg bg-background border border-border-hover text-sm"
          >
            <option value="">Select manager…</option>
            {approvers.map((u) => (
              <option key={u.id} value={u.name}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        ) : (
          <input
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            placeholder="Manager name"
            className="w-full h-9 px-3 rounded-lg bg-background border border-border-hover text-sm"
          />
        )}
      </div>
    </>
  );
};

interface FormProps {
  order: PastOrder;
  busy: boolean;
  setBusy: (b: boolean) => void;
  staff: { id: string; name: string; role: string }[];
  defaultApprover: string;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}

// ─── Payment mode correction ───

const CorrectionForm: React.FC<FormProps> = ({ order: o, busy, setBusy, staff, defaultApprover, onDone, onCancel }) => {
  const inv = o.invoice!;
  const total = payable(o);
  const current = inv.paymentMode as Mode;

  const [mode, setMode] = useState<Mode>(current === "CASH" ? "UPI" : "CASH");
  const [subMethod, setSubMethod] = useState<string>("");
  const [splits, setSplits] = useState<Split[]>(() =>
    inv.paymentSplits.length >= 2 ? inv.paymentSplits.map((s) => ({ ...s })) : [{ mode: "CASH", amount: total }, { mode: "UPI", amount: 0 }]
  );
  const [reason, setReason] = useState(CORRECTION_REASONS[0]!);
  const [approvedBy, setApprovedBy] = useState(defaultApprover);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSubMethod(SUB_METHODS[mode]?.[0]?.id ?? ""), [mode]);

  const splitSum = round2(splits.reduce((n, s) => n + (Number(s.amount) || 0), 0));
  const remaining = round2(total - splitSum);

  const updateSplit = (idx: number, patch: Partial<Split>) =>
    setSplits((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError("Enter a reason");
    if (!approvedBy.trim()) return setError("Select who approved this");
    if (mode === "SPLIT" && Math.abs(remaining) > 0.01) return setError(`Split must add up to ${inr(total)} (off by ${inr(remaining)})`);

    setBusy(true);
    try {
      await apiClient(`/orders/${o.id}/correct-payment`, {
        method: "POST",
        body: JSON.stringify({
          paymentMode: mode,
          paymentSubMethod: mode === "SPLIT" ? null : subMethod || null,
          paymentSplits:
            mode === "SPLIT"
              ? splits.filter((s) => Number(s.amount) > 0).map((s) => ({ mode: s.mode, subMethod: s.subMethod, amount: Number(s.amount) }))
              : undefined,
          reason: reason.trim(),
          approvedBy: approvedBy.trim(),
        }),
      });
      await onDone(`🔁 ${inv.invoiceNumber}: ${inv.paymentMode} → ${mode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-2 border-secondary/40 rounded-xl p-4 space-y-3 bg-secondary/5">
      <div className="text-sm font-black">
        Correct payment mode <span className="font-normal text-text-muted">— currently {tenderLabel(o)}</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`py-2 rounded-lg text-xs font-bold border ${
              mode === m.id ? "bg-secondary text-text-inverse border-secondary" : "bg-background border-border-hover"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {SUB_METHODS[mode] && (
        <div className="flex flex-wrap gap-1">
          {SUB_METHODS[mode]!.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSubMethod(s.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                subMethod === s.id ? "bg-secondary text-text-inverse border-secondary" : "bg-background border-border-hover text-text-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {mode === "SPLIT" && (
        <div className="space-y-1.5">
          {splits.map((s, idx) => (
            <div key={idx} className="flex gap-1.5 items-center">
              <select
                value={s.mode}
                onChange={(e) => updateSplit(idx, { mode: e.target.value, subMethod: undefined })}
                className="h-9 px-2 rounded-lg bg-background border border-border-hover text-sm"
              >
                {MODES.filter((m) => m.id !== "SPLIT").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={s.amount || ""}
                onChange={(e) => updateSplit(idx, { amount: Number(e.target.value) })}
                className="h-9 flex-1 px-3 rounded-lg bg-background border border-border-hover text-sm font-mono"
              />
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={() => updateSplit(idx, { amount: round2((Number(s.amount) || 0) + remaining) })}
                  className="h-9 px-2 rounded-lg border border-border-hover text-[11px] font-bold"
                  title="Add remaining amount to this leg"
                >
                  +{inr(remaining)}
                </button>
              )}
              {splits.length > 2 && (
                <button type="button" onClick={() => setSplits((p) => p.filter((_, i) => i !== idx))} className="h-9 px-2 text-text-muted">
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="flex justify-between text-xs">
            <button type="button" onClick={() => setSplits((p) => [...p, { mode: "CARD", amount: 0 }])} className="font-bold text-secondary">
              + Add leg
            </button>
            <span className={`font-mono font-bold ${Math.abs(remaining) > 0.01 ? "text-primary" : "text-secondary"}`}>
              {inr(splitSum)} / {inr(total)} {Math.abs(remaining) > 0.01 ? `(remaining ${inr(remaining)})` : "✓"}
            </span>
          </div>
        </div>
      )}

      <ReasonApprover reasons={CORRECTION_REASONS} reason={reason} setReason={setReason} approvedBy={approvedBy} setApprovedBy={setApprovedBy} staff={staff} />

      {current === "CASH" && mode !== "CASH" && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
          Expected cash in drawer for this shift will drop by {inr(total)}.
        </div>
      )}
      {error && <div className="text-xs text-primary font-semibold">⚠️ {error}</div>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-border-hover text-xs font-bold">
          Cancel
        </button>
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-secondary text-text-inverse text-xs font-black disabled:opacity-50">
          {busy ? "Saving…" : "Save correction"}
        </button>
      </div>
    </div>
  );
};

// ─── Post-settlement void ───

const VoidForm: React.FC<FormProps> = ({ order: o, busy, setBusy, staff, defaultApprover, onDone, onCancel }) => {
  const inv = o.invoice!;
  const [reason, setReason] = useState(VOID_REASONS[0]!);
  const [approvedBy, setApprovedBy] = useState(defaultApprover);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError("Enter a reason");
    if (!approvedBy.trim()) return setError("Select who approved this");
    if (!confirmed) return setError("Tick the confirmation box");

    setBusy(true);
    try {
      await apiClient(`/orders/${o.id}/void-settled`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim(), approvedBy: approvedBy.trim() }),
      });
      await onDone(`🚫 ${inv.invoiceNumber} voided — refund ${inr(payable(o))} via ${inv.paymentMode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Void failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-2 border-primary/40 rounded-xl p-4 space-y-3 bg-primary/5">
      <div className="text-sm font-black text-primary">Void settled bill {inv.invoiceNumber}</div>
      <p className="text-xs text-text-muted">
        The bill is reversed and removed from today's sales, shift totals and cloud reports. Refund{" "}
        <b className="text-text-main">{inr(payable(o))}</b> to the customer via <b className="text-text-main">{tenderLabel(o)}</b>. This cannot be undone.
      </p>

      <ReasonApprover reasons={VOID_REASONS} reason={reason} setReason={setReason} approvedBy={approvedBy} setApprovedBy={setApprovedBy} staff={staff} />

      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I have refunded / will refund {inr(payable(o))} to the customer
      </label>
      {error && <div className="text-xs text-primary font-semibold">⚠️ {error}</div>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-border-hover text-xs font-bold">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !confirmed}
          className="px-4 py-2 rounded-lg bg-primary text-text-inverse text-xs font-black disabled:opacity-50"
        >
          {busy ? "Voiding…" : "Void bill"}
        </button>
      </div>
    </div>
  );
};

const Line: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
