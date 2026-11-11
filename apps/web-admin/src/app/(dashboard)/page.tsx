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
  Store,
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
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useRealtimeEvent } from "@/lib/socket-context";
import type { Organization, Outlet, User, Order } from "@gusto/api-contracts";

// ─── ViewMode ───────────────────────────────────────────────────────────────
type ViewMode = "Daily" | "Weekly";

// ─── getDayBounds ────────────────────────────────────────────────────────────
// Returns the local-midnight start and end of a day that is `daysAgo` days
// before today. `daysAgo = 0` → today; `daysAgo = 1` → yesterday, etc.
function getDayBounds(daysAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { start, end };
}

// ─── computeChange ───────────────────────────────────────────────────────────
// Returns the percentage change from `prev` to `curr`.
// - Returns `null`  when both values are 0 (no meaningful change).
// - Returns `100`   when prev is 0 but curr is non-zero (new activity).
// - Returns the rounded percentage change otherwise.
function computeChange(curr: number, prev: number): number | null {
  if (curr === 0 && prev === 0) return null;
  if (prev === 0) return 100;
  return Math.round(((curr - prev) / prev) * 100);
}

// ─── ComparisonBadge ─────────────────────────────────────────────────────────
// Renders a colored badge showing the percentage change vs a comparison period.
// - Renders nothing when `change` is null (both values were zero — no meaningful change)
// - Green (emerald) for positive or zero change (change >= 0)
// - Red for negative change (change < 0)
// - Uses "−" (U+2212 MINUS SIGN) for negative values, "+" for positive/zero
function ComparisonBadge({ change, period }: { change: number | null; period: string }) {
  if (change === null) return null;

  const isPositive = change >= 0;
  const colorClass = isPositive
    ? "text-emerald-700 bg-emerald-50"
    : "text-red-700 bg-red-50";
  const sign = isPositive ? "+" : "−";
  const absChange = Math.abs(change);

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${colorClass}`}>
      {sign}{absChange}% vs {period}
    </span>
  );
}

interface LowStockItem {
  id: string;
  name: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
}

interface KpiMetrics {
  revenue: number;
  orders: number;
  avgOrderValue: number;
  revenueChange: number | null;
  ordersChange: number | null;
  avgChange: number | null;
}

// ─── WeeklyTrendChart ────────────────────────────────────────────────────────
// SVG polyline chart comparing this week's revenue against last week's.
// viewBox="0 0 500 180", fully fluid with width="100%".
const PAD_LEFT = 20;
const PAD_RIGHT = 20;
const PAD_TOP = 20;
const PAD_BOTTOM = 40;
const CHART_W = 500;
const CHART_H_TOTAL = 180;
const chartW = CHART_W - PAD_LEFT - PAD_RIGHT; // 460
const chartH = CHART_H_TOTAL - PAD_TOP - PAD_BOTTOM; // 120

function toPoints(values: number[], maxVal: number): string {
  return values
    .map((v, i) => {
      const x = PAD_LEFT + (i / 6) * chartW;
      const y = maxVal === 0
        ? PAD_TOP + chartH
        : PAD_TOP + chartH - (v / maxVal) * chartH;
      return `${x},${y}`;
    })
    .join(" ");
}

function WeeklyTrendChart({
  thisWeek,
  lastWeek,
  labels,
}: {
  thisWeek: number[];
  lastWeek: number[];
  labels: string[];
}) {
  const maxVal = Math.max(...thisWeek, ...lastWeek, 0);

  // Grid line y-positions (5 evenly spaced horizontal lines)
  const gridLines = [0, 1, 2, 3, 4].map(
    (n) => PAD_TOP + (n / 4) * chartH
  );

  const thisWeekPoints = toPoints(thisWeek, maxVal);
  const lastWeekPoints = toPoints(lastWeek, maxVal);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H_TOTAL}`}
      width="100%"
      aria-label="Weekly revenue trend chart"
      role="img"
      className="block"
    >
      {/* Horizontal grid lines */}
      {gridLines.map((y, i) => (
        <line
          key={i}
          x1={PAD_LEFT}
          y1={y}
          x2={CHART_W - PAD_RIGHT}
          y2={y}
          stroke="#f1f5f9"
          strokeWidth={1}
        />
      ))}

      {/* Last-week polyline (gray, dashed) */}
      <polyline
        points={lastWeekPoints}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={2}
        strokeDasharray="4 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* This-week polyline (blue, solid) */}
      <polyline
        points={thisWeekPoints}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* This-week data point circles */}
      {thisWeek.map((v, i) => {
        const x = PAD_LEFT + (i / 6) * chartW;
        const y = maxVal === 0
          ? PAD_TOP + chartH
          : PAD_TOP + chartH - (v / maxVal) * chartH;
        return (
          <circle key={i} cx={x} cy={y} r={3.5} fill="#3b82f6">
            <title>₹{v.toLocaleString("en-IN")}</title>
          </circle>
        );
      })}

      {/* X-axis day labels */}
      {labels.map((label, i) => {
        const x = PAD_LEFT + (i / 6) * chartW;
        return (
          <text
            key={i}
            x={x}
            y={CHART_H_TOTAL - 6}
            textAnchor="middle"
            fontSize={10}
            fill="#94a3b8"
            fontFamily="inherit"
          >
            {label}
          </text>
        );
      })}

      {/* Inline legend */}
      {/* This Week */}
      <rect x={PAD_LEFT} y={PAD_TOP - 14} width={10} height={10} rx={2} fill="#3b82f6" />
      <text x={PAD_LEFT + 14} y={PAD_TOP - 5} fontSize={10} fill="#64748b" fontFamily="inherit">
        This Week
      </text>
      {/* Last Week — dashed line swatch */}
      <line
        x1={PAD_LEFT + 80}
        y1={PAD_TOP - 10}
        x2={PAD_LEFT + 90}
        y2={PAD_TOP - 10}
        stroke="#94a3b8"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <text x={PAD_LEFT + 94} y={PAD_TOP - 5} fontSize={10} fill="#64748b" fontFamily="inherit">
        Last Week
      </text>
    </svg>
  );
}

