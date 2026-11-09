import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";
import { useUIStore } from "../../store/useUIStore";
import { useCartStore } from "../../store/useCartStore";

// ─── Types (mirror GET /api/orders/history) ───

interface HistoryItem {
  id: string;
  menuItemName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  status: string;
  modifiers: string[];
  addOns: { name: string; quantity: number; amount: number }[];
  notes: string | null;
  voidReason: string | null;
  isNcr: boolean;
}

interface HistoryKot {
  id: string;
  kotNumber: string;
  status: string;
  kotType: string;
  isRush: boolean;
  createdAt: string;
}

interface HistoryEvent {
  id: string;
  eventType: string;
  payload: Record<string, any>;
  userName: string | null;
  createdAt: string;
}

interface HistoryOrder {
  id: string;
  orderNumber: string;
  orderMode: string;
  status: string;
  tableId: string | null;
  tableName: string | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  customerName: string | null;
  customerPhone: string | null;
  waiterName: string | null;
  cashierName: string | null;
  paxCount: number;
  isComplimentary: boolean;
  createdAt: string;
  updatedAt: string;
  carriedOver: boolean;
  items: HistoryItem[];
  kots: HistoryKot[];
  events: HistoryEvent[];
  invoice: {
    invoiceNumber: string;
    receiptStatus: string;
    totalAmount: number;
    subtotal: number;
    discountAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    paymentMode: string;
    paymentSplits: { mode: string; amount: number }[];
    tipAmount: number;
    isPaid: boolean;
    createdAt: string;
  } | null;
}

interface ActivityEntry extends HistoryEvent {
  orderId: string;
  orderNumber: string;
  tableName: string | null;
  orderMode: string;
}

interface DayHistory {
  date: string;
  summary: {
    totalOrders: number;
    billedOrders: number;
    openOrders: number;
    openValue: number;
    cancelledOrders: number;
    complimentaryOrders: number;
    netSales: number;
    discount: number;
    tax: number;
    tips: number;
    avgTicket: number;
    kotCount: number;
    voidedItems: number;
    voidedValue: number;
    byOrderMode: Record<string, number>;
    byPaymentMode: Record<string, number>;
  };
  orders: HistoryOrder[];
  activity: ActivityEntry[];
}

type StatusFilter = "ALL" | "BILLED" | "OPEN" | "CANCELLED";

// ─── Helpers ───

