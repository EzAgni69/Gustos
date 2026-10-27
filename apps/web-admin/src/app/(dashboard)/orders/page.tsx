"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Clock,
  IndianRupee,
  Hash,
  MoreHorizontal,
  Edit,
  Trash2,
  Loader2,
  Search,
  Calendar,
  Download,
  FileText,
  Printer,
  Filter,
  X,
  Receipt,
  Eye,
} from "lucide-react";
import type { Order, OrderStatus, Outlet } from "@gusto/api-contracts";
import { apiFetch, getApiBaseUrl } from "@/lib/api-client";
import { useRealtimeEvent } from "@/lib/socket-context";

// ─── Status Config ───

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; variant: "muted" | "info" | "purple" | "warning" | "success" | "destructive" }
> = {
  DRAFT: { label: "Draft", variant: "muted" },
  PLACED: { label: "Placed", variant: "info" },
  IN_PROGRESS: { label: "In Progress", variant: "purple" },
  READY: { label: "Ready", variant: "warning" },
  SERVED: { label: "Served", variant: "success" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
};

const ALL_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
];

const PAYMENT_MODES = ["CASH", "CARD", "UPI", "ONLINE", "SPLIT", "OTHER"] as const;
const ORDER_MODES = ["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"] as const;

const updateOrderSchema = z.object({
  status: z.enum(["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED", "COMPLETED", "CANCELLED"]),
  notes: z.string().optional(),
});
type UpdateOrderForm = z.infer<typeof updateOrderSchema>;

// ─── Invoice Detail Types ───

type InvoiceData = {
  id: string;
  invoiceNumber: string;
  receiptStatus: string;
  subtotal: number;
  discountAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalQuantity: number;
  totalAmount: number;
  paymentMode: string;
  paymentSubMethod?: string;
  isPaid: boolean;
  createdAt: string;
};

