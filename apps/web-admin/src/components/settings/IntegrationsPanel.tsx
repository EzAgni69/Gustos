"use client";

/**
 * Settings → Integrations.
 *
 * - Zomato: per-outlet webhook credentials. Incoming orders are verified with
 *   the webhook secret and pushed to that outlet's POS.
 * - Tally: download a day's sales as Tally-importable XML.
 * - Swiggy / Razorpay: listed as not yet available rather than shown as
 *   forms that do nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, CreditCard, Download, Loader2 } from "lucide-react";
import type { IntegrationConfig, Outlet } from "@gusto/api-contracts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, getApiBaseUrl } from "@/lib/api-client";
import { getPersistedOutletId } from "@/lib/outlet-context";
import { useToast } from "@/lib/toast";

const selectClass =
  "rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

function authToken(): string | null {
  const match = document.cookie.match(/(?:^|; )gusto_token=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Absolute URL of the API (the webhook URL must be reachable from the internet). */
function publicApiBase(): string {
  const base = getApiBaseUrl();
  return base.startsWith("http") ? base : `${window.location.origin}${base}`;
}

export function IntegrationsPanel({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Zomato ──
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [restaurantId, setRestaurantId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Tally ──
  const [tallyDate, setTallyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    apiFetch<Outlet[]>("/outlets?limit=100").then((res) => {
      if (!res.success || !res.data) return setLoadError(res.message ?? "Failed to load outlets.");
      setOutlets(res.data);
      const saved = getPersistedOutletId();
      setOutletId(saved && res.data.some((o) => o.id === saved) ? saved : (res.data[0]?.id ?? ""));
    });
  }, []);

  const loadConfig = useCallback(async () => {
    if (!outletId) return;
    setConfigLoading(true);
    setFormError(null);
    const res = await apiFetch<IntegrationConfig[]>(`/integrations/configs?outletId=${outletId}&provider=ZOMATO`);
    setConfigLoading(false);
    if (!res.success) return setLoadError(res.message ?? "Failed to load integration settings.");
    setLoadError(null);
    const found = res.data?.[0] ?? null;
    setConfig(found);
    setRestaurantId(found?.restaurantId ?? "");
    setWebhookSecret("");
    setIsActive(found ? found.isActive : true);
  }, [outletId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const webhookUrl = typeof window === "undefined" ? "" : `${publicApiBase()}/integrations/webhooks/zomato`;

  const saveZomato = async () => {
    const id = restaurantId.trim();
    const secret = webhookSecret.trim();
    if (!id) return setFormError("Enter the Zomato restaurant ID for this outlet.");
    if (!config && !secret) return setFormError("Enter the webhook secret — without it incoming orders cannot be verified.");
    if (secret && secret.length < 16) return setFormError("Use a webhook secret of at least 16 characters.");

    setSaving(true);
    setFormError(null);
    const res = config
      ? await apiFetch<IntegrationConfig>(`/integrations/configs/${config.id}`, {
          method: "PUT",
          // The secret is only sent when it is being replaced
          body: JSON.stringify({ restaurantId: id, isActive, ...(secret ? { webhookSecret: secret } : {}) }),
        })
      : await apiFetch<IntegrationConfig>("/integrations/configs", {
          method: "POST",
          body: JSON.stringify({ outletId, provider: "ZOMATO", restaurantId: id, webhookSecret: secret, isActive }),
        });
    setSaving(false);

    if (!res.success) return setFormError(res.message ?? "Could not save the Zomato settings.");
    toast({ title: "Zomato settings saved" });
    loadConfig();
  };

  const disconnect = async () => {
    if (!config) return;
    setSaving(true);
    const res = await apiFetch(`/integrations/configs/${config.id}`, { method: "DELETE" });
    setSaving(false);
    setConfirmDisconnect(false);
    if (!res.success) return toast({ title: "Could not disconnect", description: res.message, variant: "error" });
    toast({ title: "Zomato disconnected for this outlet" });
    loadConfig();
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Could not copy", description: "Select the URL and copy it manually.", variant: "error" });
    }
  };

  const downloadTally = async () => {
    if (!outletId) return;
    setDownloading(true);
    try {
      const token = authToken();
      const res = await fetch(`${getApiBaseUrl()}/reports/tally-export?outletId=${outletId}&date=${tallyDate}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Export failed (${res.status})`);
      }
      const vouchers = res.headers.get("X-Tally-Voucher-Count");
      const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `Tally_${tallyDate}.xml`;
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Tally export downloaded", description: vouchers ? `${vouchers} voucher(s) for ${tallyDate}.` : undefined });
    } catch (err) {
      toast({ title: "Tally export failed", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setDownloading(false);
    }
  };

  const connected = !!config && config.isActive;
  const outletName = outlets.find((o) => o.id === outletId)?.name;

  return (
    <div className="space-y-4">
      {loadError && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      )}

      {outlets.length > 1 && (
        <div className="flex items-center gap-2">
          <Label htmlFor="integration-outlet" className="text-sm text-gray-600">
            Outlet
          </Label>
          <select id="integration-outlet" className={selectClass} value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {outlets.length === 0 && !loadError ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Create an outlet first — integrations are configured per outlet.
        </p>
      ) : (
        <>
          {/* Zomato */}
          <Card className="shadow-xs border-gray-100">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-2xl">🍽️</div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Zomato</h3>
                    <p className="text-sm text-gray-500">Zomato orders arrive on {outletName ?? "the outlet"}'s POS for staff to accept.</p>
                  </div>
                </div>
                {configLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                ) : (
                  <Badge variant={connected ? "default" : "muted"} className="text-xs">
                    {connected ? "Connected" : config ? "Paused" : "Not connected"}
                  </Badge>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium text-gray-500">Webhook URL — give this to Zomato</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                    <Button type="button" variant="outline" onClick={copyWebhook} aria-label="Copy webhook URL">
                      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zomato-restaurant" className="text-xs font-medium text-gray-500">
                    Zomato restaurant ID
                  </Label>
                  <Input
                    id="zomato-restaurant"
                    value={restaurantId}
                    maxLength={100}
                    disabled={!canEdit || saving || configLoading}
                    onChange={(e) => setRestaurantId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zomato-secret" className="text-xs font-medium text-gray-500">
                    Webhook secret
                  </Label>
                  <Input
                    id="zomato-secret"
                    type="password"
                    autoComplete="new-password"
                    value={webhookSecret}
                    placeholder={config?.webhookSecret ? "Saved — type to replace" : "Shared secret from Zomato"}
                    disabled={!canEdit || saving || configLoading}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <Switch checked={isActive} onCheckedChange={setIsActive} disabled={!canEdit || saving || configLoading} />
                  Accept orders from Zomato
                </label>
                <div className="flex gap-2">
                  {config && canEdit && (
                    <Button variant="ghost" className="text-rose-600" onClick={() => setConfirmDisconnect(true)} disabled={saving}>
                      Disconnect
                    </Button>
                  )}
                  <Button className="bg-blue-600 hover:bg-blue-700" onClick={saveZomato} disabled={!canEdit || saving || configLoading || !outletId}>
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {config ? "Save changes" : "Connect"}
                  </Button>
                </div>
              </div>
              {formError && (
                <p role="alert" className="mt-2 text-sm text-rose-600">
                  {formError}
                </p>
              )}
              {!canEdit && <p className="mt-2 text-xs text-gray-500">Only the owner can change integration settings.</p>}
              <p className="mt-3 text-xs text-gray-500">
                Accepting, rejecting and marking an order ready on the POS is recorded here, but is not yet sent back to Zomato — keep
                confirming on the Zomato device as well.
              </p>
            </CardContent>
          </Card>

          {/* Tally */}
          <Card className="shadow-xs border-gray-100">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-2xl">📊</div>
                <div>
                  <h3 className="font-semibold text-gray-900">Tally Export</h3>
                  <p className="text-sm text-gray-500">Download a day's sales for {outletName ?? "the outlet"} as Tally-importable XML.</p>
                </div>
              </div>
              <div className="mt-4 flex items-end gap-3 flex-wrap">
                <div className="space-y-1.5">
                  <Label htmlFor="tally-date" className="text-xs font-medium text-gray-500">
                    Business date
                  </Label>
                  <Input
                    id="tally-date"
                    type="date"
                    value={tallyDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setTallyDate(e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={downloadTally} disabled={downloading || !outletId || !tallyDate}>
                  {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  Download XML
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Not yet available */}
      {[
        { name: "Swiggy", icon: <span className="text-2xl">🛵</span>, bg: "bg-orange-50", text: "Receiving Swiggy orders on the POS." },
        { name: "Razorpay", icon: <CreditCard className="w-6 h-6 text-blue-600" />, bg: "bg-blue-50", text: "Online card / UPI collection from the POS." },
      ].map((item) => (
        <Card key={item.name} className="shadow-xs border-gray-100">
          <CardContent className="pt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${item.bg} flex items-center justify-center`}>{item.icon}</div>
              <div>
                <h3 className="font-semibold text-gray-900">{item.name}</h3>
                <p className="text-sm text-gray-500">{item.text}</p>
              </div>
            </div>
            <Badge variant="muted" className="text-xs whitespace-nowrap">
              Not available yet
            </Badge>
          </CardContent>
        </Card>
      ))}

      <Dialog open={confirmDisconnect} onOpenChange={(open) => !saving && setConfirmDisconnect(open)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Disconnect Zomato?</DialogTitle>
            <DialogDescription>
              Zomato orders for {outletName ?? "this outlet"} will stop arriving on the POS and the saved credentials are removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)} disabled={saving}>
              Keep connected
            </Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={disconnect} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