const inr = (n: number) =>
  `₹${(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const shiftDate = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return toDateInput(new Date(y, m - 1, d + days));
};

const MODE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  ONLINE: "Online",
};

const isOpen = (o: HistoryOrder) => !["COMPLETED", "CANCELLED", "MERGED"].includes(o.status);
const isBilled = (o: HistoryOrder) => !!o.invoice?.isPaid;

function statusBadge(o: HistoryOrder): { label: string; cls: string } {
  if (o.invoice?.receiptStatus === "VOIDED") return { label: "Voided", cls: "bg-rose-100 text-rose-700 border-rose-300" };
  if (o.status === "CANCELLED") return { label: "Cancelled", cls: "bg-rose-100 text-rose-700 border-rose-300" };
  if (o.status === "MERGED") return { label: "Merged", cls: "bg-surface-hover text-text-muted border-border-hover" };
  if (isBilled(o)) return { label: "Paid", cls: "bg-emerald-100 text-emerald-700 border-emerald-300" };
  if (o.status === "DRAFT") return { label: "Draft", cls: "bg-surface-hover text-text-muted border-border-hover" };
  return { label: "Running", cls: "bg-amber-100 text-amber-700 border-amber-300" };
}

const EVENT_META: Record<string, { icon: string; label: string }> = {
  ORDER_CREATED: { icon: "🆕", label: "Order created" },
  ITEMS_ADDED: { icon: "➕", label: "Items added" },
  ITEM_ADDED: { icon: "➕", label: "Item added" },
  ITEM_REMOVED: { icon: "➖", label: "Item removed" },
  ITEM_QUANTITY_UPDATED: { icon: "🔢", label: "Quantity changed" },
  ITEM_VOIDED: { icon: "🚫", label: "Item voided" },
  ITEM_QUANTITY_SPLIT: { icon: "✂️", label: "Item split" },
  DISCOUNT_APPLIED: { icon: "🏷️", label: "Discount applied" },
  ITEM_DISCOUNT_APPLIED: { icon: "🏷️", label: "Item discount" },
  CUSTOMER_ATTACHED: { icon: "👤", label: "Customer linked" },
  ORDER_HELD: { icon: "⏸️", label: "Order held" },
  ORDER_CANCELLED: { icon: "❌", label: "Order cancelled" },
  ORDERS_MERGED: { icon: "🔗", label: "Orders merged in" },
  ORDER_MERGED_INTO: { icon: "🔗", label: "Merged into another order" },
  ITEMS_MOVED_OUT: { icon: "↗️", label: "Items moved out" },
  ITEMS_MOVED_IN: { icon: "↘️", label: "Items moved in" },
  REORDERED_FROM: { icon: "🔁", label: "Re-ordered" },
  ORDER_MODE_CHANGED: { icon: "🔀", label: "Mode changed" },
  WAITER_REASSIGNED: { icon: "🧑‍🍳", label: "Waiter reassigned" },
  ORDER_COMPLIMENTARY: { icon: "🎁", label: "Marked complimentary" },
  ONLINE_ORDER_ACCEPTED: { icon: "✅", label: "Online order accepted" },
  ONLINE_ORDER_REJECTED: { icon: "⛔", label: "Online order rejected" },
  MODIFICATION_KOT: { icon: "📝", label: "Modification KOT" },
  KOT_CANCELLED: { icon: "🗑️", label: "KOT cancelled" },
  KOT_RUSH: { icon: "⚡", label: "KOT rushed" },
  PAYMENT_RECEIVED: { icon: "💰", label: "Payment received" },
  PAYMENT_MODE_CORRECTED: { icon: "🔁", label: "Payment mode corrected" },
  SETTLED_BILL_VOIDED: { icon: "🚫", label: "Settled bill voided" },
  EXPO_BUMPED: { icon: "🛎️", label: "Sent out from the pass" },
  EXPO_RECALLED: { icon: "↩️", label: "Recalled to the pass" },
  UNDO: { icon: "↩️", label: "Undo" },
};

function eventMeta(type: string) {
  return EVENT_META[type] ?? { icon: "•", label: type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) };
}

function eventDetail(e: HistoryEvent): string | null {
  const p = e.payload || {};
  switch (e.eventType) {
    case "PAYMENT_RECEIVED":
      return [inr(Number(p.totalAmount)), p.paymentMode, p.invoiceNumber].filter(Boolean).join(" · ");
    case "PAYMENT_MODE_CORRECTED":
      return [`${p.from?.paymentMode ?? "?"} → ${p.to?.paymentMode ?? "?"}`, p.reason, p.approvedBy && `approved by ${p.approvedBy}`].filter(Boolean).join(" · ");
    case "SETTLED_BILL_VOIDED":
      return [inr(Number(p.refundAmount)), p.reason, p.approvedBy && `approved by ${p.approvedBy}`].filter(Boolean).join(" · ");
    case "ITEM_QUANTITY_UPDATED":
      return `${p.oldQuantity ?? "?"} → ${p.quantity ?? "?"}`;
    case "ORDER_MODE_CHANGED":
      return [p.oldMode, p.newMode].filter(Boolean).map((m: string) => MODE_LABEL[m] ?? m).join(" → ") || null;
    case "ITEM_VOIDED":
      return [p.voidQuantity ? `${p.voidQuantity}× ${p.menuItemName}` : p.menuItemName, p.reason].filter(Boolean).join(" · ") || null;
    case "ORDER_HELD":
    case "ORDER_CREATED":
      return p.orderMode ? MODE_LABEL[p.orderMode] ?? p.orderMode : null;
    case "ONLINE_ORDER_REJECTED":
      return p.reason ?? null;
    default:
      return null;
  }
}

// ─── Component ───

export const DayHistoryModal: React.FC = () => {
  const { activeModal, closeModal, openBillPreview, showNotification, setActiveView } = useUIStore();
  const { retrieveHeldBill, loadTableOrder } = useCartStore();

  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [data, setData] = useState<DayHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"ORDERS" | "ACTIVITY">("ORDERS");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [modeFilter, setModeFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isVisible = activeModal === "DAY_HISTORY";
  const today = toDateInput(new Date());

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<{ success: boolean; data: DayHistory; message?: string }>(
        `/orders/history?date=${encodeURIComponent(d)}`
      );
      if (!res.success) throw new Error(res.message || "Failed to load history");
      setData(res.data);
      setSelectedId((prev) => (prev && res.data.orders.some((o) => o.id === prev) ? prev : res.data.orders[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible) load(date);
  }, [isVisible, date, load]);

  const filteredOrders = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.orders.filter((o) => {
      if (statusFilter === "BILLED" && !isBilled(o)) return false;
      if (statusFilter === "OPEN" && !isOpen(o)) return false;
      if (statusFilter === "CANCELLED" && o.status !== "CANCELLED") return false;
      if (modeFilter !== "ALL" && o.orderMode !== modeFilter) return false;
      if (!q) return true;
      return [o.orderNumber, o.tableName, o.customerName, o.customerPhone, o.invoice?.invoiceNumber, o.waiterName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [data, statusFilter, modeFilter, query]);

  const selected = useMemo(
    () => data?.orders.find((o) => o.id === selectedId) ?? null,
    [data, selectedId]
  );

  if (!isVisible) return null;

  const s = data?.summary;
  const counts = data
    ? {
        ALL: data.orders.length,
        BILLED: data.orders.filter(isBilled).length,
        OPEN: data.orders.filter(isOpen).length,
        CANCELLED: data.orders.filter((o) => o.status === "CANCELLED").length,
      }
    : { ALL: 0, BILLED: 0, OPEN: 0, CANCELLED: 0 };

  const handleViewBill = (o: HistoryOrder) => {
    const live = o.items.filter((i) => i.status !== "VOIDED");
    openBillPreview({
      orderId: o.id,
      orderNumber: o.orderNumber,
      isPaid: isBilled(o),
      invoiceNumber: o.invoice?.invoiceNumber,
      tableName: o.tableName ?? undefined,
      orderMode: o.orderMode,
      customerName: o.customerName ?? undefined,
      items: live.map((i) => ({
        name: i.menuItemName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: Math.round(i.unitPrice * i.quantity * 100) / 100,
        variantName: i.variantName ?? undefined,
        modifiers: i.modifiers,
        notes: i.notes ?? undefined,
      })),
      subtotal: o.invoice?.subtotal ?? o.subtotal,
      discountAmount: o.invoice?.discountAmount ?? o.discountAmount,
      taxAmount: o.invoice ? o.invoice.cgstAmount + o.invoice.sgstAmount : o.taxAmount,
      grandTotal: o.invoice?.totalAmount ?? o.totalAmount,
      paymentMode: o.invoice?.paymentMode,
      date: o.invoice?.createdAt ?? o.createdAt,
    });
  };

  const handleReprint = async (o: HistoryOrder) => {
    setBusy(true);
    try {
      await apiClient(`/print/reprint/${o.id}`, { method: "POST", body: JSON.stringify({ source: "pos" }) });
      showNotification(`🖨️ Duplicate bill queued for #${o.orderNumber}`);
    } catch (e) {
      showNotification(`⚠️ Reprint failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async (o: HistoryOrder) => {
    setBusy(true);
    try {
      if (o.tableId) {
        await loadTableOrder(o.tableId, o.tableName ?? undefined, o.id);
      } else {
        await retrieveHeldBill(o.id);
      }
      setActiveView("BILLING");
      closeModal();
      showNotification(`▶️ Loaded #${o.orderNumber} into billing counter`);
    } catch {
      showNotification("⚠️ Could not load order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 backdrop-blur-sm select-none">
      <div className="bg-background border border-border-hover rounded-2xl w-full max-w-7xl h-[92vh] overflow-hidden shadow-2xl flex flex-col text-text-main">
        {/* ─── Header ─── */}
        <div className="bg-surface px-5 py-3 border-b border-border flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span>🕘 Day History</span>
              <span className="text-[10px] font-mono bg-highlight/20 text-highlight-hover px-2 py-0.5 rounded border border-highlight/30">
                Ctrl+H
              </span>
            </h2>
            <p className="text-xs text-text-muted font-mono">
              Every order, KOT, payment and change made on this terminal for the day
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setDate((d) => shiftDate(d, -1))}
              className="w-8 h-8 rounded-lg bg-background border border-border-hover hover:bg-surface-hover font-bold"
              title="Previous day"
            >
              ‹
            </button>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-8 px-2 rounded-lg bg-background border border-border-hover text-sm font-mono"
            />
            <button
              onClick={() => setDate((d) => shiftDate(d, 1))}
              disabled={date >= today}
              className="w-8 h-8 rounded-lg bg-background border border-border-hover hover:bg-surface-hover font-bold disabled:opacity-40"
              title="Next day"
            >
              ›
            </button>
            {date !== today && (
              <button
                onClick={() => setDate(today)}
                className="h-8 px-3 rounded-lg bg-background border border-border-hover hover:bg-surface-hover text-xs font-bold"
              >
                Today
              </button>
            )}
            <button
              onClick={() => load(date)}
              disabled={loading}
              className="h-8 px-3 rounded-lg bg-background border border-border-hover hover:bg-surface-hover text-xs font-bold disabled:opacity-50"
              title="Refresh"
            >
              {loading ? "…" : "⟳"}
            </button>
          </div>

          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* ─── Summary tiles ─── */}
        {s && (
          <div className="px-5 py-3 border-b border-border bg-background">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              <Tile label="Net Sales" value={inr(s.netSales)} accent="text-secondary" />
              <Tile label="Bills Settled" value={String(s.billedOrders)} sub={`${s.totalOrders} orders total`} />
              <Tile label="Avg Bill" value={inr(s.avgTicket)} />
              <Tile label="Running" value={String(s.openOrders)} sub={inr(s.openValue)} accent={s.openOrders ? "text-highlight-hover" : undefined} />
              <Tile label="Discounts" value={inr(s.discount)} sub={`Tax ${inr(s.tax)}`} />
              <Tile label="KOTs" value={String(s.kotCount)} />
              <Tile
                label="Voids / Cancels"
                value={`${s.voidedItems} / ${s.cancelledOrders}`}
                sub={s.voidedValue ? `${inr(s.voidedValue)} voided` : undefined}
                accent={s.voidedItems || s.cancelledOrders ? "text-primary" : undefined}
              />
            </div>
            {(Object.keys(s.byPaymentMode).length > 0 || Object.keys(s.byOrderMode).length > 0) && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs">
                {Object.keys(s.byPaymentMode).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-text-muted font-semibold">Payments:</span>
                    {Object.entries(s.byPaymentMode)
                      .sort((a, b) => b[1] - a[1])
                      .map(([mode, amt]) => (
                        <span key={mode} className="px-2 py-0.5 rounded bg-surface border border-border font-mono">
                          {mode} <b>{inr(amt)}</b>
                        </span>
                      ))}
                  </div>
                )}
                {Object.keys(s.byOrderMode).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-text-muted font-semibold">Modes:</span>
                    {Object.entries(s.byOrderMode).map(([mode, n]) => (
                      <span key={mode} className="px-2 py-0.5 rounded bg-surface border border-border font-mono">
                        {MODE_LABEL[mode] ?? mode} <b>{n}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── Tabs ─── */}
        <div className="px-5 pt-2 flex items-center gap-1 border-b border-border bg-background">
          {(["ORDERS", "ACTIVITY"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-bold rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === t ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"
              }`}
            >
              {t === "ORDERS" ? `Orders (${data?.orders.length ?? 0})` : `Activity Timeline (${data?.activity.length ?? 0})`}
            </button>
          ))}
        </div>

        {/* ─── Body ─── */}
        <div className="flex-1 min-h-0 flex">
          {error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 p-6">
              <div className="text-3xl">⚠️</div>
              <p className="text-sm font-semibold">{error}</p>
              <button onClick={() => load(date)} className="px-4 py-2 rounded-lg bg-primary text-text-inverse text-xs font-bold">
                Retry
              </button>
            </div>
          ) : !data ? (
            <div className="flex-1 flex items-center justify-center text-sm text-text-muted">Loading history…</div>
          ) : tab === "ACTIVITY" ? (
            <ActivityFeed
              entries={data.activity}
              onSelect={(id) => {
                setSelectedId(id);
                setStatusFilter("ALL");
                setModeFilter("ALL");
                setQuery("");
                setTab("ORDERS");
              }}
            />
          ) : (
            <>
              {/* Order list */}
              <div className="w-[38%] min-w-[300px] border-r border-border flex flex-col min-h-0">
                <div className="p-3 space-y-2 border-b border-border">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search order #, table, customer, invoice…"
                    className="w-full h-9 px-3 rounded-lg bg-surface border border-border-hover text-sm focus:outline-none focus:border-primary"
                  />
                  <div className="flex flex-wrap gap-1">
                    {(["ALL", "BILLED", "OPEN", "CANCELLED"] as const).map((f) => (
                      <Chip key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
                        {f === "ALL" ? "All" : f === "BILLED" ? "Paid" : f === "OPEN" ? "Running" : "Cancelled"} {counts[f]}
                      </Chip>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {["ALL", ...Object.keys(data.summary.byOrderMode)].map((m) => (
                      <Chip key={m} active={modeFilter === m} onClick={() => setModeFilter(m)}>
                        {m === "ALL" ? "All modes" : MODE_LABEL[m] ?? m}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {filteredOrders.length === 0 ? (
                    <div className="text-center py-16 text-text-muted text-sm">
                      <div className="text-3xl mb-2">📭</div>
                      {data.orders.length === 0 ? "No orders on this day" : "No orders match these filters"}
                    </div>
                  ) : (
                    filteredOrders.map((o) => {
                      const badge = statusBadge(o);
                      const qty = o.items.filter((i) => i.status !== "VOIDED").reduce((n, i) => n + i.quantity, 0);
                      return (
                        <button
                          key={o.id}
                          onClick={() => setSelectedId(o.id)}
                          className={`w-full text-left px-3 py-2.5 border-b border-border flex items-center gap-3 transition-colors ${
                            o.id === selectedId ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-surface"
                          }`}
                        >
                          <div className="text-[11px] font-mono text-text-muted w-14 shrink-0">{time(o.createdAt)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-black">#{o.orderNumber}</span>
                              <span className={`text-[10px] px-1.5 py-px rounded border font-bold ${badge.cls}`}>{badge.label}</span>
                              {o.isComplimentary && <span className="text-[10px]" title="Complimentary">🎁</span>}
                              {o.carriedOver && (
                                <span className="text-[10px] text-text-muted" title="Opened on an earlier day">
                                  ↩ prev day
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-text-muted truncate">
                              {o.tableName ? `📍 ${o.tableName}` : MODE_LABEL[o.orderMode] ?? o.orderMode}
                              {` · ${qty} items`}
                              {o.customerName ? ` · ${o.customerName}` : ""}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`font-mono font-black text-sm ${o.status === "CANCELLED" ? "line-through text-text-muted" : ""}`}>
                              {inr(o.invoice?.totalAmount ?? o.totalAmount)}
                            </div>
                            {o.invoice && <div className="text-[10px] font-mono text-text-muted">{o.invoice.paymentMode}</div>}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Order detail */}
              <div className="flex-1 min-w-0 overflow-y-auto">
                {selected ? (
                  <OrderDetail
                    order={selected}
                    busy={busy}
                    onViewBill={() => handleViewBill(selected)}
                    onReprint={() => handleReprint(selected)}
                    onResume={() => handleResume(selected)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-text-muted">
                    Select an order to see its full history
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Sub-components ───

const Tile: React.FC<{ label: string; value: string; sub?: string; accent?: string }> = ({ label, value, sub, accent }) => (
  <div className="bg-surface border border-border rounded-xl px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">{label}</div>
    <div className={`text-lg font-black font-mono leading-tight ${accent ?? ""}`}>{value}</div>
    {sub && <div className="text-[10px] text-text-muted font-mono">{sub}</div>}
  </div>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
      active ? "bg-primary text-text-inverse border-primary" : "bg-background text-text-muted border-border-hover hover:text-text-main"
    }`}
  >
    {children}
  </button>
);

const OrderDetail: React.FC<{
  order: HistoryOrder;
  busy: boolean;
  onViewBill: () => void;
  onReprint: () => void;
  onResume: () => void;
}> = ({ order: o, busy, onViewBill, onReprint, onResume }) => {
  const badge = statusBadge(o);
  const live = o.items.filter((i) => i.status !== "VOIDED");
  const voided = o.items.filter((i) => i.status === "VOIDED");
  const inv = o.invoice;

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-black font-mono">#{o.orderNumber}</h3>
            <span className={`text-xs px-2 py-0.5 rounded border font-bold ${badge.cls}`}>{badge.label}</span>
          </div>
          <div className="text-xs text-text-muted mt-1 space-x-2">
            <span>{MODE_LABEL[o.orderMode] ?? o.orderMode}</span>
            {o.tableName && <span>· 📍 {o.tableName}</span>}
            {o.paxCount > 1 && <span>· {o.paxCount} pax</span>}
            <span>· Opened {time(o.createdAt)}</span>
            {inv && <span>· Billed {time(inv.createdAt)}</span>}
          </div>
          <div className="text-xs text-text-muted mt-0.5 space-x-2">
            {o.waiterName && <span>Waiter: {o.waiterName}</span>}
            {o.cashierName && <span>· Cashier: {o.cashierName}</span>}
            {o.customerName && (
              <span>
                · 👤 {o.customerName}
                {o.customerPhone ? ` (${o.customerPhone})` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {o.status !== "CANCELLED" && live.length > 0 && (
            <button
              onClick={onViewBill}
              className="px-3 py-2 rounded-lg bg-surface border border-border-hover hover:bg-surface-hover text-xs font-bold"
            >
              🧾 View Bill
            </button>
          )}
          {inv?.isPaid && (
            <button
              onClick={onReprint}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-highlight hover:bg-highlight-hover text-text-inverse text-xs font-bold disabled:opacity-50"
            >
              🖨️ Reprint
            </button>
          )}
          {isOpen(o) && (
            <button
              onClick={onResume}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-primary hover:bg-primary-hover text-text-inverse text-xs font-bold disabled:opacity-50"
            >
              ▶️ Open in Billing
            </button>
          )}
        </div>
      </div>

      {/* Items */}
      <section>
        <SectionTitle>Items</SectionTitle>
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left px-3 py-1.5">Item</th>
                <th className="text-right px-3 py-1.5 w-14">Qty</th>
                <th className="text-right px-3 py-1.5 w-20">Rate</th>
                <th className="text-right px-3 py-1.5 w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...live, ...voided].map((i) => {
                const isVoid = i.status === "VOIDED";
                return (
                  <tr key={i.id} className={`border-t border-border ${isVoid ? "text-text-muted bg-rose-50" : ""}`}>
                    <td className="px-3 py-1.5">
                      <div className={isVoid ? "line-through" : "font-semibold"}>
                        {i.menuItemName}
                        {i.variantName ? <span className="text-text-muted font-normal"> {i.variantName}</span> : null}
                        {i.isNcr && <span className="ml-1 text-[10px] text-highlight-hover">NC</span>}
                      </div>
                      {(i.modifiers.length > 0 || i.addOns.length > 0 || i.notes) && (
                        <div className="text-[11px] text-text-muted">
                          {[...i.modifiers, ...i.addOns.map((a) => `+${a.name}`), i.notes ? `“${i.notes}”` : null]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                      {isVoid && <div className="text-[11px] text-primary font-semibold">Voided{i.voidReason ? `: ${i.voidReason}` : ""}</div>}
                    </td>
                    <td className="text-right px-3 py-1.5 font-mono">{i.quantity}</td>
                    <td className="text-right px-3 py-1.5 font-mono">{inr(i.unitPrice)}</td>
                    <td className={`text-right px-3 py-1.5 font-mono ${isVoid ? "line-through" : ""}`}>{inr(i.unitPrice * i.quantity)}</td>
                  </tr>
                );
              })}
              {o.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-text-muted text-xs">
                    No items
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="bg-surface border-t border-border px-3 py-2 text-xs font-mono space-y-0.5">
            <Row label="Subtotal" value={inr(inv?.subtotal ?? o.subtotal)} />
            {(inv?.discountAmount ?? o.discountAmount) > 0 && (
              <Row label="Discount" value={`− ${inr(inv?.discountAmount ?? o.discountAmount)}`} />
            )}
            <Row label="Tax" value={inr(inv ? inv.cgstAmount + inv.sgstAmount : o.taxAmount)} />
            {inv && inv.tipAmount > 0 && <Row label="Tip" value={inr(inv.tipAmount)} />}
            <Row label="Total" value={inr(inv?.totalAmount ?? o.totalAmount)} bold />
          </div>
        </div>
      </section>

      {/* Payment */}
      {inv && (
        <section>
          <SectionTitle>Payment</SectionTitle>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-surface border border-border font-mono">Invoice {inv.invoiceNumber}</span>
            {inv.paymentSplits.length > 0 ? (
              inv.paymentSplits.map((sp, idx) => (
                <span key={idx} className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 font-mono">
                  {sp.mode} {inr(sp.amount)}
                </span>
              ))
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 font-mono">
                {inv.paymentMode} {inr(inv.totalAmount)}
              </span>
            )}
          </div>
        </section>
      )}

      {/* KOTs */}
      {o.kots.length > 0 && (
        <section>
          <SectionTitle>Kitchen Tickets ({o.kots.length})</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {o.kots.map((k) => (
              <div
                key={k.id}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono ${
                  k.status === "CANCELLED" || k.kotType === "CANCELLATION"
                    ? "bg-rose-50 border-rose-200 text-rose-700"
                    : "bg-surface border-border"
                }`}
              >
                <b>KOT {k.kotNumber}</b> · {time(k.createdAt)}
                {k.kotType !== "ORIGINAL" && <span className="ml-1">({k.kotType.toLowerCase()})</span>}
                {k.isRush && <span className="ml-1">⚡</span>}
                <span className="ml-1 text-text-muted">{k.status.toLowerCase()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      <section>
        <SectionTitle>Timeline</SectionTitle>
        {o.events.length === 0 ? (
          <div className="text-xs text-text-muted">No events recorded</div>
        ) : (
          <ol className="border-l-2 border-border ml-2 space-y-2.5">
            {o.events.map((e) => {
              const meta = eventMeta(e.eventType);
              const detail = eventDetail(e);
              return (
                <li key={e.id} className="ml-4 relative">
                  <span className="absolute -left-[25px] top-0.5 w-4 h-4 rounded-full bg-background border-2 border-border-hover text-[9px] flex items-center justify-center" />
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono text-text-muted w-16 shrink-0">{time(e.createdAt)}</span>
                    <span>{meta.icon}</span>
                    <span className="font-semibold">{meta.label}</span>
                    {detail && <span className="text-text-muted">· {detail}</span>}
                    {e.userName && <span className="text-text-muted ml-auto">by {e.userName}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
};

const ActivityFeed: React.FC<{ entries: ActivityEntry[]; onSelect: (orderId: string) => void }> = ({ entries, onSelect }) => {
  if (entries.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-sm text-text-muted">No activity recorded on this day</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((e) => {
        const meta = eventMeta(e.eventType);
        const detail = eventDetail(e);
        return (
          <button
            key={e.id}
            onClick={() => onSelect(e.orderId)}
            className="w-full text-left px-5 py-2 border-b border-border hover:bg-surface flex items-center gap-3 text-sm"
          >
            <span className="font-mono text-xs text-text-muted w-16 shrink-0">{time(e.createdAt)}</span>
            <span className="w-5 text-center">{meta.icon}</span>
            <span className="font-semibold">{meta.label}</span>
            <span className="font-mono text-xs bg-surface border border-border px-1.5 rounded">#{e.orderNumber}</span>
            {e.tableName && <span className="text-xs text-text-muted">📍 {e.tableName}</span>}
            {detail && <span className="text-xs text-text-muted truncate">· {detail}</span>}
            {e.userName && <span className="text-xs text-text-muted ml-auto shrink-0">by {e.userName}</span>}
          </button>
        );
      })}
    </div>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[11px] uppercase tracking-wider font-black text-text-muted mb-2">{children}</h4>
);

const Row: React.FC<{ label: string; value: string; bold?: boolean }> = ({ label, value, bold }) => (
  <div className={`flex justify-between ${bold ? "font-black text-sm pt-1 border-t border-border mt-1" : ""}`}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);
