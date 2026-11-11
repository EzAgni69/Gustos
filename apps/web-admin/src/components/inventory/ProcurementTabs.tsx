"use client";

/**
 * Inventory → Purchase Orders and Goods Received Notes.
 *
 * Purchase orders: DRAFT → SENT → PARTIAL → FULFILLED (or CANCELLED before any
 * goods arrive). PARTIAL / FULFILLED are set by the server when goods are
 * received — never by hand.
 *
 * Receiving goods (a GRN) is what puts stock on the shelf; the server updates
 * inventory and the stock audit trail in the same transaction.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, PackageCheck, Plus, RefreshCw, Send, ShoppingCart, Trash2, XCircle } from "lucide-react";
import type { GrnDetail, InventoryItem, Outlet, PurchaseOrderDetail, Vendor } from "@gusto/api-contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiFetch } from "@/lib/api-client";
import { getPersistedOutletId } from "@/lib/outlet-context";
import { calculatePOTotal } from "@/lib/po-utils";
import { useToast } from "@/lib/toast";

type PoStatus = "DRAFT" | "SENT" | "PARTIAL" | "FULFILLED" | "CANCELLED";

interface PoRow {
  id: string;
  poNumber: string;
  status: PoStatus;
  totalAmount: number;
  vendorName: string;
  outletName: string;
  outletId: string;
  itemCount: number;
  expectedDeliveryDate: string | null;
  createdAt: string;
}

interface GrnRow {
  id: string;
  grnNumber: string;
  poNumber: string | null;
  vendorName: string | null;
  outletName: string;
  itemCount: number;
  totalValue: number;
  receivedDate: string;
}

interface Line {
  key: number;
  inventoryItemId: string;
  quantity: string;
  unitPrice: string;
}

const PAGE_SIZE = 20;

const STATUS_STYLE: Record<PoStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-800",
  FULFILLED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const formatDate = (value: string | Date | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

let lineKey = 0;
const newLine = (): Line => ({ key: ++lineKey, inventoryItemId: "", quantity: "", unitPrice: "" });

function StatusPill({ status }: { status: PoStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[status]}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
        Retry
      </Button>
    </div>
  );
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  );
}

/** Reference data both tabs need. Loaded once, when a tab is first shown. */
function useProcurementReferenceData(enabled: boolean) {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [materials, setMaterials] = useState<InventoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [o, v, m] = await Promise.all([
      apiFetch<Outlet[]>("/outlets?limit=100"),
      apiFetch<Vendor[]>("/vendors"),
      apiFetch<InventoryItem[]>("/inventory?limit=100"),
    ]);
    if (!o.success || !v.success || !m.success) {
      setError(o.message ?? v.message ?? m.message ?? "Failed to load outlets, vendors and materials.");
      return;
    }
    setOutlets(o.data ?? []);
    setVendors(v.data ?? []);
    setMaterials(m.data ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (enabled && !loaded) load();
  }, [enabled, loaded, load]);

  return { outlets, vendors, materials, loaded, error, reload: load };
}

function defaultOutletId(outlets: Outlet[]): string {
  const saved = getPersistedOutletId();
  if (saved && outlets.some((o) => o.id === saved)) return saved;
  return outlets[0]?.id ?? "";
}

/** Validate editable lines; returns parsed lines or a message for the user. */
function parseLines(lines: Line[], quantityLabel: string) {
  const filled = lines.filter((l) => l.inventoryItemId || l.quantity || l.unitPrice);
  if (filled.length === 0) return { error: "Add at least one material." } as const;
  const seen = new Set<string>();
  const parsed: { inventoryItemId: string; quantity: number; unitPrice: number }[] = [];
  for (const [i, line] of filled.entries()) {
    const row = `Line ${i + 1}`;
    if (!line.inventoryItemId) return { error: `${row}: choose a material.` } as const;
    if (seen.has(line.inventoryItemId)) return { error: `${row}: this material is already on another line.` } as const;
    seen.add(line.inventoryItemId);
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0) {
      return { error: `${row}: ${quantityLabel} must be greater than 0.` } as const;
    }
    if (line.unitPrice === "" || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return { error: `${row}: enter a unit price (0 or more).` } as const;
    }
    parsed.push({ inventoryItemId: line.inventoryItemId, quantity, unitPrice });
  }
  return { lines: parsed } as const;
}

