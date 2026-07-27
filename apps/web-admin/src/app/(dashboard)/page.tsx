"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Building2, Store, DollarSign, TrendingUp, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { Organization, Outlet, User } from "@gusto/api-contracts";

export default function DashboardOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Organization | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [staff, setStaff] = useState<User[]>([]);

  const loadDashboardData = async () => {
    setLoading(true);
    
    // Fetch real data where possible
    const [orgRes, outletsRes, staffRes] = await Promise.all([
      apiFetch<Organization>("/organizations/me"),
      apiFetch<Outlet[]>("/outlets"),
      apiFetch<User[]>("/users"),
    ]);

    if (orgRes.success && orgRes.data) {
      setOrg(orgRes.data);
    }
    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);
    }
    if (staffRes.success && staffRes.data) {
      setStaff(staffRes.data);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Mock revenue chart data
  const revenueData = [
    { day: "Mon", value: 45000 },
    { day: "Tue", value: 38000 },
    { day: "Wed", value: 42000 },
    { day: "Thu", value: 55000 },
    { day: "Fri", value: 85000 },
    { day: "Sat", value: 110000 },
    { day: "Sun", value: 95000 },
  ];
  const maxRevenue = Math.max(...revenueData.map(d => d.value));

  // Mock recent activity feed
  const recentOrders = [
    { id: "104", table: "T4", outlet: outlets[0]?.name || "Downtown Outlet", amount: 1450.00, time: "2 mins ago" },
    { id: "103", table: "VIP-1", outlet: outlets[0]?.name || "Downtown Outlet", amount: 3200.50, time: "15 mins ago" },
    { id: "102", table: "T12", outlet: outlets[1]?.name || "Airport Express", amount: 890.00, time: "1 hour ago" },
    { id: "101", table: "Takeaway", outlet: outlets[0]?.name || "Downtown Outlet", amount: 450.00, time: "2 hours ago" },
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
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs border-gray-100">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-gray-500">Total Revenue</CardTitle>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">₹4,70,000</div>
            <p className="text-xs text-emerald-600 flex items-center gap-1 mt-1 font-medium">
              <TrendingUp className="w-3 h-3" /> +12.5% from last week
            </p>
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
                <div className="text-2xl font-bold text-gray-900">{outlets.filter(o => o.isActive).length || 1}</div>
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
                <div className="text-2xl font-bold text-gray-900 truncate" title={org?.name || "Mock Org"}>
                  {org?.name || "Mock Org"}
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
            <div className="w-4 h-4 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-[10px] font-bold">
              S
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold text-gray-900">{staff.length || 5}</div>
                <p className="text-xs text-gray-500 mt-1 font-medium">
                  Registered employees
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-xs border-gray-100">
          <CardHeader>
            <CardTitle className="text-gray-900">Weekly Revenue</CardTitle>
            <CardDescription>Sales performance across all outlets (last 7 days)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] flex items-end justify-between gap-2 px-2 mt-4">
              {revenueData.map((data, idx) => {
                const heightPercentage = (data.value / maxRevenue) * 100;
                return (
                  <div key={idx} className="flex flex-col items-center gap-2 flex-1 group">
                    <div className="w-full flex justify-center relative">
                      {/* Tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-gray-900 text-white text-xs font-medium py-1 px-2 rounded transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-md">
                        ₹{data.value.toLocaleString("en-IN")}
                      </div>
                      {/* Bar */}
                      <div 
                        className="w-full max-w-[40px] bg-blue-100 hover:bg-blue-600 transition-all duration-300 rounded-t-md"
                        style={{ height: `${heightPercentage}%`, minHeight: '4px' }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-500">{data.day}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        
        <Card className="col-span-3 shadow-xs border-gray-100">
          <CardHeader>
            <CardTitle className="text-gray-900">Recent Activity</CardTitle>
            <CardDescription>Latest orders across outlets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {recentOrders.map((order, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 text-xs font-bold shrink-0">
                    #{order.id}
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-gray-900">
                      Order from {order.table}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{order.outlet}</span>
                      <span>•</span>
                      <span>{order.time}</span>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                    ₹{order.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
