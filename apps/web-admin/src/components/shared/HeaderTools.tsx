"use client";

/**
 * Top-bar tools: quick navigation and the live alerts bell.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, Search, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRealtimeEvent, type SyncUpdateData } from "@/lib/socket-context";

// ─── Quick navigation ───

export interface QuickNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Extra words that should also find this page */
  keywords?: string;
}

/** Type a page name (or press "/") and hit Enter to jump there. */
export function QuickNav({ items }: { items: QuickNavItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.title} ${i.keywords ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => setHighlight(0), [query]);

  // "/" focuses the box unless the user is already typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  const go = (item: QuickNavItem | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(item.href);
  };

  return (
    <div ref={boxRef} className="relative hidden lg:block max-w-md w-full">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="quick-nav-list"
        aria-label="Go to page"
        placeholder="Go to page…  ( / )"
        value={query}
        className="pl-9 bg-gray-50 border-transparent focus-visible:bg-white transition-colors"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(matches[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <ul id="quick-nav-list" role="listbox" className="absolute z-50 mt-1 w-full max-h-80 overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No page matches “{query}”</li>
          ) : (
            matches.map((item, i) => (
              <li key={item.href} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === highlight ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => go(item)}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.title}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Alerts bell ───

interface Alert {
  id: number;
  kind: "stock" | "online";
  title: string;
  detail?: string;
  href: string;
  at: Date;
}

const MAX_ALERTS = 30;
let alertSeq = 0;

function toAlert(data: SyncUpdateData): Alert | null {
  const p = (data.payload ?? {}) as Record<string, unknown>;
  if (data.eventType === "LOW_STOCK_ALERT") {
    return {
      id: ++alertSeq,
      kind: "stock",
      title: `Low stock: ${String(p.name ?? "an ingredient")}`,
      detail: typeof p.message === "string" ? p.message : undefined,
      href: "/inventory",
      at: new Date(),
    };
  }
  if (data.eventType === "ONLINE_ORDER_RECEIVED") {
    return {
      id: ++alertSeq,
      kind: "online",
      title: "New online order",
      detail: p.order_id ? `Order ${String(p.order_id)} sent to the outlet POS` : undefined,
      href: "/orders",
      at: new Date(),
    };
  }
  if (data.eventType === "ONLINE_ORDER_AUTO_REJECTED") {
    return {
      id: ++alertSeq,
      kind: "online",
      title: "Online order timed out",
      detail: "The outlet did not respond in time, so the order was rejected.",
      href: "/orders",
      at: new Date(),
    };
  }
  return null;
}

/** Things that need someone's attention, as they happen (kept for this browser session). */
export function AlertsBell() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useRealtimeEvent(["LOW_STOCK_ALERT", "ONLINE_ORDER_RECEIVED", "ONLINE_ORDER_AUTO_REJECTED"], (data) => {
    const alert = toAlert(data);
    if (!alert) return;
    setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS));
    setUnread((n) => n + 1);
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="text-gray-500 relative"
        aria-label={unread > 0 ? `Alerts, ${unread} new` : "Alerts"}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setUnread(0);
        }}
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-900">Alerts</span>
            {alerts.length > 0 && (
              <button className="text-xs text-gray-500 hover:text-gray-800" onClick={() => setAlerts([])}>
                Clear all
              </button>
            )}
          </div>
          {alerts.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-500">
              Nothing needs attention. Low stock and online order alerts appear here as they happen.
            </p>
          ) : (
            <ul className="max-h-96 overflow-auto py-1">
              {alerts.map((a) => (
                <li key={a.id}>
                  <button
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
                    onClick={() => {
                      setOpen(false);
                      router.push(a.href);
                    }}
                  >
                    {a.kind === "stock" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    ) : (
                      <UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{a.title}</span>
                      {a.detail && <span className="block text-xs text-gray-500">{a.detail}</span>}
                      <span className="block text-[11px] text-gray-400">{a.at.toLocaleTimeString()}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
