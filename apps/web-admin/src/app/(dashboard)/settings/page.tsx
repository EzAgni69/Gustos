"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Settings as SettingsIcon,
  Globe,
  Webhook,
  Bell,
  Receipt,
  Loader2,
  Save,
  ExternalLink,
  Shield,
  CreditCard,
  MessageSquare,
  Calculator,
  Plus,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/lib/toast";
import type { Organization, TaxRule } from "@gusto/api-contracts";

export default function SettingsPage() {
  const { toast } = useToast();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // General Settings state
  const [orgName, setOrgName] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");

  // Notification preferences
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [whatsappNotifications, setWhatsappNotifications] = useState(false);
  const [lowStockAlerts, setLowStockAlerts] = useState(true);
  const [dailySummary, setDailySummary] = useState(true);

  // Billing settings
  const [invoicePrefix, setInvoicePrefix] = useState("INV");
  const [defaultGstRate, setDefaultGstRate] = useState("5");
  const [autoInvoice, setAutoInvoice] = useState(true);

  // Tax rules
  const [taxRules, setTaxRules] = useState<TaxRule[]>([]);
  const [isTaxRuleModalOpen, setIsTaxRuleModalOpen] = useState(false);
  const [taxRuleName, setTaxRuleName] = useState("");
  const [taxRuleType, setTaxRuleType] = useState<"GST" | "VAT" | "SERVICE_CHARGE">("GST");
  const [taxRulePercentage, setTaxRulePercentage] = useState("");
  const [taxRuleIsSplit, setTaxRuleIsSplit] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    const userRes = await apiFetch<{ organizationId: string }>("/auth/me");
    if (userRes.success && userRes.data?.organizationId) {
      const orgId = userRes.data.organizationId;
      const orgRes = await apiFetch<Organization>(
        `/organizations/${orgId}`
      );
      if (orgRes.success && orgRes.data) {
        setOrg(orgRes.data);
        setOrgName(orgRes.data.name);
        setGstNumber(orgRes.data.gstNumber || "");
        setTimezone(orgRes.data.timezone || "Asia/Kolkata");
        setCurrency(orgRes.data.currency || "INR");
        if (orgRes.data.notificationSettings) {
          try {
            const ns = JSON.parse(orgRes.data.notificationSettings);
            if (ns.emailNotifications !== undefined) setEmailNotifications(ns.emailNotifications);
            if (ns.smsNotifications !== undefined) setSmsNotifications(ns.smsNotifications);
            if (ns.whatsappNotifications !== undefined) setWhatsappNotifications(ns.whatsappNotifications);
            if (ns.lowStockAlerts !== undefined) setLowStockAlerts(ns.lowStockAlerts);
            if (ns.dailySummary !== undefined) setDailySummary(ns.dailySummary);
          } catch {}
        }
        if (orgRes.data.billingSettings) {
          try {
            const bs = JSON.parse(orgRes.data.billingSettings);
            if (bs.invoicePrefix) setInvoicePrefix(bs.invoicePrefix);
            if (bs.defaultGstRate) setDefaultGstRate(bs.defaultGstRate);
            if (bs.autoInvoice !== undefined) setAutoInvoice(bs.autoInvoice);
          } catch {}
        }
        // Load tax rules
        const taxRulesRes = await apiFetch<TaxRule[]>(`/organizations/${orgId}/tax-rules`);
        if (taxRulesRes.success && taxRulesRes.data) {
          setTaxRules(taxRulesRes.data);
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveGeneral = async () => {
    if (!org) return;
    setSaving(true);
    const res = await apiFetch<Organization>(`/organizations/${org.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: orgName,
        gstNumber: gstNumber || null,
        timezone,
        currency,
      }),
    });
    if (res.success && res.data) {
      setOrg(res.data);
      toast({ title: "Settings saved", description: "Organization details updated successfully.", variant: "success" });
    } else {
      toast({ title: "Save failed", description: res.message || "Could not update settings.", variant: "error" });
    }
    setSaving(false);
  };

  const handleSaveNotifications = async () => {
    if (!org) return;
    setSaving(true);
    const res = await apiFetch<Organization>(`/organizations/${org.id}`, {
      method: "PUT",
      body: JSON.stringify({
        notificationSettings: JSON.stringify({
          emailNotifications,
          smsNotifications,
          whatsappNotifications,
          lowStockAlerts,
          dailySummary,
        }),
      }),
    });
    if (res.success && res.data) {
      setOrg(res.data);
      toast({ title: "Notifications updated", description: "Your notification preferences have been saved.", variant: "success" });
    } else {
      toast({ title: "Save failed", description: res.message || "Could not save notification settings.", variant: "error" });
    }
    setSaving(false);
  };

  const handleSaveBilling = async () => {
    if (!org) return;
    setSaving(true);
    const res = await apiFetch<Organization>(`/organizations/${org.id}`, {
      method: "PUT",
      body: JSON.stringify({
        billingSettings: JSON.stringify({
          invoicePrefix,
          defaultGstRate,
          autoInvoice,
        }),
      }),
    });
    if (res.success && res.data) {
      setOrg(res.data);
      toast({ title: "Billing settings saved", description: "Invoice and tax configuration updated.", variant: "success" });
    } else {
      toast({ title: "Save failed", description: res.message || "Could not save billing settings.", variant: "error" });
    }
    setSaving(false);
  };

  const handleAddTaxRule = async () => {
    if (!org || !taxRuleName || !taxRulePercentage) return;
    const res = await apiFetch<TaxRule>(`/organizations/${org.id}/tax-rules`, {
      method: "POST",
      body: JSON.stringify({
        name: taxRuleName,
        type: taxRuleType,
        percentage: parseFloat(taxRulePercentage),
        isCgstSgstSplit: taxRuleIsSplit,
        isActive: true,
      }),
    });
    if (res.success && res.data) {
      setTaxRules([...taxRules, res.data]);
      setIsTaxRuleModalOpen(false);
      setTaxRuleName("");
      setTaxRulePercentage("");
      setTaxRuleIsSplit(false);
      toast({ title: "Tax rule added", variant: "success" });
    } else {
      toast({ title: "Failed to add rule", description: res.message, variant: "error" });
    }
  };

  const handleDeleteTaxRule = async (ruleId: string) => {
    if (!org || !confirm("Delete this tax rule?")) return;
    const res = await apiFetch(`/organizations/${org.id}/tax-rules/${ruleId}`, {
      method: "DELETE",
    });
    if (res.success) {
      setTaxRules(taxRules.filter(r => r.id !== ruleId));
      toast({ title: "Tax rule deleted", variant: "success" });
    } else {
      toast({ title: "Delete failed", description: res.message, variant: "error" });
    }
  };

  const [activeTab, setActiveTab] = useState("general");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-gray-500 font-medium">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
        <p className="text-gray-500">
          Manage your organization, integrations, and system preferences.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="general" className="gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            General
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5">
            <Webhook className="w-3.5 h-3.5" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5">
            <Receipt className="w-3.5 h-3.5" />
            Billing & Tax
          </TabsTrigger>
          <TabsTrigger value="tax_rules" className="gap-1.5">
            <Calculator className="w-3.5 h-3.5" />
            Tax Engine Rules
          </TabsTrigger>
        </TabsList>

        {/* ─── General Tab ─── */}
        <TabsContent value="general">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">General Settings</CardTitle>
                  <CardDescription>
                    Organization branding and regional configuration.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input
                    id="orgName"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Gusto Global Group"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gstNumber">GST Number</Label>
                  <Input
                    id="gstNumber"
                    value={gstNumber}
                    onChange={(e) => setGstNumber(e.target.value)}
                    placeholder="e.g. 22AAAAA0000A1Z5"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <select
                    id="timezone"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="America/New_York">America/New_York (EST/EDT)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <select
                    id="currency"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    <option value="INR">₹ Indian Rupee (INR)</option>
                    <option value="USD">$ US Dollar (USD)</option>
                    <option value="AED">د.إ UAE Dirham (AED)</option>
                    <option value="GBP">£ British Pound (GBP)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100">
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleSaveGeneral}
                  disabled={saving}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Integrations Tab ─── */}
        <TabsContent value="integrations">
          <div className="space-y-4">
            {/* Zomato */}
            <Card className="shadow-xs border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-2xl">
                      🍽️
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Zomato</h3>
                      <p className="text-sm text-gray-500">
                        Receive orders from Zomato via webhook
                      </p>
                    </div>
                  </div>
                  <Badge variant="muted" className="text-xs">Not Connected</Badge>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="zomatoWebhook" className="text-xs font-medium text-gray-500">
                      Webhook URL
                    </Label>
                    <Input
                      id="zomatoWebhook"
                      placeholder="https://api.yourdomain.com/webhooks/zomato"
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zomatoApiKey" className="text-xs font-medium text-gray-500">
                      API Key
                    </Label>
                    <Input
                      id="zomatoApiKey"
                      type="password"
                      placeholder="Enter your Zomato API key"
                      disabled
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="outline" disabled>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Configure
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Swiggy */}
            <Card className="shadow-xs border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center text-2xl">
                      🛵
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Swiggy</h3>
                      <p className="text-sm text-gray-500">
                        Receive orders from Swiggy via webhook
                      </p>
                    </div>
                  </div>
                  <Badge variant="muted" className="text-xs">Not Connected</Badge>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="swiggyWebhook" className="text-xs font-medium text-gray-500">
                      Webhook URL
                    </Label>
                    <Input
                      id="swiggyWebhook"
                      placeholder="https://api.yourdomain.com/webhooks/swiggy"
                      disabled
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="outline" disabled>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Configure
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Razorpay */}
            <Card className="shadow-xs border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                      <CreditCard className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Razorpay</h3>
                      <p className="text-sm text-gray-500">
                        Accept online payments via Razorpay gateway
                      </p>
                    </div>
                  </div>
                  <Badge variant="muted" className="text-xs">Not Connected</Badge>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-500">Key ID</Label>
                    <Input placeholder="rzp_live_..." disabled />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-500">Key Secret</Label>
                    <Input type="password" placeholder="Enter secret key" disabled />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="outline" disabled>
                    <Shield className="w-4 h-4 mr-2" />
                    Connect Razorpay
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Tally */}
            <Card className="shadow-xs border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-2xl">
                      📊
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Tally Export</h3>
                      <p className="text-sm text-gray-500">
                        Export daily sales summaries in Tally-compatible XML
                      </p>
                    </div>
                  </div>
                  <Badge variant="muted" className="text-xs">Coming Soon</Badge>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="outline" disabled>
                    Configure
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Notifications Tab ─── */}
        <TabsContent value="notifications">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Notification Preferences</CardTitle>
                  <CardDescription>
                    Configure how you receive alerts and updates.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">Channels</h3>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-50">
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Email Notifications</p>
                      <p className="text-xs text-gray-500">
                        Receive daily reports and critical alerts via email
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={emailNotifications}
                    onCheckedChange={setEmailNotifications}
                  />
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-50">
                      <MessageSquare className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">SMS Notifications</p>
                      <p className="text-xs text-gray-500">
                        Get SMS alerts for urgent events (low stock, system downtime)
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={smsNotifications}
                    onCheckedChange={setSmsNotifications}
                  />
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50">
                      <MessageSquare className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">WhatsApp Notifications</p>
                      <p className="text-xs text-gray-500">
                        Customer feedback requests and promotional campaigns
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={whatsappNotifications}
                    onCheckedChange={setWhatsappNotifications}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">Alert Types</h3>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Low Stock Alerts</p>
                    <p className="text-xs text-gray-500">
                      Notify when inventory drops below minimum threshold
                    </p>
                  </div>
                  <Switch
                    checked={lowStockAlerts}
                    onCheckedChange={setLowStockAlerts}
                  />
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Daily Summary Email</p>
                    <p className="text-xs text-gray-500">
                      End-of-day sales and operations summary
                    </p>
                  </div>
                  <Switch
                    checked={dailySummary}
                    onCheckedChange={setDailySummary}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100">
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleSaveNotifications}
                  disabled={saving}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Billing Tab ─── */}
        <TabsContent value="billing">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Billing & Tax Configuration</CardTitle>
                  <CardDescription>
                    Invoice numbering, GST defaults, and tax rules.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="invoicePrefix">Invoice Prefix</Label>
                  <Input
                    id="invoicePrefix"
                    value={invoicePrefix}
                    onChange={(e) => setInvoicePrefix(e.target.value)}
                    placeholder="e.g. INV, GST"
                  />
                  <p className="text-xs text-gray-400">
                    Invoices will be numbered as: {invoicePrefix}-20260729-001
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultGst">Default GST Rate</Label>
                  <select
                    id="defaultGst"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={defaultGstRate}
                    onChange={(e) => setDefaultGstRate(e.target.value)}
                  >
                    <option value="0">0% — Exempt</option>
                    <option value="5">5% — Restaurant (Non-AC)</option>
                    <option value="12">12% — Restaurant (AC)</option>
                    <option value="18">18% — Food delivery / Catering</option>
                    <option value="28">28% — Luxury / 5-Star</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-y border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">Auto-generate Invoice</p>
                  <p className="text-xs text-gray-500">
                    Automatically create an invoice when an order is marked as completed
                  </p>
                </div>
                <Switch
                  checked={autoInvoice}
                  onCheckedChange={setAutoInvoice}
                />
              </div>

              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">GST Compliance</p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      All invoices include split CGST + SGST as per Indian GST regulations.
                      Ensure your GSTIN is configured in the General tab for valid tax invoices.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100">
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleSaveBilling}
                  disabled={saving}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {/* ─── Tax Rules Tab ─── */}
        <TabsContent value="tax_rules">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Tax &amp; Compliance Engine</CardTitle>
                  <CardDescription>
                    Configure advanced multi-tier tax splitting (CGST/SGST, VAT, service charges by zone).
                  </CardDescription>
                </div>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setIsTaxRuleModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Tax Rule
              </Button>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {/* Add Tax Rule Dialog */}
              <Dialog open={isTaxRuleModalOpen} onOpenChange={setIsTaxRuleModalOpen}>
                <DialogContent className="sm:max-w-[400px]">
                  <DialogHeader>
                    <DialogTitle>Add Tax Rule</DialogTitle>
                    <DialogDescription>Configure a new tax or charge rule for your organization.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <Label>Rule Name</Label>
                      <Input value={taxRuleName} onChange={e => setTaxRuleName(e.target.value)} placeholder="e.g. GST 5% Dine-in" />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <select
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={taxRuleType}
                        onChange={e => setTaxRuleType(e.target.value as "GST" | "VAT" | "SERVICE_CHARGE")}
                      >
                        <option value="GST">GST</option>
                        <option value="VAT">VAT</option>
                        <option value="SERVICE_CHARGE">Service Charge</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Percentage (%)</Label>
                      <Input type="number" min="0" max="100" step="0.01" value={taxRulePercentage} onChange={e => setTaxRulePercentage(e.target.value)} placeholder="e.g. 18" />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch checked={taxRuleIsSplit} onCheckedChange={setTaxRuleIsSplit} />
                      <Label className="font-normal cursor-pointer">Split equally as CGST + SGST</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsTaxRuleModalOpen(false)}>Cancel</Button>
                    <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleAddTaxRule}>Add Rule</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="space-y-4">
                {taxRules.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">No tax rules configured. Add one above.</p>
                )}
                {taxRules.map(rule => (
                  <div key={rule.id} className="p-4 border border-gray-100 rounded-lg flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900">{rule.name}</h4>
                      <p className="text-sm text-gray-500">{rule.percentage}% {rule.type}{rule.isCgstSgstSplit ? " (CGST+SGST split)" : ""}</p>
                      {rule.zone && <p className="text-xs text-gray-400 mt-1">Zone: {rule.zone}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={rule.isActive ? "default" : "muted"} className={rule.isActive ? "bg-green-100 text-green-700" : ""}>
                        {rule.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" onClick={() => handleDeleteTaxRule(rule.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