export default function DashboardOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Organization | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("Daily");

  const loadDashboardData = async () => {
    setLoading(true);

    const [orgRes, outletsRes, staffRes, invRes] = await Promise.all([
      apiFetch<Organization>("/organizations/me"),
      apiFetch<Outlet[]>("/outlets"),
      apiFetch<User[]>("/users"),
      apiFetch<LowStockItem[] | { items: LowStockItem[] }>("/inventory?limit=100"),
    ]);

    if (orgRes.success && orgRes.data) {
      setOrg(orgRes.data);
    }

    if (invRes.success && invRes.data) {
      const items: LowStockItem[] = Array.isArray(invRes.data)
        ? invRes.data
        : (invRes.data as { items?: LowStockItem[] }).items || [];
      const lows = items.filter(
        (i) => Number(i.currentStock) <= Number(i.minimumStock)
      );
      setLowStockItems(lows);
    }

    const allOrders: Order[] = [];

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

  useRealtimeEvent(
    [
      "ORDER_COMPLETED",
      "ORDER_CREATED",
      "ORDER_UPDATED",
      "ORDER_CANCELLED",
      "ORDERS_MERGED",
      "ORDER_MODE_CHANGED",
      "ORDER_COMPLIMENTARY",
    ],
    () => {
      loadDashboardData();
    }
  );

  // ─── Daily Bar Data (today's single-bar) ────────────────────────────────
  const dailyBarData = useMemo(() => {
    const { start, end } = getDayBounds(0);
    const revenue = recentOrders
      .filter((o) => o.status === "COMPLETED" && new Date(o.createdAt) >= start && new Date(o.createdAt) < end)
      .reduce((s, o) => s + o.totalAmount, 0);
    return [{ day: "Today", value: revenue }];
  }, [recentOrders]);

  // ─── Revenue Chart Data (real data: last 7 days + prior 7 days) ───
  const { revenueData, lastWeekRevenueData } = useMemo(() => {
    const now = new Date();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const thisWeekDays: { day: string; value: number }[] = [];
    const lastWeekDays: { day: string; value: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      // This week: days 0–6 ago
      const dateThis = new Date(now.getTime() - i * 86400000);
      const dayStartThis = new Date(dateThis.getFullYear(), dateThis.getMonth(), dateThis.getDate());
      const dayEndThis = new Date(dayStartThis.getTime() + 86400000);
      const dayRevenueThis = recentOrders
        .filter((o) => {
          const oDate = new Date(o.createdAt);
          return o.status === "COMPLETED" && oDate >= dayStartThis && oDate < dayEndThis;
        })
        .reduce((acc, o) => acc + o.totalAmount, 0);
      thisWeekDays.push({ day: dayNames[dateThis.getDay()]!, value: dayRevenueThis });

      // Last week: days 7–13 ago (same weekday, one week earlier)
      const dateLast = new Date(now.getTime() - (i + 7) * 86400000);
      const dayStartLast = new Date(dateLast.getFullYear(), dateLast.getMonth(), dateLast.getDate());
      const dayEndLast = new Date(dayStartLast.getTime() + 86400000);
      const dayRevenueLast = recentOrders
        .filter((o) => {
          const oDate = new Date(o.createdAt);
          return o.status === "COMPLETED" && oDate >= dayStartLast && oDate < dayEndLast;
        })
        .reduce((acc, o) => acc + o.totalAmount, 0);
      lastWeekDays.push({ day: dayNames[dateLast.getDay()]!, value: dayRevenueLast });
    }
    return { revenueData: thisWeekDays, lastWeekRevenueData: lastWeekDays };
  }, [recentOrders]);

  const totalWeekRevenue = revenueData.reduce((acc, d) => acc + d.value, 0);

  // ─── Mode-aware chart variables ──────────────────────────────────────────
  const chartData = viewMode === "Daily" ? dailyBarData : revenueData;
  const chartTitle = viewMode === "Daily" ? "Today's Revenue" : "Weekly Revenue";
  const chartSubtitle =
    viewMode === "Daily"
      ? "Completed orders revenue for today"
      : "Sales performance across all outlets (last 7 days)";
  const maxChartValue = Math.max(...chartData.map((d) => d.value), 1);

  // ─── Daily KPI Metrics (today vs yesterday completed orders) ───
  const dailyMetrics = useMemo((): KpiMetrics => {
    const todayBounds = getDayBounds(0);
    const yesterdayBounds = getDayBounds(1);

    const todayOrders = recentOrders.filter(
      (o) =>
        o.status === "COMPLETED" &&
        new Date(o.createdAt) >= todayBounds.start &&
        new Date(o.createdAt) < todayBounds.end
    );
    const yesterdayOrders = recentOrders.filter(
      (o) =>
        o.status === "COMPLETED" &&
        new Date(o.createdAt) >= yesterdayBounds.start &&
        new Date(o.createdAt) < yesterdayBounds.end
    );

    const currRevenue = todayOrders.reduce((acc, o) => acc + o.totalAmount, 0);
    const prevRevenue = yesterdayOrders.reduce((acc, o) => acc + o.totalAmount, 0);
    const currCount = todayOrders.length;
    const prevCount = yesterdayOrders.length;
    const currAvg = currCount > 0 ? currRevenue / currCount : 0;
    const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

    return {
      revenue: currRevenue,
      orders: currCount,
      avgOrderValue: currAvg,
      revenueChange: computeChange(currRevenue, prevRevenue),
      ordersChange: computeChange(currCount, prevCount),
      avgChange: computeChange(currAvg, prevAvg),
    };
  }, [recentOrders]);

  // ─── Weekly KPI Metrics (last 7 days vs prior 7 days completed orders) ───
  const weeklyMetrics = useMemo((): KpiMetrics => {
    const now = new Date();
    const last7Start = getDayBounds(6).start;
    const prior7Start = getDayBounds(13).start;
    const prior7End = last7Start;

    const last7Orders = recentOrders.filter(
      (o) =>
        o.status === "COMPLETED" &&
        new Date(o.createdAt) >= last7Start &&
        new Date(o.createdAt) < now
    );
    const prior7Orders = recentOrders.filter(
      (o) =>
        o.status === "COMPLETED" &&
        new Date(o.createdAt) >= prior7Start &&
        new Date(o.createdAt) < prior7End
    );

    const currRevenue = last7Orders.reduce((acc, o) => acc + o.totalAmount, 0);
    const prevRevenue = prior7Orders.reduce((acc, o) => acc + o.totalAmount, 0);
    const currCount = last7Orders.length;
    const prevCount = prior7Orders.length;
    const currAvg = currCount > 0 ? currRevenue / currCount : 0;
    const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

    return {
      revenue: currRevenue,
      orders: currCount,
      avgOrderValue: currAvg,
      revenueChange: computeChange(currRevenue, prevRevenue),
      ordersChange: computeChange(currCount, prevCount),
      avgChange: computeChange(currAvg, prevAvg),
    };
  }, [recentOrders]);

  // ─── Weekly Trend Data (Mon–Sun this week vs last week) ───
  const weeklyTrendData = useMemo(() => {
    const now = new Date();
    const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
    const mondayOffset = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);

    const series = (weekStart: Date) =>
      Array.from({ length: 7 }, (_, i) => {
        const dayStart = new Date(weekStart.getTime() + i * 86_400_000);
        const dayEnd = new Date(dayStart.getTime() + 86_400_000);
        return recentOrders
          .filter((o) => {
            const d = new Date(o.createdAt);
            return o.status === "COMPLETED" && d >= dayStart && d < dayEnd;
          })
          .reduce((s, o) => s + o.totalAmount, 0);
      });

    return {
      thisWeek: series(thisMonday),
      lastWeek: series(lastMonday),
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    };
  }, [recentOrders]);

  // ─── Active metrics derived from viewMode ───
  const activeMetrics: KpiMetrics = viewMode === "Daily" ? dailyMetrics : weeklyMetrics;
  const period: string = viewMode === "Daily" ? "yesterday" : "last week";

  // Active/in-progress orders count
  // (Any order still open on the POS/Captain app: placed, cooking, ready, served or held.)
  const activeOrderCount = recentOrders.filter(
    (o) => o.status !== "COMPLETED" && o.status !== "CANCELLED"
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
        {/* Revenue */}
        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">
              {viewMode === "Daily" ? "Today's Revenue" : "Weekly Revenue"}
            </CardTitle>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">
                  ₹{activeMetrics.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 font-medium">
                  <ComparisonBadge change={activeMetrics.revenueChange} period={period} />
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Orders */}
        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Completed Orders</CardTitle>
            <ShoppingCart className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">
                  {activeMetrics.orders}
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 font-medium">
                  <ComparisonBadge change={activeMetrics.ordersChange} period={period} />
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Avg Order Value */}
        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Avg Order Value</CardTitle>
            <TrendingUp className="w-4 h-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">
                  ₹{activeMetrics.avgOrderValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 font-medium">
                  <ComparisonBadge change={activeMetrics.avgChange} period={period} />
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Active Outlets */}
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
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-full border border-gray-200 bg-gray-100 p-0.5 gap-0.5">
          {(["Daily", "Weekly"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={
                viewMode === mode
                  ? "bg-white text-gray-900 shadow-sm rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-150"
                  : "text-gray-500 hover:text-gray-700 rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-150"
              }
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue Chart + Activity Feed */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-xs border-gray-100">
          <CardHeader>
            <CardTitle className="text-gray-900">{chartTitle}</CardTitle>
            <CardDescription>{chartSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[180px] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="space-y-2 py-2">
                {chartData.map((d) => (
                  <div key={d.day} className="flex items-center gap-2">
                    <div className="w-10 text-xs text-gray-500 text-right shrink-0">{d.day}</div>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                      <div
                        className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${(d.value / maxChartValue) * 100}%` }}
                      />
                    </div>
                    <div className="w-20 text-xs text-gray-700 text-right shrink-0 font-medium">
                      ₹{d.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                ))}
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

      {/* Weekly Growth Section */}
      <Card className="shadow-xs border-gray-100">
        <CardHeader>
          <CardTitle>Weekly Growth</CardTitle>
          <CardDescription>Revenue comparison: this week vs last week</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[180px] flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <WeeklyTrendChart
              thisWeek={weeklyTrendData.thisWeek}
              lastWeek={weeklyTrendData.lastWeek}
              labels={weeklyTrendData.labels}
            />
          )}
        </CardContent>
      </Card>

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