type InvoiceDetailResponse = {
  order: Order;
  invoice: InvoiceData | null;
  outlet: {
    id: string;
    name: string;
    address: string;
    phone?: string;
    gstNumber?: string;
    fssaiLicenseNo?: string;
  };
  organization: {
    id: string;
    name: string;
    gstNumber?: string;
  } | null;
};

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filter State
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterPaymentMode, setFilterPaymentMode] = useState("");
  const [filterOrderMode, setFilterOrderMode] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  // Invoice Modal State
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceData, setInvoiceData] = useState<InvoiceDetailResponse | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState<string | null>(null);

  const form = useForm<UpdateOrderForm>({
    // @ts-ignore: Zod type mismatch across package boundaries
    resolver: zodResolver(updateOrderSchema),
    defaultValues: {
      status: "PLACED",
      notes: "",
    }
  });

  // ─── Build Query String ───
  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (currentOutletId && currentOutletId !== "all") params.set("outletId", currentOutletId);
    params.set("page", String(page));
    params.set("limit", "25");
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (filterPaymentMode) params.set("paymentMode", filterPaymentMode);
    if (filterOrderMode) params.set("orderMode", filterOrderMode);
    if (filterStatus) params.set("status", filterStatus);
    return params.toString();
  }, [currentOutletId, page, searchQuery, startDate, endDate, filterPaymentMode, filterOrderMode, filterStatus]);

  // ─── Load Data ───
  const loadOrders = async (outletId: string) => {
    setLoading(true);

    const params = new URLSearchParams();
    if (outletId && outletId !== "all") params.set("outletId", outletId);
    params.set("page", String(page));
    params.set("limit", "25");
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (filterPaymentMode) params.set("paymentMode", filterPaymentMode);
    if (filterOrderMode) params.set("orderMode", filterOrderMode);
    if (filterStatus) params.set("status", filterStatus);

    // Use enhanced history endpoint when any filter is active
    const hasFilters = startDate || endDate || filterPaymentMode || filterOrderMode || searchQuery.trim();
    const endpoint = hasFilters
      ? `/orders/history?${params.toString()}`
      : `/orders?${params.toString()}`;

    const ordersRes = await apiFetch<Order[]>(endpoint);
    if (ordersRes.success && ordersRes.data) {
      setOrders(ordersRes.data);
      if (ordersRes.pagination) {
        setTotalPages(ordersRes.pagination.totalPages);
        setTotalCount(ordersRes.pagination.total);
      }
    }

    setLoading(false);
  };

  const loadData = async () => {
    setLoading(true);
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      const initialOutletId = currentOutletId || "all";
      setCurrentOutletId(initialOutletId);
      await loadOrders(initialOutletId);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (currentOutletId) {
      loadOrders(currentOutletId);
    }
  }, [page, currentOutletId]);

  useRealtimeEvent(
    [
      "ORDER_COMPLETED",
      "ORDER_CREATED",
      "ORDER_CANCELLED",
      "ORDERS_MERGED",
      "ORDER_MODE_CHANGED",
      "ORDER_COMPLIMENTARY",
      "ITEM_VOIDED",
    ],
    () => {
      if (currentOutletId) {
        loadOrders(currentOutletId);
      }
    }
  );

  // ─── Filter Handlers ───
  const applyFilters = () => {
    setPage(1);
    loadOrders(currentOutletId);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStartDate("");
    setEndDate("");
    setFilterPaymentMode("");
    setFilterOrderMode("");
    setFilterStatus("");
    setPage(1);
    // Reload with cleared filters after state update
    setTimeout(() => loadOrders(currentOutletId), 0);
  };

  const hasActiveFilters = searchQuery || startDate || endDate || filterPaymentMode || filterOrderMode || filterStatus;

  // ─── Order Filtering by Tab ───
  const filteredOrders =
    activeTab === "ALL"
      ? orders
      : orders.filter((o) => o.status === activeTab);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".action-menu")) return;
    setExpandedOrderId((prev) => (prev === id ? null : id));
  };

  const timeAgo = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const statusCounts: Record<string, number> = { ALL: orders.length };
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  }

  // ─── Edit Modal ───
  const openEditModal = (order: Order) => {
    setEditingOrder(order);
    form.reset({
      status: order.status,
      notes: order.notes || "",
    });
    setIsModalOpen(true);
  };

  const handleUpdateOrder = async (data: UpdateOrderForm) => {
    if (!editingOrder) return;
    setIsSubmitting(true);
    const res = await apiFetch<Order>(`/orders/${editingOrder.id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (res.success && res.data) {
      setOrders(orders.map(o => o.id === editingOrder.id ? res.data! : o));
      setIsModalOpen(false);
      toast({ title: "Order updated", description: `Order ${editingOrder.orderNumber} updated successfully.`, variant: "success" });
    } else {
      toast({ title: "Update failed", description: res.message || "Failed to update order", variant: "error" });
    }
    setIsSubmitting(false);
  };

  const handleDeleteOrder = async (id: string) => {
    if (!confirm("Are you sure you want to delete this order?")) return;
    const res = await apiFetch(`/orders/${id}`, { method: "DELETE" });
    if (res.success) {
      setOrders(orders.filter(o => o.id !== id));
      toast({ title: "Order deleted", variant: "success" });
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete order", variant: "error" });
    }
  };

  // ─── Invoice Modal ───
  const openInvoiceModal = async (orderId: string) => {
    setInvoiceLoading(true);
    setInvoiceModalOpen(true);
    const res = await apiFetch<InvoiceDetailResponse>(`/orders/${orderId}/invoice`);
    if (res.success && res.data) {
      setInvoiceData(res.data);
    } else {
      toast({ title: "Failed to load invoice", description: res.message, variant: "error" });
      setInvoiceModalOpen(false);
    }
    setInvoiceLoading(false);
  };

  // ─── PDF Download ───
  const downloadPdf = async (orderId: string, orderNumber: string) => {
    setPdfDownloading(orderId);
    try {
      const token = document.cookie.match(/(?:^|; )gusto_token=([^;]*)/)?.[1];
      const apiUrl = getApiBaseUrl();

      const res = await fetch(`${apiUrl}/orders/${orderId}/invoice/pdf`, {
        headers: token ? { Authorization: `Bearer ${decodeURIComponent(token)}` } : {},
      });

      if (!res.ok) throw new Error("Failed to generate PDF");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice_${orderNumber}_${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "PDF Downloaded", description: `Invoice for ${orderNumber} downloaded.`, variant: "success" });
    } catch (err) {
      toast({ title: "Download failed", description: "Could not generate PDF. Try again.", variant: "error" });
    }
    setPdfDownloading(null);
  };

  // ─── CSV Export ───
  const exportOrdersCsv = async () => {
    try {
      const token = document.cookie.match(/(?:^|; )gusto_token=([^;]*)/)?.[1];
      const apiUrl = getApiBaseUrl();

      const params = new URLSearchParams();
      if (currentOutletId && currentOutletId !== "all") params.set("outletId", currentOutletId);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (filterStatus) params.set("status", filterStatus);

      const res = await fetch(`${apiUrl}/orders/export/csv?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${decodeURIComponent(token)}` } : {},
      });

      if (!res.ok) throw new Error("Failed to export");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Orders_${startDate || "all"}_to_${endDate || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "CSV Exported", variant: "success" });
    } catch {
      toast({ title: "Export failed", variant: "error" });
    }
  };

  // ─── Print Invoice (browser print) ───
  const printInvoice = () => {
    window.print();
  };

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-gray-500 font-medium">Loading orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Orders
          </h1>
          <p className="text-gray-500">
            Monitor and manage orders across your outlets in real time.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Outlet Selector */}
          {outlets.length > 1 && (
            <select
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={currentOutletId}
              onChange={(e) => {
                setCurrentOutletId(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium text-emerald-700">
              {orders.filter(
                (o) =>
                  o.status === "PLACED" || o.status === "IN_PROGRESS"
              ).length}{" "}
              Active
            </span>
          </div>

          {/* Export Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold border border-gray-200 bg-white shadow-xs hover:bg-gray-100 h-9 px-3 py-2 cursor-pointer transition-colors">
              <Download className="w-4 h-4 text-blue-600" />
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={exportOrdersCsv} className="cursor-pointer font-medium">
                <FileText className="w-4 h-4 mr-2 text-emerald-600" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ─── Search & Filter Bar ─── */}
      <Card className="shadow-xs border-gray-100">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-3">
            {/* Search Row */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by order number, customer name, or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="pl-9 h-9"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={showFilters ? "bg-blue-50 border-blue-200 text-blue-700" : ""}
              >
                <Filter className="w-4 h-4 mr-1.5" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-1.5 w-2 h-2 rounded-full bg-blue-600" />
                )}
              </Button>
              <Button size="sm" onClick={applyFilters} className="bg-blue-600 hover:bg-blue-700">
                <Search className="w-4 h-4 mr-1.5" />
                Search
              </Button>
            </div>

            {/* Filter Row (collapsible) */}
            {showFilters && (
              <div className="flex items-end gap-3 flex-wrap pt-2 border-t border-gray-100">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-medium">From Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 w-[150px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-medium">To Date</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-9 w-[150px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-medium">Payment Mode</Label>
                  <select
                    className="flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm"
                    value={filterPaymentMode}
                    onChange={(e) => setFilterPaymentMode(e.target.value)}
                  >
                    <option value="">All Modes</option>
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-medium">Order Type</Label>
                  <select
                    className="flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm"
                    value={filterOrderMode}
                    onChange={(e) => setFilterOrderMode(e.target.value)}
                  >
                    <option value="">All Types</option>
                    {ORDER_MODES.map((m) => (
                      <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-medium">Status</Label>
                  <select
                    className="flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="">All Status</option>
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                    ))}
                  </select>
                </div>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="text-gray-500 hover:text-red-600">
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Hash className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalCount || orders.length}</p>
                <p className="text-xs text-gray-500 font-medium">Total Orders</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50">
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {orders.filter((o) => o.status === "IN_PROGRESS").length}
                </p>
                <p className="text-xs text-gray-500 font-medium">In Kitchen</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <IndianRupee className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  ₹{orders
                    .filter((o) => o.status === "COMPLETED")
                    .reduce((acc, o) => acc + o.totalAmount, 0)
                    .toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-gray-500 font-medium">Revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-50">
                <ClipboardList className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {orders.filter((o) => o.status === "CANCELLED").length}
                </p>
                <p className="text-xs text-gray-500 font-medium">Cancelled</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={form.handleSubmit(handleUpdateOrder)}>
            <DialogHeader>
              <DialogTitle>Edit Order {editingOrder?.orderNumber}</DialogTitle>
              <DialogDescription>Update the order status or notes.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register("status")}
                >
                  {ALL_STATUSES.map(s => (
                    <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
                {form.formState.errors.status && (
                  <p className="text-red-500 text-xs font-medium">{form.formState.errors.status.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  placeholder="Order notes..."
                  {...form.register("notes")}
                />
                {form.formState.errors.notes && (
                  <p className="text-red-500 text-xs font-medium">{form.formState.errors.notes.message}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Invoice Preview Modal ─── */}
      <Dialog open={invoiceModalOpen} onOpenChange={setInvoiceModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto print:max-w-none print:shadow-none">
          {invoiceLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : invoiceData ? (
            <div id="invoice-preview">
              <DialogHeader className="print:hidden">
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-blue-600" />
                  Invoice Preview
                </DialogTitle>
                <DialogDescription>
                  {invoiceData.invoice?.invoiceNumber || invoiceData.order.orderNumber}
                </DialogDescription>
              </DialogHeader>

              {/* Invoice Content */}
              <div className="mt-4 border border-gray-200 rounded-xl p-6 bg-white">
                {/* Header */}
                <div className="text-center mb-4">
                  <h2 className="text-lg font-bold text-gray-900">
                    {invoiceData.organization?.name || "Gustos"}
                  </h2>
                  <p className="text-sm font-medium text-gray-600">{invoiceData.outlet.name}</p>
                  <p className="text-xs text-gray-500">{invoiceData.outlet.address}</p>
                  {invoiceData.outlet.phone && (
                    <p className="text-xs text-gray-500">Phone: {invoiceData.outlet.phone}</p>
                  )}
                  {(invoiceData.outlet.gstNumber || invoiceData.organization?.gstNumber) && (
                    <p className="text-xs text-gray-500 font-medium">
                      GSTIN: {invoiceData.outlet.gstNumber || invoiceData.organization?.gstNumber}
                    </p>
                  )}
                  {invoiceData.outlet.fssaiLicenseNo && (
                    <p className="text-xs text-gray-500">FSSAI: {invoiceData.outlet.fssaiLicenseNo}</p>
                  )}
                </div>

                <hr className="border-gray-200 mb-3" />

                {/* Order Meta */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div>
                    <span className="text-gray-500">Invoice: </span>
                    <span className="font-semibold text-gray-900">
                      {invoiceData.invoice?.invoiceNumber || invoiceData.order.orderNumber}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500">Date: </span>
                    <span className="font-semibold text-gray-900">
                      {formatDate(invoiceData.order.createdAt)} {formatTime(invoiceData.order.createdAt)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Order: </span>
                    <span className="font-semibold">{invoiceData.order.orderNumber}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500">Type: </span>
                    <span className="font-semibold">
                      {(invoiceData.order as any).orderType?.replace(/_/g, " ") || (invoiceData.order as any).orderMode?.replace(/_/g, " ") || "DINE IN"}
                    </span>
                  </div>
                  {invoiceData.order.customerName && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Customer: </span>
                      <span className="font-semibold">
                        {invoiceData.order.customerName}
                        {(invoiceData.order as any).customerPhone ? ` · ${(invoiceData.order as any).customerPhone}` : ""}
                      </span>
                    </div>
                  )}
                </div>

                <hr className="border-gray-200 mb-3" />

                {/* Items Table */}
                <table className="w-full text-xs mb-3">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1.5 font-semibold text-gray-600">#</th>
                      <th className="text-left py-1.5 font-semibold text-gray-600">Item</th>
                      <th className="text-center py-1.5 font-semibold text-gray-600">Qty</th>
                      <th className="text-right py-1.5 font-semibold text-gray-600">Rate</th>
                      <th className="text-right py-1.5 font-semibold text-gray-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceData.order.items.map((item, idx) => (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="py-1.5 text-gray-500">{idx + 1}</td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{item.menuItemName}</span>
                          {(item.modifiers as string[]).length > 0 && (
                            <span className="block text-[10px] text-gray-500 italic">
                              {(item.modifiers as string[]).join(", ")}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-center text-gray-700">{item.quantity}</td>
                        <td className="py-1.5 text-right text-gray-700 tabular-nums">
                          ₹{item.unitPrice.toFixed(2)}
                        </td>
                        <td className="py-1.5 text-right font-medium text-gray-900 tabular-nums">
                          ₹{(item.unitPrice * item.quantity).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="text-gray-900 tabular-nums">₹{invoiceData.order.subtotal.toFixed(2)}</span>
                  </div>
                  {invoiceData.order.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Discount</span>
                      <span className="tabular-nums">-₹{invoiceData.order.discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {invoiceData.invoice ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-500">CGST @ {invoiceData.invoice.cgstRate}%</span>
                        <span className="text-gray-900 tabular-nums">₹{invoiceData.invoice.cgstAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">SGST @ {invoiceData.invoice.sgstRate}%</span>
                        <span className="text-gray-900 tabular-nums">₹{invoiceData.invoice.sgstAmount.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Tax (GST)</span>
                      <span className="text-gray-900 tabular-nums">₹{invoiceData.order.taxAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <hr className="border-gray-200" />
                  <div className="flex justify-between text-sm font-bold pt-1">
                    <span className="text-gray-900">GRAND TOTAL</span>
                    <span className="text-gray-900 tabular-nums">
                      ₹{(invoiceData.invoice?.totalAmount ?? invoiceData.order.totalAmount).toFixed(2)}
                    </span>
                  </div>
                </div>

                <hr className="border-gray-200 mt-3 mb-2" />

                {/* Payment Info */}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">
                    Payment: {invoiceData.invoice?.paymentMode || invoiceData.order.paymentMode || "—"}
                    {invoiceData.invoice?.paymentSubMethod ? ` (${invoiceData.invoice.paymentSubMethod})` : ""}
                  </span>
                  <span className={`font-bold ${invoiceData.invoice?.isPaid ? "text-emerald-600" : "text-red-600"}`}>
                    {invoiceData.invoice?.isPaid ? "✓ PAID" : invoiceData.order.status === "COMPLETED" ? "✓ PAID" : "UNPAID"}
                  </span>
                </div>

                {/* Footer */}
                <div className="text-center mt-4">
                  <p className="text-xs font-medium text-gray-500">Thank you for dining with us!</p>
                  <p className="text-[10px] text-gray-400 mt-1">Generated by Gustos ERP</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 mt-4 print:hidden">
                <Button variant="outline" size="sm" onClick={printInvoice}>
                  <Printer className="w-4 h-4 mr-1.5" />
                  Print
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => downloadPdf(invoiceData!.order.id, invoiceData!.order.orderNumber)}
                  disabled={pdfDownloading === invoiceData?.order.id}
                >
                  {pdfDownloading === invoiceData?.order.id ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-1.5" />
                  )}
                  Download PDF
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Status Filter Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="ALL">
            All ({statusCounts["ALL"]})
          </TabsTrigger>
          {ALL_STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {STATUS_CONFIG[s].label} ({statusCounts[s] || 0})
            </TabsTrigger>
          ))}
        </TabsList>

        {["ALL", ...ALL_STATUSES].map((tabValue) => (
          <TabsContent key={tabValue} value={tabValue}>
            <Card className="shadow-xs border-gray-100">
              <CardHeader className="bg-gray-50/50 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-blue-600" />
                    <div>
                      <CardTitle className="text-lg">
                        {tabValue === "ALL"
                          ? "All Orders"
                          : `${STATUS_CONFIG[tabValue as OrderStatus].label} Orders`}
                      </CardTitle>
                      <CardDescription>
                        {filteredOrders.length} order{filteredOrders.length !== 1 ? "s" : ""} found
                        {hasActiveFilters && " (filtered)"}
                      </CardDescription>
                    </div>
                  </div>
                  {loading && (
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!loading && filteredOrders.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">
                    <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No orders found</p>
                    {hasActiveFilters && (
                      <p className="text-sm mt-1">Try adjusting your filters or date range.</p>
                    )}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableHead className="w-[40px]" />
                        <TableHead className="w-[120px]">Order #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order) => (
                        <Fragment key={order.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                            onClick={(e) => toggleExpand(order.id, e)}
                          >
                            <TableCell className="pl-4">
                              {expandedOrderId === order.id ? (
                                <ChevronUp className="w-4 h-4 text-gray-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-gray-400" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono font-semibold text-gray-900">
                              {order.orderNumber}
                            </TableCell>
                            <TableCell className="text-gray-600 text-sm">
                              {formatDate(order.createdAt)}
                            </TableCell>
                            <TableCell className="text-gray-600">
                              {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                            </TableCell>
                            <TableCell className="font-semibold text-gray-900">
                              ₹{order.totalAmount.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell>
                              <Badge variant={STATUS_CONFIG[order.status].variant}>
                                {STATUS_CONFIG[order.status].label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-gray-600">
                              {order.paymentMode || "—"}
                            </TableCell>
                            <TableCell className="text-right text-gray-500 text-sm">
                              {timeAgo(order.createdAt)}
                            </TableCell>
                            <TableCell className="action-menu" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger>
                                  <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openInvoiceModal(order.id)} className="cursor-pointer">
                                    <Eye className="w-4 h-4 mr-2 text-blue-600" />
                                    View Invoice
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => downloadPdf(order.id, order.orderNumber)}
                                    className="cursor-pointer"
                                    disabled={pdfDownloading === order.id}
                                  >
                                    {pdfDownloading === order.id ? (
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                      <Download className="w-4 h-4 mr-2 text-emerald-600" />
                                    )}
                                    Download PDF
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openEditModal(order)} className="cursor-pointer">
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit Status
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-red-600 cursor-pointer" onClick={() => handleDeleteOrder(order.id)}>
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>

                          {/* Expanded Row */}
                          {expandedOrderId === order.id && (
                            <TableRow className="bg-blue-50/20 hover:bg-blue-50/20">
                              <TableCell colSpan={9} className="p-0">
                                <div className="px-6 py-4 border-t border-blue-100/50">
                                  <div className="grid md:grid-cols-3 gap-6">
                                    {/* Items List */}
                                    <div className="md:col-span-2">
                                      <h4 className="text-sm font-semibold text-gray-700 mb-3">
                                        Order Items
                                      </h4>
                                      <div className="space-y-2">
                                        {order.items.map((item) => (
                                          <div
                                            key={item.id}
                                            className="flex items-center justify-between py-2 px-3 bg-white rounded-lg border border-gray-100"
                                          >
                                            <div className="flex-1">
                                              <p className="text-sm font-medium text-gray-900">
                                                {item.menuItemName}
                                              </p>
                                              <div className="flex items-center gap-2 mt-0.5">
                                                {(item.modifiers as string[]).length > 0 && (
                                                  <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                                    {(item.modifiers as string[]).join(", ")}
                                                  </span>
                                                )}
                                                {item.notes && (
                                                  <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                                    📝 {item.notes}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                              <span className="text-sm text-gray-500">
                                                ×{item.quantity}
                                              </span>
                                              <span className="text-sm font-medium text-gray-900 tabular-nums w-20 text-right">
                                                ₹{(
                                                  item.unitPrice * item.quantity
                                                ).toLocaleString("en-IN", {
                                                  minimumFractionDigits: 2,
                                                })}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                        {order.items.length === 0 && (
                                          <div className="text-sm text-gray-500 italic py-2">No items in this order.</div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Summary + Actions */}
                                    <div>
                                      <h4 className="text-sm font-semibold text-gray-700 mb-3">
                                        Bill Summary
                                      </h4>
                                      <div className="bg-white rounded-lg border border-gray-100 p-4 space-y-2">
                                        <div className="flex justify-between text-sm">
                                          <span className="text-gray-500">
                                            Subtotal
                                          </span>
                                          <span className="text-gray-900 tabular-nums">
                                            ₹{order.subtotal.toLocaleString(
                                              "en-IN",
                                              {
                                                minimumFractionDigits: 2,
                                              }
                                            )}
                                          </span>
                                        </div>
                                        {order.discountAmount > 0 && (
                                          <div className="flex justify-between text-sm">
                                            <span className="text-emerald-600">
                                              Discount
                                            </span>
                                            <span className="text-emerald-600 tabular-nums">
                                              -₹{order.discountAmount.toLocaleString(
                                                "en-IN",
                                                {
                                                  minimumFractionDigits: 2,
                                                }
                                              )}
                                            </span>
                                          </div>
                                        )}
                                        <div className="flex justify-between text-sm">
                                          <span className="text-gray-500">
                                            Tax (GST)
                                          </span>
                                          <span className="text-gray-900 tabular-nums">
                                            ₹{order.taxAmount.toLocaleString(
                                              "en-IN",
                                              {
                                                minimumFractionDigits: 2,
                                              }
                                            )}
                                          </span>
                                        </div>
                                        <div className="border-t border-gray-100 pt-2 mt-2 flex justify-between text-sm font-bold">
                                          <span className="text-gray-900">
                                            Total
                                          </span>
                                          <span className="text-gray-900 tabular-nums">
                                            ₹{order.totalAmount.toLocaleString(
                                              "en-IN",
                                              {
                                                minimumFractionDigits: 2,
                                              }
                                            )}
                                          </span>
                                        </div>
                                      </div>

                                      {order.notes && (
                                        <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                          <p className="text-xs font-medium text-amber-700 mb-0.5">
                                            Order Note
                                          </p>
                                          <p className="text-sm text-amber-800">
                                            {order.notes}
                                          </p>
                                        </div>
                                      )}

                                      {/* Quick Actions */}
                                      <div className="mt-3 flex flex-col gap-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full justify-start text-blue-700 hover:bg-blue-50"
                                          onClick={() => openInvoiceModal(order.id)}
                                        >
                                          <Eye className="w-4 h-4 mr-2" />
                                          View Invoice
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full justify-start text-emerald-700 hover:bg-emerald-50"
                                          onClick={() => downloadPdf(order.id, order.orderNumber)}
                                          disabled={pdfDownloading === order.id}
                                        >
                                          {pdfDownloading === order.id ? (
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          ) : (
                                            <Download className="w-4 h-4 mr-2" />
                                          )}
                                          Download PDF Bill
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