function LineEditor({
  lines,
  setLines,
  materials,
  quantityLabel,
  lockedItems,
  disabled,
}: {
  lines: Line[];
  setLines: (lines: Line[]) => void;
  materials: InventoryItem[];
  quantityLabel: string;
  /** When set, only these materials can be chosen (receiving against a PO) */
  lockedItems?: Map<string, { outstanding: number }>;
  disabled?: boolean;
}) {
  const update = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const options = lockedItems ? materials.filter((m) => lockedItems.has(m.id)) : materials;

  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_6rem_2rem] gap-2 text-xs font-medium text-gray-500 px-1">
        <span>Material</span>
        <span>{quantityLabel}</span>
        <span>Unit price (₹)</span>
        <span className="text-right">Line total</span>
        <span />
      </div>
      {lines.map((line) => {
        const material = materials.find((m) => m.id === line.inventoryItemId);
        const total = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
        const outstanding = lockedItems?.get(line.inventoryItemId)?.outstanding;
        return (
          <div key={line.key} className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_7rem_6rem_2rem] gap-2 items-center">
            <select
              aria-label="Material"
              className={selectClass}
              value={line.inventoryItemId}
              disabled={disabled}
              onChange={(e) => {
                const next = materials.find((m) => m.id === e.target.value);
                update(line.key, {
                  inventoryItemId: e.target.value,
                  // Pre-fill the last known cost so most lines need no typing
                  unitPrice: line.unitPrice || (next ? String(Number(next.costPerUnit ?? 0)) : ""),
                });
              }}
            >
              <option value="">Select material…</option>
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
            </select>
            <div>
              <Input
                aria-label={quantityLabel}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder={material ? material.unit : "Qty"}
                value={line.quantity}
                disabled={disabled}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
              />
              {outstanding !== undefined && (
                <p className="mt-0.5 text-[11px] text-gray-500">{outstanding > 0 ? `${outstanding} outstanding` : "Fully received"}</p>
              )}
            </div>
            <Input
              aria-label="Unit price"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0.00"
              value={line.unitPrice}
              disabled={disabled}
              onChange={(e) => update(line.key, { unitPrice: e.target.value })}
            />
            <span className="text-sm text-right tabular-nums text-gray-700">{inr(total)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove line"
              disabled={disabled || lines.length === 1}
              onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
            >
              <Trash2 className="w-4 h-4 text-gray-400" />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setLines([...lines, newLine()])}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Add line
      </Button>
    </div>
  );
}

// ════════════════════════════ Purchase Orders ════════════════════════════

export function PurchaseOrdersTab({ active }: { active: boolean }) {
  const { toast } = useToast();
  const ref = useProcurementReferenceData(active);

  const [rows, setRows] = useState<PoRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PoStatus | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrderDetail | null>(null);
  const [outletId, setOutletId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ po: PoRow; action: "SENT" | "CANCELLED" | "DELETE" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    const res = await apiFetch<PoRow[]>(`/purchase-orders?${params}`);
    if (res.success && res.data) {
      setRows(res.data);
      setTotalPages(res.pagination?.totalPages || 1);
    } else {
      setError(res.message ?? "Failed to load purchase orders.");
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const openCreate = () => {
    setEditing(null);
    setOutletId(defaultOutletId(ref.outlets));
    setVendorId("");
    setExpectedDate("");
    setNotes("");
    setLines([newLine()]);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = async (po: PoRow) => {
    setBusyId(po.id);
    const res = await apiFetch<PurchaseOrderDetail>(`/purchase-orders/${po.id}`);
    setBusyId(null);
    if (!res.success || !res.data) {
      toast({ title: "Could not open purchase order", description: res.message, variant: "error" });
      return;
    }
    const d = res.data;
    setEditing(d);
    setOutletId(d.outletId);
    setVendorId(d.vendorId);
    setExpectedDate(d.expectedDeliveryDate ? new Date(d.expectedDeliveryDate).toISOString().slice(0, 10) : "");
    setNotes(d.notes ?? "");
    setLines(
      d.items.map((i) => ({ key: ++lineKey, inventoryItemId: i.inventoryItemId, quantity: String(i.quantity), unitPrice: String(i.unitPrice) }))
    );
    setFormError(null);
    setFormOpen(true);
  };

  const openDetail = async (po: PoRow) => {
    setDetail(null);
    setDetailLoading(true);
    const res = await apiFetch<PurchaseOrderDetail>(`/purchase-orders/${po.id}`);
    setDetailLoading(false);
    if (res.success && res.data) setDetail(res.data);
    else toast({ title: "Could not open purchase order", description: res.message, variant: "error" });
  };

  const save = async () => {
    if (!outletId) return setFormError("Choose the outlet this order is for.");
    if (!vendorId) return setFormError("Choose a vendor.");
    const parsed = parseLines(lines, "Quantity");
    if ("error" in parsed) return setFormError(parsed.error ?? "Check the lines.");

    setSaving(true);
    setFormError(null);
    const payload = {
      vendorId,
      expectedDeliveryDate: expectedDate || null,
      notes: notes.trim() || null,
      items: parsed.lines,
    };
    const res = editing
      ? await apiFetch<PurchaseOrderDetail>(`/purchase-orders/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) })
      : await apiFetch<PurchaseOrderDetail>("/purchase-orders", { method: "POST", body: JSON.stringify({ outletId, ...payload }) });
    setSaving(false);

    if (!res.success) return setFormError(res.message ?? "Could not save the purchase order.");
    setFormOpen(false);
    toast({ title: editing ? "Purchase order updated" : `Purchase order ${res.data?.poNumber ?? ""} created` });
    if (!editing && page !== 1) setPage(1);
    else load();
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const { po, action } = confirm;
    setBusyId(po.id);
    const res =
      action === "DELETE"
        ? await apiFetch(`/purchase-orders/${po.id}`, { method: "DELETE" })
        : await apiFetch(`/purchase-orders/${po.id}/status`, { method: "PATCH", body: JSON.stringify({ status: action }) });
    setBusyId(null);
    setConfirm(null);
    if (!res.success) {
      toast({ title: "Action failed", description: res.message, variant: "error" });
    } else {
      toast({
        title: action === "DELETE" ? "Purchase order deleted" : action === "SENT" ? `${po.poNumber} marked as sent` : `${po.poNumber} cancelled`,
      });
    }
    load();
  };

  const formTotal = useMemo(
    () => calculatePOTotal(lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 }))),
    [lines]
  );
  const cannotCreate = ref.loaded && (ref.vendors.length === 0 || ref.materials.length === 0 || ref.outlets.length === 0);

  return (
    <Card className="shadow-xs border-gray-100">
      <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-blue-600" />
          <div>
            <CardTitle className="text-lg">Purchase Orders</CardTitle>
            <CardDescription>Order materials from vendors and track what has arrived.</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by status"
            className={`${selectClass} w-auto`}
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value as PoStatus | "");
            }}
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_STYLE) as PoStatus[]).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={openCreate} disabled={!ref.loaded || cannotCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Create PO
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {ref.error && <ErrorBanner message={ref.error} onRetry={ref.reload} />}
        {error && <ErrorBanner message={error} onRetry={load} />}
        {cannotCreate && (
          <p className="m-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {ref.outlets.length === 0
              ? "Create an outlet first."
              : ref.vendors.length === 0
                ? "Add a vendor in the Vendors tab before raising a purchase order."
                : "Add raw materials in the Materials tab before raising a purchase order."}
          </p>
        )}
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : !error && rows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={statusFilter ? "No purchase orders with this status" : "No purchase orders yet"}
            description={statusFilter ? "Try a different status filter." : "Raise a purchase order to restock materials from a vendor."}
            action={!statusFilter && !cannotCreate && ref.loaded ? { label: "Create PO", onClick: openCreate } : undefined}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((po) => (
                  <TableRow key={po.id} className={po.status === "CANCELLED" ? "opacity-60" : undefined}>
                    <TableCell>
                      <button className="font-medium text-blue-700 hover:underline" onClick={() => openDetail(po)}>
                        {po.poNumber}
                      </button>
                      <div className="text-xs text-gray-500">{formatDate(po.createdAt)}</div>
                    </TableCell>
                    <TableCell>{po.vendorName}</TableCell>
                    <TableCell className="text-gray-600">{po.outletName}</TableCell>
                    <TableCell>
                      <StatusPill status={po.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{po.itemCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(po.totalAmount)}</TableCell>
                    <TableCell className="text-gray-600">{formatDate(po.expectedDeliveryDate)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {busyId === po.id ? (
                        <Loader2 className="inline w-4 h-4 animate-spin text-gray-400" />
                      ) : (
                        <div className="inline-flex gap-1">
                          {po.status === "DRAFT" && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => openEdit(po)}>
                                Edit
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setConfirm({ po, action: "SENT" })}>
                                <Send className="w-3.5 h-3.5 mr-1" />
                                Mark sent
                              </Button>
                              <Button variant="ghost" size="sm" aria-label={`Delete ${po.poNumber}`} onClick={() => setConfirm({ po, action: "DELETE" })}>
                                <Trash2 className="w-4 h-4 text-rose-500" />
                              </Button>
                            </>
                          )}
                          {po.status === "SENT" && (
                            <Button variant="ghost" size="sm" onClick={() => setConfirm({ po, action: "CANCELLED" })}>
                              <XCircle className="w-3.5 h-3.5 mr-1 text-rose-500" />
                              Cancel
                            </Button>
                          )}
                          {po.status !== "DRAFT" && po.status !== "SENT" && (
                            <Button variant="outline" size="sm" onClick={() => openDetail(po)}>
                              View
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </CardContent>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={(open) => !saving && setFormOpen(open)}>
        <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.poNumber}` : "Create purchase order"}</DialogTitle>
            <DialogDescription>
              Saved as a draft. Mark it as sent once you have placed the order with the vendor.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="po-outlet">Outlet</Label>
                <select id="po-outlet" className={selectClass} value={outletId} disabled={!!editing || saving} onChange={(e) => setOutletId(e.target.value)}>
                  <option value="">Select outlet…</option>
                  {ref.outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-vendor">Vendor</Label>
                <select id="po-vendor" className={selectClass} value={vendorId} disabled={saving} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">Select vendor…</option>
                  {ref.vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-date">Expected delivery</Label>
                <Input id="po-date" type="date" value={expectedDate} disabled={saving} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
            </div>
            <LineEditor lines={lines} setLines={setLines} materials={ref.materials} quantityLabel="Quantity" disabled={saving} />
            <div className="space-y-1.5">
              <Label htmlFor="po-notes">Notes for the vendor (optional)</Label>
              <Input id="po-notes" value={notes} maxLength={500} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm text-gray-500">Order total</span>
              <span className="text-lg font-semibold tabular-nums">{inr(formTotal)}</span>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-rose-600">
                {formError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? "Save changes" : "Save draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={detailLoading || !!detail} onOpenChange={(open) => !open && (setDetail(null), setDetailLoading(false))}>
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail ? detail.poNumber : "Purchase order"}</DialogTitle>
            <DialogDescription>
              {detail ? `${detail.vendorName} · ${detail.outletName ?? ""} · raised ${formatDate(detail.createdAt)}` : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {!detail ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <StatusPill status={detail.status as PoStatus} />
                <span className="text-gray-500">Expected {formatDate(detail.expectedDeliveryDate)}</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.inventoryItemName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.quantity} {i.unit}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${i.receivedQuantity >= i.quantity ? "text-emerald-700" : i.receivedQuantity > 0 ? "text-amber-700" : "text-gray-400"}`}>
                        {i.receivedQuantity} {i.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{inr(i.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(i.totalPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{inr(detail.totalAmount)}</span>
              </div>
              {detail.notes && <p className="text-sm text-gray-600 whitespace-pre-wrap">Notes: {detail.notes}</p>}
              {(detail.status === "SENT" || detail.status === "PARTIAL") && (
                <p className="text-xs text-gray-500">Record deliveries in the GRNs tab — stock and this order's status update automatically.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm */}
      <Dialog open={!!confirm} onOpenChange={(open) => !open && busyId === null && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {confirm?.action === "DELETE" ? "Delete this draft?" : confirm?.action === "SENT" ? "Mark as sent to vendor?" : "Cancel this purchase order?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.action === "DELETE"
                ? `${confirm.po.poNumber} will be removed permanently.`
                : confirm?.action === "SENT"
                  ? `${confirm.po.poNumber} can no longer be edited once sent. You can then receive goods against it.`
                  : `${confirm?.po.poNumber} will be closed and no goods can be received against it.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busyId !== null}>
              Keep it
            </Button>
            <Button
              className={confirm?.action === "SENT" ? "bg-blue-600 hover:bg-blue-700" : "bg-rose-600 hover:bg-rose-700"}
              onClick={runConfirmed}
              disabled={busyId !== null}
            >
              {busyId !== null && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {confirm?.action === "DELETE" ? "Delete draft" : confirm?.action === "SENT" ? "Mark sent" : "Cancel PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ════════════════════════════ Goods Received Notes ════════════════════════════

export function GrnTab({ active, onStockChanged }: { active: boolean; onStockChanged?: () => void }) {
  const { toast } = useToast();
  const ref = useProcurementReferenceData(active);

  const [rows, setRows] = useState<GrnRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [outletId, setOutletId] = useState("");
  const [poId, setPoId] = useState("");
  const [openPos, setOpenPos] = useState<PoRow[]>([]);
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [poLoading, setPoLoading] = useState(false);
  const [receivedDate, setReceivedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<GrnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<GrnRow[]>(`/grns?page=${page}&limit=${PAGE_SIZE}`);
    if (res.success && res.data) {
      setRows(res.data);
      setTotalPages(res.pagination?.totalPages || 1);
    } else {
      setError(res.message ?? "Failed to load goods received notes.");
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  /** Purchase orders that can still receive goods at an outlet. */
  const loadOpenPos = async (forOutletId: string) => {
    setOpenPos([]);
    if (!forOutletId) return;
    const [sent, partial] = await Promise.all([
      apiFetch<PoRow[]>(`/purchase-orders?outletId=${forOutletId}&status=SENT&limit=100`),
      apiFetch<PoRow[]>(`/purchase-orders?outletId=${forOutletId}&status=PARTIAL&limit=100`),
    ]);
    setOpenPos([...(partial.data ?? []), ...(sent.data ?? [])]);
  };

  const openCreate = () => {
    const outlet = defaultOutletId(ref.outlets);
    setOutletId(outlet);
    setPoId("");
    setPo(null);
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setLines([newLine()]);
    setFormError(null);
    setFormOpen(true);
    loadOpenPos(outlet);
  };

  const choosePo = async (id: string) => {
    setPoId(id);
    setPo(null);
    setFormError(null);
    if (!id) {
      setLines([newLine()]);
      return;
    }
    setPoLoading(true);
    const res = await apiFetch<PurchaseOrderDetail>(`/purchase-orders/${id}`);
    setPoLoading(false);
    if (!res.success || !res.data) {
      setPoId("");
      setFormError(res.message ?? "Could not load that purchase order.");
      return;
    }
    setPo(res.data);
    // Pre-fill with what is still outstanding — usually exactly what arrived
    const outstanding = res.data.items
      .map((i) => ({ item: i, remaining: Math.max(0, Math.round((i.quantity - i.receivedQuantity) * 1000) / 1000) }))
      .filter((x) => x.remaining > 0);
    setLines(
      outstanding.length > 0
        ? outstanding.map(({ item, remaining }) => ({
            key: ++lineKey,
            inventoryItemId: item.inventoryItemId,
            quantity: String(remaining),
            unitPrice: String(item.unitPrice),
          }))
        : [newLine()]
    );
  };

  const lockedItems = useMemo(
    () =>
      po
        ? new Map(po.items.map((i) => [i.inventoryItemId, { outstanding: Math.max(0, Math.round((i.quantity - i.receivedQuantity) * 1000) / 1000) }]))
        : undefined,
    [po]
  );

  const save = async () => {
    if (!outletId) return setFormError("Choose the outlet that received the goods.");
    const parsed = parseLines(lines, "Received quantity");
    if ("error" in parsed) return setFormError(parsed.error ?? "Check the lines.");

    setSaving(true);
    setFormError(null);
    const res = await apiFetch<{ grnNumber: string }>("/grns", {
      method: "POST",
      body: JSON.stringify({
        outletId,
        purchaseOrderId: poId || null,
        receivedDate: receivedDate || undefined,
        notes: notes.trim() || null,
        items: parsed.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, receivedQuantity: l.quantity, unitPrice: l.unitPrice })),
      }),
    });
    setSaving(false);

    if (!res.success) return setFormError(res.message ?? "Could not record the goods received.");
    setFormOpen(false);
    toast({ title: `${res.data?.grnNumber ?? "GRN"} recorded`, description: "Stock levels have been updated." });
    onStockChanged?.();
    if (page !== 1) setPage(1);
    else load();
  };

  const openDetail = async (grn: GrnRow) => {
    setDetail(null);
    setDetailLoading(true);
    const res = await apiFetch<GrnDetail>(`/grns/${grn.id}`);
    setDetailLoading(false);
    if (res.success && res.data) setDetail(res.data);
    else toast({ title: "Could not open goods received note", description: res.message, variant: "error" });
  };

  const formTotal = useMemo(
    () => calculatePOTotal(lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 }))),
    [lines]
  );
  const cannotCreate = ref.loaded && (ref.materials.length === 0 || ref.outlets.length === 0);

  return (
    <Card className="shadow-xs border-gray-100">
      <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-blue-600" />
          <div>
            <CardTitle className="text-lg">Goods Received Notes</CardTitle>
            <CardDescription>Record deliveries. Stock is added the moment a GRN is saved.</CardDescription>
          </div>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={openCreate} disabled={!ref.loaded || cannotCreate}>
          <Plus className="w-4 h-4 mr-2" />
          New GRN
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {ref.error && <ErrorBanner message={ref.error} onRetry={ref.reload} />}
        {error && <ErrorBanner message={error} onRetry={load} />}
        {cannotCreate && (
          <p className="m-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {ref.outlets.length === 0 ? "Create an outlet first." : "Add raw materials in the Materials tab before recording a delivery."}
          </p>
        )}
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : !error && rows.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title="No deliveries recorded yet"
            description="Record a goods received note when materials arrive — against a purchase order or as a direct purchase."
            action={!cannotCreate && ref.loaded ? { label: "New GRN", onClick: openCreate } : undefined}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN #</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Purchase order</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((grn) => (
                  <TableRow key={grn.id}>
                    <TableCell>
                      <button className="font-medium text-blue-700 hover:underline" onClick={() => openDetail(grn)}>
                        {grn.grnNumber}
                      </button>
                    </TableCell>
                    <TableCell className="text-gray-600">{formatDate(grn.receivedDate)}</TableCell>
                    <TableCell>{grn.poNumber ?? <span className="text-gray-400">Direct purchase</span>}</TableCell>
                    <TableCell className="text-gray-600">{grn.vendorName ?? "—"}</TableCell>
                    <TableCell className="text-gray-600">{grn.outletName}</TableCell>
                    <TableCell className="text-right tabular-nums">{grn.itemCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(grn.totalValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </CardContent>

      {/* New GRN */}
      <Dialog open={formOpen} onOpenChange={(open) => !saving && setFormOpen(open)}>
        <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record goods received</DialogTitle>
            <DialogDescription>
              Saving adds these quantities to stock straight away and cannot be undone here — check the counts against the delivery.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="grn-outlet">Outlet</Label>
                <select
                  id="grn-outlet"
                  className={selectClass}
                  value={outletId}
                  disabled={saving}
                  onChange={(e) => {
                    setOutletId(e.target.value);
                    choosePo("");
                    loadOpenPos(e.target.value);
                  }}
                >
                  <option value="">Select outlet…</option>
                  {ref.outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grn-po">Against purchase order</Label>
                <select id="grn-po" className={selectClass} value={poId} disabled={saving || poLoading} onChange={(e) => choosePo(e.target.value)}>
                  <option value="">Direct purchase (no PO)</option>
                  {openPos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.poNumber} — {p.vendorName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grn-date">Received on</Label>
                <Input
                  id="grn-date"
                  type="date"
                  value={receivedDate}
                  max={new Date().toISOString().slice(0, 10)}
                  disabled={saving}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </div>
            </div>
            {poLoading ? (
              <div className="flex justify-center p-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : (
              <LineEditor
                lines={lines}
                setLines={setLines}
                materials={ref.materials}
                quantityLabel="Received"
                lockedItems={lockedItems}
                disabled={saving}
              />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="grn-notes">Notes (optional) — invoice number, shortages, damage</Label>
              <Input id="grn-notes" value={notes} maxLength={500} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm text-gray-500">Delivery value</span>
              <span className="text-lg font-semibold tabular-nums">{inr(formTotal)}</span>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-rose-600">
                {formError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={save} disabled={saving || poLoading}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Receive &amp; add to stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={detailLoading || !!detail} onOpenChange={(open) => !open && (setDetail(null), setDetailLoading(false))}>
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail ? detail.grnNumber : "Goods received note"}</DialogTitle>
            <DialogDescription>
              {detail
                ? `Received ${formatDate(detail.receivedDate)}${detail.poNumber ? ` against ${detail.poNumber}` : " · direct purchase"}${detail.vendorName ? ` · ${detail.vendorName}` : ""}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {!detail ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.inventoryItemName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.receivedQuantity} {i.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{inr(i.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(i.totalPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-between text-sm font-semibold">
                <span>Delivery value</span>
                <span className="tabular-nums">{inr(detail.totalValue)}</span>
              </div>
              {detail.notes && <p className="text-sm text-gray-600 whitespace-pre-wrap">Notes: {detail.notes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
