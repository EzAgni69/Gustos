"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LineChart,
  BarChart3,
  Download,
  TrendingUp,
  IndianRupee,
  ShoppingCart,
  CreditCard,
  Loader2,
  CalendarDays,
  ArrowUpRight,
} from "lucide-react";
import type { Outlet } from "@gusto/api-contracts";
import { apiFetch } from "@/lib/api-client";

// ─── Date Range Helpers ───

type DateRange = "today" | "7d" | "30d" | "90d";

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
];

function getDateRangeStart(range: DateRange): Date {
  const now = new Date();
  switch (range) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "7d":
      return new Date(now.getTime() - 7 * 86400000);
    case "30d":
      return new Date(now.getTime() - 30 * 86400000);
    case "90d":
      return new Date(now.getTime() - 90 * 86400000);
  }
}

// ─── Report data types ───
type SalesReport = {
  summary: { totalOrders: number; totalRevenue: number; totalTax: number; totalDiscount: number; avgOrderValue: number; totalItemsSold: number };
  breakdown: { period: string; orderCount: number; totalRevenue: number; totalTax: number; totalDiscount: number; avgOrderValue: number; itemsSold: number }[];
};

type ProfitReport = {
  revenue: { totalRevenue: number; totalTax: number; totalDiscounts: number; netRevenueBeforeTax: number; orderCount: number; avgOrderValue: number };
  costs: { labourCost: number; commissions: number };
  online: { orderCount: number; revenue: number; commissions: number };
  topSellingItems: { name: string; quantity: number; revenue: number }[];
};

type InventoryReport = {
  summary: { totalItems: number; lowStockItems: number; totalInventoryValue: number };
  items: { id: string; name: string; unit: string; currentStock: number; minimumStock: number; costPerUnit: number; totalValue: number; isLowStock: boolean; stockPercentage: number }[];
};

// ─── Component ───

