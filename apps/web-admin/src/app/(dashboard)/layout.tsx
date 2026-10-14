"use client";

import { ReactNode, useState, useEffect } from "react";
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
  Settings,
  X,
  ChevronRight,
  CalendarDays,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";

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
    title: "CRM",
    href: "/crm",
    icon: MessageSquare,
  },
  {
    title: "Staff",
    href: "/staff",
    icon: Users,
  },
  {
    title: "HR",
    href: "/hr",
    icon: CalendarDays,
  },
  {
    title: "Reports",
    href: "/reports",
    icon: BarChart3,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");

  // Fetch current user name
  useEffect(() => {
    const loadUser = async () => {
      const res = await apiFetch<{ name: string; role: string }>("/auth/me");
      if (res.success && res.data) {
        setUserName(res.data.name);
        setUserRole(res.data.role);
      }
    };
    loadUser();
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    document.cookie = "gusto_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    window.location.href = "/login";
  };

  // Get current page title for breadcrumb
  const currentPage = sidebarNavItems.find(
    (item) =>
      item.href === pathname ||
      (item.href !== "/" && pathname.startsWith(item.href))
  );

  const SidebarContent = () => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-gray-200 shrink-0">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl text-gray-900 tracking-tight">
          <img src="/logo.png" alt="Gusto's" className="h-8 object-contain" />
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
      
      {/* User Info + Logout */}
      <div className="p-4 border-t border-gray-200 shrink-0">
        {userName && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">{userRole}</p>
            </div>
          </div>
        )}
        <Button 
          variant="ghost" 
          className="w-full justify-start text-gray-600 hover:text-red-600 hover:bg-red-50"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 w-5 h-5 text-gray-400" />
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col fixed inset-y-0 z-10">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-in fade-in-0 duration-200"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Drawer */}
          <aside className="absolute inset-y-0 left-0 w-72 bg-white flex flex-col shadow-2xl animate-in slide-in-from-left-5 duration-300">
            <div className="absolute top-4 right-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 md:pl-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-20 flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            
            <Link href="/" className="flex md:hidden items-center gap-2 font-bold text-base text-gray-900 tracking-tight">
              <img src="/logo.png" alt="Gusto's" className="h-7 object-contain" />
              <span>Gusto ERP</span>
            </Link>
            
            {/* Breadcrumb */}
            <div className="hidden sm:flex items-center gap-1.5 text-sm">
              <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
                Dashboard
              </Link>
              {currentPage && currentPage.href !== "/" && (
                <>
                  <ChevronRight className="w-3 h-3 text-gray-300" />
                  <span className="font-medium text-gray-700">{currentPage.title}</span>
                </>
              )}
            </div>

            <div className="relative hidden lg:block max-w-md w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input 
                type="search" 
                placeholder="Search anything..." 
                className="pl-9 bg-gray-50 border-transparent focus-visible:bg-white transition-colors"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-gray-500 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </Button>
            
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-sm overflow-hidden border-2 border-white flex items-center justify-center text-white text-xs font-bold">
              {userName ? userName.charAt(0).toUpperCase() : ""}
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
