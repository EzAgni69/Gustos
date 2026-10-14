"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Store,
  DollarSign,
  TrendingUp,
  Loader2,
  UtensilsCrossed,
  ClipboardList,
  Users2,
  Package,
  BarChart3,
  LayoutGrid,
  ArrowRight,
  IndianRupee,
  ShoppingCart,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { Organization, Outlet, User, Order } from "@gusto/api-contracts";

interface LowStockItem {
  id: string;
  name: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
}

export default function DashboardOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Organization | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);

  const loadDashboardData = async () => {
    setLoading(true);

    const [orgRes, outletsRes, staffRes, invRes] = await Promise.all([
      apiFetch<Organization>("/organizations/me"),
      apiFetch<Outlet[]>("/outlets"),
      apiFetch<User[]>("/users"),
      apiFetch<{ items: LowStockItem[] }>("/inventory?limit=100"),
    ]);

    if (orgRes.success && orgRes.data) {
      setOrg(orgRes.data);
    }

    if (invRes.success && invRes.data?.items) {
      const lows = invRes.data.items.filter(
        (i) => Number(i.currentStock) <= Number(i.minimumStock)
      );
      setLowStockItems(lows);
    }

    let allOrders: Order[] = [];

    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);

      // Fetch orders from each outlet for the revenue chart + activity feed
      for (const outlet of outletsRes.data) {
        const ordersRes = await apiFetch<Order[]>(
          `/orders?outletId=${outlet.id}&limit=50`
        );
        if (ordersRes.success && ordersRes.data) {
          allOrders.push(...ordersRes.data);
        }
      }

      // Sort by date desc
      allOrders.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setRecentOrders(allOrders);
    }

    if (staffRes.success && staffRes.data) {
      setStaff(staffRes.data);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // ─── Revenue Chart Data (real data: last 7 days) ───
  const revenueData = useMemo(() => {
    const now = new Date();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days: { day: string; value: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86400000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const dayRevenue = recentOrders
        .filter((o) => {
          const oDate = new Date(o.createdAt);
          return o.status === "COMPLETED" && oDate >= dayStart && oDate < dayEnd;
        })
        .reduce((acc, o) => acc + o.totalAmount, 0);

      days.push({ day: dayNames[date.getDay()]!, value: dayRevenue });
    }
    return days;
  }, [recentOrders]);

  const maxRevenue = Math.max(...revenueData.map((d) => d.value), 1);
  const totalWeekRevenue = revenueData.reduce((acc, d) => acc + d.value, 0);

  // Active/in-progress orders count
  const activeOrderCount = recentOrders.filter(
    (o) => o.status === "PLACED" || o.status === "IN_PROGRESS"
  ).length;

  // ─── Recent activity (latest 5 orders) ───
  const latestOrders = recentOrders.slice(0, 5);

  const timeAgo = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Quick Actions
  const quickActions = [
    { label: "Menu", href: "/menu", icon: UtensilsCrossed, color: "text-orange-600 bg-orange-50" },
    { label: "Orders", href: "/orders", icon: ClipboardList, color: "text-blue-600 bg-blue-50" },
    { label: "Tables", href: "/tables", icon: LayoutGrid, color: "text-emerald-600 bg-emerald-50" },
    { label: "Staff", href: "/staff", icon: Users2, color: "text-purple-600 bg-purple-50" },
    { label: "Inventory", href: "/inventory", icon: Package, color: "text-amber-600 bg-amber-50" },
    { label: "Reports", href: "/reports", icon: BarChart3, color: "text-indigo-600 bg-indigo-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard Overview</h1>
          <p className="text-gray-500">
            Welcome back{org?.name ? `, ${org.name} team` : ""}! Here's what's happening today.
          </p>
        </div>
        {activeOrderCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium text-emerald-700">
              {activeOrderCount} Active Order{activeOrderCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Low Stock Warning Banner */}
      {lowStockItems.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl shadow-xs animate-in fade-in-50 duration-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Low Stock Alert: {lowStockItems.length} ingredient{lowStockItems.length > 1 ? "s" : ""} below minimum threshold
              </p>
              <p className="text-xs text-amber-700">
                {lowStockItems
                  .slice(0, 3)
                  .map((i) => `${i.name} (${i.currentStock} ${i.unit})`)
                  .join(", ")}
                {lowStockItems.length > 3 ? ` and ${lowStockItems.length - 3} more` : ""}
              </p>
            </div>
          </div>
          <Link href="/inventory" className="shrink-0">
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-900 hover:bg-amber-100 text-xs font-semibold">
              Restock Inventory <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Weekly Revenue</CardTitle>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">
                  ₹{totalWeekRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 font-medium">
                  Last 7 days across all outlets
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Active Outlets</CardTitle>
            <Store className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">
                  {outlets.filter((o) => o.isActive).length}
                </div>
                <p className="text-xs text-gray-500 mt-1 font-medium">
                  Across your franchise network
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Organization</CardTitle>
            <Building2 className="w-4 h-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900 truncate" title={org?.name || "—"}>
                  {org?.name || "—"}
                </div>
                <p className="text-xs text-gray-500 mt-1 font-medium truncate">
                  GST: {org?.gstNumber || "Not configured"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Total Staff</CardTitle>
            <Users2 className="w-4 h-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">{staff.length}</div>
                <p className="text-xs text-gray-500 mt-1 font-medium">
                  {staff.filter((s) => s.isActive).length} active employees
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart + Activity Feed */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-xs border-gray-100">
          <CardHeader>
            <CardTitle className="text-gray-900">Weekly Revenue</CardTitle>
            <CardDescription>Sales performance across all outlets (last 7 days)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[250px] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="h-[250px] flex items-end justify-between gap-2 px-2 mt-4">
                {revenueData.map((data, idx) => {
                  const heightPercentage = (data.value / maxRevenue) * 100;
                  return (
                    <div key={idx} className="flex flex-col items-center gap-2 flex-1 group">
                      <div className="w-full flex justify-center relative">
                        {/* Tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 absolute -top-9 bg-gray-900 text-white text-[10px] font-semibold py-1 px-2 rounded-md transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                          ₹{data.value.toLocaleString("en-IN")}
                        </div>
                        {/* Bar */}
                        <div
                          className="w-full max-w-[40px] rounded-t-md transition-all duration-500 ease-out"
                          style={{
                            height: `${Math.max(heightPercentage, 2)}%`,
                            background:
                              data.value > 0
                                ? "linear-gradient(to top, #3b82f6, #60a5fa)"
                                : "#e5e7eb",
                          }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-500">{data.day}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3 shadow-xs border-gray-100">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-gray-900">Recent Activity</CardTitle>
                <CardDescription>Latest orders across outlets</CardDescription>
              </div>
              <Link href="/orders">
                <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 text-xs">
                  View All <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-48 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              </div>
            ) : latestOrders.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                No recent orders
              </div>
            ) : (
              <div className="space-y-5">
                {latestOrders.map((order) => {
                  const outletName =
                    outlets.find((o) => o.id === order.outletId)?.name || "—";
                  return (
                    <div key={order.id} className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                        <ShoppingCart className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-gray-900">
                          {order.orderNumber}
                          <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">
                            {order.status.replace("_", " ")}
                          </span>
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{outletName}</span>
                          <span>•</span>
                          <span>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
                          <span>•</span>
                          <span>{timeAgo(order.createdAt)}</span>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                        ₹{order.totalAmount.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="shadow-xs border-gray-100">
        <CardHeader>
          <CardTitle className="text-gray-900">Quick Actions</CardTitle>
          <CardDescription>Navigate to frequently used modules</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {quickActions.map((action) => (
              <Link key={action.href} href={action.href}>
                <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer group">
                  <div className={`p-2.5 rounded-xl ${action.color} transition-transform group-hover:scale-110`}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{action.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
