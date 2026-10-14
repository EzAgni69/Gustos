"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
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
  Loader2
} from "lucide-react";
import type { Order, OrderStatus, Outlet } from "@gusto/api-contracts";
import { apiFetch } from "@/lib/api-client";

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

const updateOrderSchema = z.object({
  status: z.enum(["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED", "COMPLETED", "CANCELLED"]),
  notes: z.string().optional(),
});
type UpdateOrderForm = z.infer<typeof updateOrderSchema>;

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const form = useForm<UpdateOrderForm>({
    // @ts-ignore: Zod type mismatch across package boundaries
    resolver: zodResolver(updateOrderSchema),
    defaultValues: {
      status: "PLACED",
      notes: "",
    }
  });

  const loadData = async () => {
    setLoading(true);

    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    let initialOutletId = "";

    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      if (outletsRes.data[0]) {
        initialOutletId = outletsRes.data[0].id;
        setCurrentOutletId(initialOutletId);
      }

      const ordersRes = await apiFetch<Order[]>(`/orders?outletId=${initialOutletId}&page=${page}&limit=20`);
      if (ordersRes.success && ordersRes.data) {
        setOrders(ordersRes.data);
        if ((ordersRes as any).pagination) {
          setTotalPages((ordersRes as any).pagination.totalPages);
        }
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [page]);

  const filteredOrders =
    activeTab === "ALL"
      ? orders
      : orders.filter((o) => o.status === activeTab);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    // Prevent expansion when clicking dropdown
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

  const statusCounts: Record<string, number> = { ALL: orders.length };
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  }

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
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete order", variant: "error" });
    }
  };

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

        <div className="flex items-center gap-3">
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
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Hash className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
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
                <p className="text-xs text-gray-500 font-medium">Revenue Today</p>
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
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-12 text-center flex flex-col items-center gap-2 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                    <p className="font-medium">Loading orders...</p>
                  </div>
                ) : filteredOrders.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">
                    <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No orders in this category</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableHead className="w-[40px]" />
                        <TableHead className="w-[120px]">Order #</TableHead>
                        <TableHead>Table</TableHead>
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
                        <div key={order.id} className="contents">
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
                            <TableCell className="text-gray-600">
                              {order.tableId
                                ? `Table ${order.tableId.split("-").pop()}`
                                : "—"}
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
                                  <DropdownMenuItem onClick={() => openEditModal(order)}>
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit Status
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteOrder(order.id)}>
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

                                    {/* Summary */}
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
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </div>
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
