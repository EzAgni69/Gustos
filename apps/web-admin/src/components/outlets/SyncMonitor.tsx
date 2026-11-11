"use client";

/**
 * Edge Sync Monitor — is each outlet's POS talking to the cloud, and is
 * anything stuck?
 *
 * Every POS server sends a heartbeat about every 30 seconds with the size of
 * its upload queue. Status is derived from how long ago the last one arrived.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, CircleOff, Clock, Loader2, RefreshCw, Wifi } from "lucide-react";
import type { OutletSyncStatus } from "@gusto/api-contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiFetch } from "@/lib/api-client";

const REFRESH_MS = 15_000;

const STATUS: Record<OutletSyncStatus["status"], { label: string; className: string; icon: typeof Wifi; help: string }> = {
  ONLINE: { label: "Online", className: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, help: "Syncing normally" },
  DEGRADED: { label: "Late", className: "bg-amber-100 text-amber-800", icon: Clock, help: "Missed recent check-ins — connection may be unstable" },
  OFFLINE: { label: "Offline", className: "bg-rose-100 text-rose-700", icon: CircleOff, help: "Not reachable — the outlet keeps billing locally and will sync when it reconnects" },
  NEVER: { label: "Never connected", className: "bg-gray-100 text-gray-600", icon: CircleOff, help: "No POS has connected for this outlet yet" },
};

function ago(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

export function SyncMonitor({ active }: { active: boolean }) {
  const [rows, setRows] = useState<OutletSyncStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const res = await apiFetch<OutletSyncStatus[]>("/sync/status");
    if (res.success && res.data) {
      setRows(res.data);
      setError(null);
      setUpdatedAt(new Date());
    } else {
      // Keep showing the last good data, flagged as stale
      setError(res.message ?? "Failed to load sync status.");
    }
    setRefreshing(false);
  }, []);

  // Poll only while the tab is visible to the user
  useEffect(() => {
    if (!active) return;
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const counts = (rows ?? []).reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Partial<Record<OutletSyncStatus["status"], number>>
  );
  const needsAttention = (rows ?? []).filter(
    (r) => r.status === "OFFLINE" || r.status === "DEGRADED" || (r.deadUploads ?? 0) > 0
  ).length;

  return (
    <Card className="shadow-xs border-gray-100">
      <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-blue-600" />
          <div>
            <CardTitle className="text-lg">Edge Sync Monitor</CardTitle>
            <CardDescription>Live connection and sync backlog of each outlet's POS server.</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {updatedAt && <span>Updated {updatedAt.toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
            {refreshing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <div role="alert" className="m-4 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {error}
              {rows ? " Showing the last known status." : ""}
            </span>
          </div>
        )}

        {rows === null && !error ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : rows && rows.length === 0 ? (
          <EmptyState icon={Activity} title="No outlets yet" description="Create an outlet to see its POS connection here." />
        ) : rows ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-gray-100">
              {(["ONLINE", "DEGRADED", "OFFLINE", "NEVER"] as const).map((s) => (
                <div key={s} className="rounded-lg border border-gray-100 px-3 py-2">
                  <div className="text-2xl font-semibold tabular-nums">{counts[s] ?? 0}</div>
                  <div className="text-xs text-gray-500">{STATUS[s].label}</div>
                </div>
              ))}
            </div>
            {needsAttention > 0 && (
              <p className="px-4 pt-3 text-sm text-amber-700">
                {needsAttention} outlet{needsAttention === 1 ? "" : "s"} need{needsAttention === 1 ? "s" : ""} attention.
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last check-in</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Waiting to upload</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="text-right">ERP edits pending</TableHead>
                  <TableHead>POS version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const s = STATUS[r.status];
                  const Icon = s.icon;
                  return (
                    <TableRow key={r.outletId}>
                      <TableCell className="font-medium">{r.outletName}</TableCell>
                      <TableCell>
                        <span title={s.help} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
                          <Icon className="w-3 h-3" />
                          {s.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-600" title={r.lastSeen ? new Date(r.lastSeen).toLocaleString() : undefined}>
                        {ago(r.secondsSinceLastSeen)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-600">
                        {r.latencyMs === null || r.status === "NEVER" ? "—" : `${r.latencyMs} ms`}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${(r.pendingUploads ?? 0) > 50 ? "text-amber-700 font-medium" : "text-gray-600"}`}>
                        {r.pendingUploads ?? "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${(r.deadUploads ?? 0) > 0 ? "text-rose-700 font-medium" : "text-gray-600"}`}
                        title={(r.deadUploads ?? 0) > 0 ? "The cloud refused these events. Open Sync Queue on the POS to review and retry them." : undefined}
                      >
                        {r.deadUploads ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-600">{r.pendingCommands}</TableCell>
                      <TableCell className="text-gray-500">{r.posVersion ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
              An offline outlet keeps taking orders and printing bills; everything uploads automatically once it reconnects.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
