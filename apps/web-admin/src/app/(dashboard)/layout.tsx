"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Building2, 
  Store, 
  Users, 
  UtensilsCrossed, 
  Package, 
  Users2, 
  LineChart, 
  Menu,
  Bell,
  Search,
  LogOut,
  ClipboardList,
  LayoutGrid,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sidebarNavItems = [
  {
    title: "Overview",
    href: "/",
    icon: LineChart,
  },
  {
    title: "Organizations",
    href: "/organizations",
    icon: Building2,
  },
  {
    title: "Outlets",
    href: "/outlets",
    icon: Store,
  },
  {
    title: "Menu Management",
    href: "/menu",
    icon: UtensilsCrossed,
  },
  {
    title: "Orders",
    href: "/orders",
    icon: ClipboardList,
  },
  {
    title: "Tables",
    href: "/tables",
    icon: LayoutGrid,
  },
  {
    title: "Inventory",
    href: "/inventory",
    icon: Package,
  },
  {
    title: "Customers",
    href: "/customers",
    icon: Users2,
  },
  {
    title: "Staff",
    href: "/staff",
    icon: Users,
  },
  {
    title: "Reports",
    href: "/reports",
    icon: BarChart3,
  },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const handleLogout = () => {
    document.cookie = "gusto_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col fixed inset-y-0 z-10">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-gray-900 tracking-tight">
            <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm shadow-md shadow-blue-500/20">
              🍽️
            </span>
            Gusto ERP
          </Link>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {sidebarNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-blue-600" : "text-gray-400")} />
                {item.title}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-gray-200">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-gray-600 hover:text-red-600 hover:bg-red-50"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 w-5 h-5 text-gray-400" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:pl-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-20 flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="w-5 h-5" />
            </Button>
            
            <div className="relative hidden sm:block max-w-md w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input 
                type="search" 
                placeholder="Search anything..." 
                className="pl-9 bg-gray-50 border-transparent focus-visible:bg-white transition-colors"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-gray-500 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </Button>
            
            <div className="h-8 w-8 rounded-full bg-linear-to-tr from-blue-600 to-indigo-600 shadow-sm overflow-hidden border-2 border-white">
              {/* Placeholder Avatar */}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