export default function ReportsPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [selectedOutletId, setSelectedOutletId] = useState<string>("all");

  const [salesReport, setSalesReport] = useState<SalesReport | null>(null);
  const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);
  const [inventoryReport, setInventoryReport] = useState<InventoryReport | null>(null);

  const loadReports = async (currentOutlets: Outlet[], outletId: string, range: DateRange) => {
    const targetOutletId = outletId === "all" ? currentOutlets[0]?.id : outletId;
    if (!targetOutletId) return;

    const rangeStart = getDateRangeStart(range);
    const startDate = rangeStart.toISOString().split("T")[0]!;
    const endDate = new Date().toISOString().split("T")[0]!;

    const [salesRes, profitRes, inventoryRes] = await Promise.all([
      apiFetch<SalesReport>(`/reports/sales?outletId=${targetOutletId}&startDate=${startDate}&endDate=${endDate}&groupBy=day`),
      apiFetch<ProfitReport>(`/reports/profitability?outletId=${targetOutletId}&startDate=${startDate}&endDate=${endDate}`),
      apiFetch<InventoryReport>(`/reports/inventory`),
    ]);

    if (salesRes.success && salesRes.data) setSalesReport(salesRes.data);
    if (profitRes.success && profitRes.data) setProfitReport(profitRes.data);
    if (inventoryRes.success && inventoryRes.data) setInventoryReport(inventoryRes.data);
  };

  const loadData = async () => {
    setLoading(true);
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);
      await loadReports(outletsRes.data, selectedOutletId, dateRange);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (outlets.length > 0) {
      loadReports(outlets, selectedOutletId, dateRange);
    }
  }, [dateRange, selectedOutletId]);

  // ─── Derived values ───
  const totalRevenue = salesReport?.summary.totalRevenue ?? 0;
  const totalOrders = salesReport?.summary.totalOrders ?? 0;
  const avgOrderValue = salesReport?.summary.avgOrderValue ?? 0;
  const topItems = profitReport?.topSellingItems ?? [];
  const maxItemQty = Math.max(...topItems.map((i) => i.quantity), 1);

  const revenueByDay = useMemo(() => {
    const breakdown = salesReport?.breakdown ?? [];
    return breakdown.map(b => ({ day: b.period, value: b.totalRevenue }));
  }, [salesReport]);

  const maxDayRevenue = Math.max(...revenueByDay.map((d) => d.value), 1);

  // ─── Export functions ───
  const exportGSTR1CSV = () => {
    const summary = salesReport?.summary;
    if (!summary) return;
    const totalTax = summary.totalTax;
    const totalTaxable = summary.totalRevenue - totalTax;
    const cgst = totalTax / 2;
    const sgst = totalTax / 2;
    const rows: string[][] = [
      ["Summary For Table 7 (B2CS) - Gusto ERP"],
      ["Type", "Place Of Supply", "Rate (%)", "Taxable Value (INR)", "CGST (INR)", "SGST (INR)", "Gross Value (INR)"],
      ["OE", "27-Maharashtra", "5.00", totalTaxable.toFixed(2), cgst.toFixed(2), sgst.toFixed(2), summary.totalRevenue.toFixed(2)],
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `GSTR-1_B2CS_${dateRange}_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportGeneralCSV = () => {
    const breakdown = salesReport?.breakdown ?? [];
    const rows: string[][] = [
      ["Period", "Order Count", "Total Revenue", "Total Tax", "Total Discount", "Avg Order Value"],
      ...breakdown.map(b => [b.period, String(b.orderCount), b.totalRevenue.toFixed(2), b.totalTax.toFixed(2), b.totalDiscount.toFixed(2), b.avgOrderValue.toFixed(2)]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `Sales_Report_${dateRange}_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-gray-500 font-medium">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Reports &amp; Analytics</h1>
          <p className="text-gray-500">Sales, profitability, and operational metrics.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold border border-gray-200 bg-white shadow-xs hover:bg-gray-100 h-9 px-4 py-2 cursor-pointer transition-colors">
              <Download className="w-4 h-4 text-blue-600" />
              Export Reports
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={exportGSTR1CSV} className="cursor-pointer font-medium text-emerald-700">
                🇮🇳 Download GSTR-1 Return (.csv)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportGeneralCSV} className="cursor-pointer font-medium">
                📄 Export Sales Register (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <select
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedOutletId}
            onChange={(e) => setSelectedOutletId(e.target.value)}
          >
            <option value="all">All Outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <div className="flex bg-gray-100 p-0.5 rounded-lg">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  dateRange === opt.value ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs border-gray-100 overflow-hidden">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  ₹{totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50">
                <IndianRupee className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <TrendingUp className="w-3 h-3 text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-600">{totalOrders} orders</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100 overflow-hidden">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Orders</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{totalOrders}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50">
                <ShoppingCart className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs font-medium text-gray-500">Completed orders</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100 overflow-hidden">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg. Order Value</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  ₹{avgOrderValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-indigo-50">
                <BarChart3 className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <ArrowUpRight className="w-3 h-3 text-gray-400" />
              <span className="text-xs font-medium text-gray-500">Per completed order</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100 overflow-hidden">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Items Sold</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {salesReport?.summary.totalItemsSold ?? 0}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50">
                <CreditCard className="w-5 h-5 text-purple-600" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs font-medium text-gray-500">Total items in period</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend + Top Items */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4 shadow-xs border-gray-100">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-50 rounded-lg">
                <LineChart className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">Revenue Trend</CardTitle>
                <CardDescription>Daily revenue from completed orders</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {revenueByDay.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
                No data available for this period
              </div>
            ) : (
              <div className="h-[220px] flex items-end justify-between gap-1.5 px-1 mt-2">
                {revenueByDay.map((data, idx) => {
                  const heightPct = (data.value / maxDayRevenue) * 100;
                  return (
                    <div key={idx} className="flex flex-col items-center gap-1.5 flex-1 group">
                      <div className="w-full flex justify-center relative">
                        <div className="opacity-0 group-hover:opacity-100 absolute -top-9 bg-gray-900 text-white text-[10px] font-semibold py-1 px-2 rounded-md transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                          ₹{data.value.toLocaleString("en-IN")}
                        </div>
                        <div
                          className="w-full max-w-[32px] rounded-t-md transition-all duration-500 ease-out"
                          style={{
                            height: `${Math.max(heightPct, 2)}%`,
                            background: data.value > 0 ? "linear-gradient(to top, #3b82f6, #60a5fa)" : "#e5e7eb",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-gray-400 whitespace-nowrap">{data.day}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 shadow-xs border-gray-100">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-amber-50 rounded-lg">
                <BarChart3 className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-base">Top Selling Items</CardTitle>
                <CardDescription>By revenue</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
                No items sold in this period
              </div>
            ) : (
              <div className="space-y-3">
                {topItems.slice(0, 8).map((item, i) => {
                  const pct = (item.quantity / maxItemQty) * 100;
                  return (
                    <div key={item.name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700 truncate max-w-[180px]">{item.name}</span>
                        <span className="text-xs font-bold text-gray-900 tabular-nums">×{item.quantity}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${pct}%`, background: `hsl(${30 + i * 20}, 80%, 55%)` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Profitability */}
      {profitReport && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="shadow-xs border-gray-100">
            <CardHeader><CardTitle className="text-base">Revenue Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Gross Revenue</span>
                <span className="font-semibold">₹{profitReport.revenue.totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Tax</span>
                <span className="font-semibold">₹{profitReport.revenue.totalTax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Discounts</span>
                <span className="font-semibold text-red-600">-₹{profitReport.revenue.totalDiscounts.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-sm font-bold">
                <span className="text-gray-900">Net Revenue (pre-tax)</span>
                <span>₹{profitReport.revenue.netRevenueBeforeTax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-xs border-gray-100">
            <CardHeader><CardTitle className="text-base">Cost Analysis</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Labour Cost</span>
                <span className="font-semibold">₹{profitReport.costs.labourCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Commissions</span>
                <span className="font-semibold">₹{profitReport.costs.commissions.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-sm font-bold">
                <span className="text-gray-900">Est. Margin</span>
                <span className="text-emerald-600">
                  {profitReport.revenue.totalRevenue > 0
                    ? (((profitReport.revenue.totalRevenue - profitReport.costs.labourCost - profitReport.costs.commissions) / profitReport.revenue.totalRevenue) * 100).toFixed(1)
                    : "0"}%
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-xs border-gray-100">
            <CardHeader><CardTitle className="text-base">Online Orders</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Order Count</span>
                <span className="font-semibold">{profitReport.online.orderCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Revenue</span>
                <span className="font-semibold">₹{profitReport.online.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Commissions Paid</span>
                <span className="font-semibold text-red-600">₹{profitReport.online.commissions.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Inventory Low-Stock Table */}
      {inventoryReport && (
        <Card className="shadow-xs border-gray-100">
          <CardHeader className="bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle className="text-base">Inventory Status</CardTitle>
                <CardDescription>
                  {inventoryReport.summary.lowStockItems} low-stock items · Total value ₹{inventoryReport.summary.totalInventoryValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Item</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Min Stock</TableHead>
                  <TableHead>Total Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventoryReport.items.filter(i => i.isLowStock).slice(0, 10).map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                    <TableCell className="text-gray-500">{item.unit}</TableCell>
                    <TableCell className="font-mono text-gray-700">{item.currentStock}</TableCell>
                    <TableCell className="font-mono text-gray-500">{item.minimumStock}</TableCell>
                    <TableCell className="text-gray-900">₹{item.totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell>
                      <Badge variant="destructive" className="text-[10px]">Low Stock</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {inventoryReport.items.filter(i => i.isLowStock).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                      All inventory items are at healthy levels.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
