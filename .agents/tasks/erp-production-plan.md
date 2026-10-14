# ERP Production-Readiness Implementation Plan

## Codebase Context

- **ERP app**: `apps/web-admin` — Next.js 15, `useEffect + useState + apiFetch()` pattern
- **API gateway**: `apps/api-gateway` — Fastify + Drizzle ORM, routes in `src/routes/`
- **Contracts**: `packages/api-contracts/src/index.ts` — all Zod schemas and TypeScript types
- **DB schema**: `packages/db-schema/src/cloud/index.ts` — Drizzle schema (Postgres)
- **Build command**: `cd /Users/agni/Developer/Gustos && npx turbo build --filter=web-admin --filter=api-gateway`
- **No Prisma** — the project uses Drizzle ORM; `db-schema` package has `pgTable` definitions
- Error pattern used by pages that already have it: `const [error, setError] = useState(""); … setError(res.message || "…"); … {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 …">⚠️ {error}</div>}`
- `apiFetch()` returns `{ success: boolean, data?, message? }` — failures have `success: false`

---

## Priority 1 — Remove Mock Fallback Data

### Item 1 — Staff page: remove mock fallback, add error state

**What**: In `loadData()`, the `else` branch after `if (staffRes.success && staffRes.data)` sets a fake staff member. Replace it with `setError(staffRes.message || "Failed to load staff")`. Add `const [error, setError] = useState("")` at the top of state declarations. Add an inline error banner between the page header and the Tabs component, conditionally rendered when `error` is non-empty. Clear `error` at the start of `loadData()` with `setError("")`.

**File**: `apps/web-admin/src/app/(dashboard)/staff/page.tsx`

Remove lines 85–98 (the `else` block after the staff API check):
```typescript
    } else {
      // Mock fallback data for visual demo if server is offline
      setStaff([
        {
          id: "1",
          organizationId: "org-1",
          name: "Ravi Kumar",
          email: "ravi.kumar@gusto.com",
          role: "MANAGER",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }
```

Replace with:
```typescript
    } else {
      setError(staffRes.message || "Failed to load staff members. Please check your connection.");
    }
```

Add to state declarations (after `const [loading, setLoading] = useState(true);`):
```typescript
  const [error, setError] = useState("");
```

Add `setError("")` at the top of `loadData()`.

Add error banner just before `<Tabs defaultValue="staff"`:
```tsx
{error && (
  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
  </div>
)}
```

**Verify**: `cd /Users/agni/Developer/Gustos && npx turbo build --filter=web-admin` — build succeeds with no type errors.

---

### Item 2 — Menu page: remove mock fallback, add error state

**What**: In `loadData()`, the outer `else` branch (triggered when outlets API fails) silently populates `menuItems` with a fake pizza. Replace this with `setError(outletsRes.message || "Failed to load outlets")`. The inner success path already handles empty results gracefully. Add `error` state and an error banner above the Card.

**File**: `apps/web-admin/src/app/(dashboard)/menu/page.tsx`

Remove the `else` block at the end of `loadData()`:
```typescript
    } else {
      // Mock fallback data for visual demo if server is offline
      setMenuItems([
        {
          id: "1",
          categoryId: "cat-1",
          outletId: "out-1",
          name: "Margherita Pizza",
          description: "Classic tomato sauce, fresh mozzarella, and basil",
          price: 399.0,
          gstRate: "5",
          isVeg: true,
          isAvailable: true,
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      ]);
    }
```

Replace with:
```typescript
    } else {
      setError(outletsRes.message || "Failed to load outlets. Ensure the API server is running.");
    }
```

Add `const [error, setError] = useState("");` after `const [loading, setLoading] = useState(true);`.

Add `setError("")` at the top of `loadData()`.

Add error banner between the top action bar and the Card:
```tsx
{error && (
  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
  </div>
)}
```

**Verify**: `cd /Users/agni/Developer/Gustos && npx turbo build --filter=web-admin` — no type errors.

---

### Item 3 — Customers page: remove BOTH mock fallbacks

**What**: Two fallbacks to remove:
1. **Load fallback** (line ~87): when `GET /customers` fails, a fake customer is shown. Replace with `setError(res.message || "Failed to load customers")`.
2. **Create fallback** (line ~169): when `POST /customers` fails, a fake local customer is silently appended. Remove this entire fake-creation block; keep only the toast error.

**File**: `apps/web-admin/src/app/(dashboard)/customers/page.tsx`

**Fallback 1** — Remove from `loadCustomers()`:
```typescript
    } else {
      // Mock fallback data
      setCustomers([
        {
          id: "1",
          organizationId: "org-1",
          name: "Rahul Verma",
          phone: "+91 98765 12345",
          email: "rahul.verma@email.com",
          notes: "Regular customer — prefers window seating",
          loyaltyPoints: 1250,
          totalVisits: 14,
          totalSpend: 12450.0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    }
```

Replace with:
```typescript
    } else {
      setError(res.message || "Failed to load customers. Please check your connection.");
    }
```

**Fallback 2** — In `handleSaveCustomer()`, remove the entire mock-create `else` block:
```typescript
      } else {
        // Mock fallback
        const newCustomer: Customer = {
          id: `cust-${Date.now()}`,
          organizationId: "org-1",
          name: data.name,
          phone: data.phone,
          email: data.email,
          notes: data.notes,
          loyaltyPoints: 0,
          totalVisits: 0,
          totalSpend: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        setCustomers([newCustomer, ...customers]);
        setIsModalOpen(false);
      }
```

Replace with:
```typescript
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create customer", variant: "error" });
      }
```

Add `const [error, setError] = useState("");` after `const [loading, setLoading] = useState(true);`.

Add `setError("")` at the top of `loadCustomers()`.

Add error banner between the stats cards section and the Customer Table card:
```tsx
{error && (
  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
  </div>
)}
```

**Verify**: Build succeeds.

---

### Item 4 — Outlets page: remove mock fallback

**What**: The page already has `const [error, setError] = useState("")` and calls `setError(outletsRes.message || "Failed to load outlets")`. However it then ALSO populates `setOutlets([...fake...])` in the same else block, which defeats the error state. Remove the `setOutlets([...])` mock assignment. The error is already displayed implicitly via empty state + table empty row. Add an explicit error banner.

**File**: `apps/web-admin/src/app/(dashboard)/outlets/page.tsx`

Remove from the `else` block in `loadData()`:
```typescript
      // Mock fallback data for visual demo if server is offline
      setOutlets([
        {
          id: "1",
          organizationId: "org-1",
          franchiseId: "fran-1",
          name: "Downtown Gusto",
          address: "123 Main St, City Center",
          phone: "+91 9876543210",
          gstNumber: "22AAAAA0000A1Z5",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
```

The `else` block should then be just:
```typescript
    } else {
      setError(outletsRes.message || "Failed to load outlets");
    }
```

Add an error banner in `TabsContent value="outlets"` just before the Card, after the loading check:
```tsx
{error && (
  <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
  </div>
)}
```

**Verify**: Build succeeds.

---

### Item 5 — Organizations page: remove mock fallback, add error state

**What**: In `loadOrganizations()`, the `else` branch (when `GET /auth/me` fails) shows a hardcoded fake organization. Replace with `setError(...)`. The `catch` block also silently swallows errors.

**File**: `apps/web-admin/src/app/(dashboard)/organizations/page.tsx`

Add `const [error, setError] = useState("");` after `const [loading, setLoading] = useState(true);`.

In `loadOrganizations()`, replace:
```typescript
      } else {
        // Fallback for visual demo if server is offline
        setOrganizations([
          {
            id: "1",
            name: "Gusto Global Group",
            slug: "gusto-global",
            gstNumber: "22AAAAA0000A1Z5",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
      }
```

with:
```typescript
      } else {
        setError(userRes.message || "Failed to load organization. Please check your connection.");
      }
```

Also update the `catch` block to:
```typescript
    } catch (error) {
      console.error("Failed to load organization", error);
      setError("An unexpected error occurred while loading organization data.");
    }
```

Add `setError("")` at the top of `loadOrganizations()`.

Add error banner between the page header and the Card:
```tsx
{error && (
  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
  </div>
)}
```

**Verify**: Build succeeds.

---

### Item 6 — Tables page: remove generateMockTables() entirely, remove all invocations, remove fake-ID fallback on POST

**What**: Three changes:
1. Delete the entire `generateMockTables()` function (lines ~65–84).
2. Replace both call sites in `loadData()` with `setError(...)` + `setTables([])`.
3. In `handleSaveTable()`, remove the mock fallback on POST failure; show toast error only.

**File**: `apps/web-admin/src/app/(dashboard)/tables/page.tsx`

**Step A** — Delete the `generateMockTables` function entirely:
```typescript
// ─── Mock Data ───

function generateMockTables(): DiningTable[] {
  const sections = ["Main Hall", "Terrace", "Private"];
  const statuses: TableStatus[] = [
    "AVAILABLE",
    "OCCUPIED",
    "AVAILABLE",
    "RESERVED",
    "OCCUPIED",
    "AVAILABLE",
    "CLEANING",
    "AVAILABLE",
    "OCCUPIED",
    "AVAILABLE",
    "RESERVED",
    "AVAILABLE",
  ];

  return Array.from({ length: 12 }, (_, i) => ({
    id: `table-${i + 1}`,
    outletId: "outlet-1",
    name: `T${i + 1}`,
    capacity: [2, 4, 4, 6, 2, 4, 8, 2, 4, 6, 4, 2][i]!,
    status: statuses[i]!,
    section: sections[Math.floor(i / 4)]!,
    sortOrder: i,
  }));
}
```

**Step B** — Add `const [error, setError] = useState("");` after `const [loading, setLoading] = useState(true);`.

**Step C** — In `loadData()`, replace:
```typescript
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      if (outletsRes.data[0]) {
        initialOutletId = outletsRes.data[0].id;
        setCurrentOutletId(initialOutletId);
        form.setValue("outletId", initialOutletId);
      }

      const tablesRes = await apiFetch<DiningTable[]>(
        `/tables?outletId=${initialOutletId}`
      );
      if (tablesRes.success && tablesRes.data) {
        setTables(tablesRes.data);
      } else {
        setTables(generateMockTables());
      }
    } else {
      setTables(generateMockTables());
    }
```

with:
```typescript
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      if (outletsRes.data[0]) {
        initialOutletId = outletsRes.data[0].id;
        setCurrentOutletId(initialOutletId);
        form.setValue("outletId", initialOutletId);
      }

      const tablesRes = await apiFetch<DiningTable[]>(
        `/tables?outletId=${initialOutletId}`
      );
      if (tablesRes.success && tablesRes.data) {
        setTables(tablesRes.data);
      } else {
        setError(tablesRes.message || "Failed to load tables.");
        setTables([]);
      }
    } else {
      setError(outletsRes.message || "Failed to load outlets. Cannot display floor plan.");
      setTables([]);
    }
```

**Step D** — In `handleSaveTable()`, remove the mock fallback on POST failure:
```typescript
      } else {
        // Mock fallback
        const newTable: DiningTable = {
          id: `table-${Date.now()}`,
          outletId: data.outletId,
          name: data.name,
          capacity: data.capacity,
          status: "AVAILABLE",
          section: data.section || undefined,
          sortOrder: data.sortOrder ?? tables.length,
        };
        setTables([...tables, newTable]);
        setIsModalOpen(false);
      }
```

Replace with:
```typescript
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create table", variant: "error" });
      }
```

Add error banner above the Status Legend section:
```tsx
{error && (
  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
  </div>
)}
```

Also add `setError("")` at the top of `loadData()`.

**Verify**: Build succeeds. The `generateMockTables` symbol must not appear anywhere in the file.

---

## Priority 2 — Wire Settings Tabs to Real API

### Item 7 — Extend Organization type and API: add timezone, currency, notificationSettings, billingSettings fields

**Decision**: Rather than a separate settings table, extend the `organizations` table in the Drizzle schema with nullable JSON/varchar columns. This avoids an extra DB migration table and keeps settings co-located with the org record. The `updateOrganizationSchema` in api-contracts is extended accordingly.

**Sub-item A: Drizzle schema** — Add columns to `organizations` table.

**File**: `packages/db-schema/src/cloud/index.ts`

In the `organizations` pgTable definition, after `gstNumber`, add:
```typescript
  timezone: varchar("timezone", { length: 100 }).default("Asia/Kolkata"),
  currency: varchar("currency", { length: 10 }).default("INR"),
  notificationSettings: text("notification_settings"), // JSON string
  billingSettings: text("billing_settings"), // JSON string
```

**Sub-item B: API contracts** — Extend `organizationSchema` and `updateOrganizationSchema`.

**File**: `packages/api-contracts/src/index.ts`

Update `organizationSchema`:
```typescript
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  gstNumber: z.string().optional(),
  timezone: z.string().default("Asia/Kolkata"),
  currency: z.string().default("INR"),
  notificationSettings: z.string().optional().nullable(), // JSON
  billingSettings: z.string().optional().nullable(),       // JSON
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
```

Update `updateOrganizationSchema`:
```typescript
export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  gstNumber: z.string().max(20).optional().nullable(),
  timezone: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
  notificationSettings: z.string().optional().nullable(),
  billingSettings: z.string().optional().nullable(),
});
```

**Sub-item C: DB migration** — Generate and run the migration. Because this project uses Drizzle, generate the migration using:
```bash
cd /Users/agni/Developer/Gustos && npx drizzle-kit generate --config packages/db-schema/drizzle.config.cloud.ts
```
Then apply:
```bash
npx drizzle-kit migrate --config packages/db-schema/drizzle.config.cloud.ts
```

**Verify**: Build succeeds. The new columns appear in the generated migration SQL.

---

### Item 8 — Wire Settings General tab: save timezone and currency

**What**: `handleSaveGeneral()` currently only saves `name` and `gstNumber`. Extend the PUT body to include `timezone` and `currency`. Load these from the org response and populate the selects.

**File**: `apps/web-admin/src/app/(dashboard)/settings/page.tsx`

In `loadSettings()`, after `setGstNumber(orgRes.data.gstNumber || "")`, add:
```typescript
        setTimezone(orgRes.data.timezone || "Asia/Kolkata");
        setCurrency(orgRes.data.currency || "INR");
```

In `handleSaveGeneral()`, extend the PUT body:
```typescript
    const res = await apiFetch<Organization>(`/organizations/${org.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: orgName,
        gstNumber: gstNumber || null,
        timezone,
        currency,
      }),
    });
```

**Verify**: Build succeeds. Changing timezone in the UI and clicking Save no longer silently drops the value.

---

### Item 9 — Wire Settings Notifications tab to real API

**What**: Replace the `handleSaveNotifications()` stub (which only shows a toast) with a real PUT call to `/organizations/:id`. Serialize the notification toggles as a JSON string and store in `notificationSettings`.

**File**: `apps/web-admin/src/app/(dashboard)/settings/page.tsx`

Load notification settings in `loadSettings()`, after setting `setGstNumber`:
```typescript
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
```

Replace `handleSaveNotifications()`:
```typescript
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
```

Add `disabled={saving}` to the Save Preferences button in the Notifications tab.

**Verify**: Build succeeds.

---

### Item 10 — Wire Settings Billing tab to real API

**What**: `handleSaveBilling()` only shows a toast. Wire it to PUT `/organizations/:id` storing the billing config as a JSON string in `billingSettings`.

**File**: `apps/web-admin/src/app/(dashboard)/settings/page.tsx`

Load billing settings in `loadSettings()`:
```typescript
        if (orgRes.data.billingSettings) {
          try {
            const bs = JSON.parse(orgRes.data.billingSettings);
            if (bs.invoicePrefix) setInvoicePrefix(bs.invoicePrefix);
            if (bs.defaultGstRate) setDefaultGstRate(bs.defaultGstRate);
            if (bs.autoInvoice !== undefined) setAutoInvoice(bs.autoInvoice);
          } catch {}
        }
```

Replace `handleSaveBilling()`:
```typescript
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
```

Add `disabled={saving}` to the Save Configuration button.

**Verify**: Build succeeds.

---

### Item 11 — Add Tax Rules API endpoints

**What**: Create `POST /organizations/:id/tax-rules` (create a rule) and `DELETE /organizations/:id/tax-rules/:ruleId`. The `tax_rules` table already exists in the Drizzle schema. Add the routes to `organization.routes.ts`. Add create/delete schema to api-contracts.

**File**: `packages/api-contracts/src/index.ts`

Add after the existing `taxRuleSchema`:
```typescript
export const createTaxRuleSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["GST", "VAT", "SERVICE_CHARGE"]),
  percentage: z.number().min(0).max(100),
  isCgstSgstSplit: z.boolean().default(false),
  zone: z.string().max(100).optional(),
  isActive: z.boolean().default(true),
});

export type CreateTaxRule = z.infer<typeof createTaxRuleSchema>;
```

**File**: `apps/api-gateway/src/routes/organization.routes.ts`

Add imports:
```typescript
import { updateOrganizationSchema, createTaxRuleSchema } from "@gusto/api-contracts";
import * as cloudSchema from "@gusto/db-schema/cloud";
```
(Already imported; add `createTaxRuleSchema` to the import.)

Add two new routes at the end of `organizationRoutes()`, before the closing brace:

```typescript
  // ─── List Tax Rules ───
  fastify.get("/api/v1/organizations/:id/tax-rules", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = getOrganizationId(request);
    const targetId = id === "me" ? orgId : id;
    if (targetId !== orgId) return reply.status(403).send(error("Access denied"));

    const rules = await db.query.taxRules.findMany({
      where: eq(cloudSchema.taxRules.organizationId, orgId),
      orderBy: (r, { asc }) => [asc(r.createdAt)],
    });
    return reply.send(success(rules));
  });

  // ─── Create Tax Rule ───
  fastify.post(
    "/api/v1/organizations/:id/tax-rules",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const targetId = id === "me" ? orgId : id;
      if (targetId !== orgId) return reply.status(403).send(error("Access denied"));

      const body = createTaxRuleSchema.parse(request.body);
      const results = await db
        .insert(cloudSchema.taxRules)
        .values({ organizationId: orgId, ...body })
        .returning();
      return reply.status(201).send(success(results[0], "Tax rule created"));
    }
  );

  // ─── Delete Tax Rule ───
  fastify.delete(
    "/api/v1/organizations/:id/tax-rules/:ruleId",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id, ruleId } = request.params as { id: string; ruleId: string };
      const orgId = getOrganizationId(request);
      const targetId = id === "me" ? orgId : id;
      if (targetId !== orgId) return reply.status(403).send(error("Access denied"));

      const results = await db
        .delete(cloudSchema.taxRules)
        .where(
          and(
            eq(cloudSchema.taxRules.id, ruleId),
            eq(cloudSchema.taxRules.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) return reply.status(404).send(error("Tax rule not found"));
      return reply.send(success(null, "Tax rule deleted"));
    }
  );
```

Add missing import `and` to the drizzle import line in organization.routes.ts (it currently only imports `eq`):
```typescript
import { eq, and } from "drizzle-orm";
```

**Verify**: `cd /Users/agni/Developer/Gustos && npx turbo build --filter=api-gateway` — no type errors.

---

### Item 12 — Wire Settings Tax Rules tab to real API

**What**: Replace the two hardcoded static rules with live data from `GET /organizations/:id/tax-rules`. Wire the "Add Tax Rule" button to a dialog that calls `POST /organizations/:id/tax-rules`. Add delete buttons wired to `DELETE /organizations/:id/tax-rules/:ruleId`.

**File**: `apps/web-admin/src/app/(dashboard)/settings/page.tsx`

Add imports:
```typescript
import { Trash2 } from "lucide-react";
import type { TaxRule, CreateTaxRule } from "@gusto/api-contracts";
```

Add state variables:
```typescript
  const [taxRules, setTaxRules] = useState<TaxRule[]>([]);
  const [isTaxRuleModalOpen, setIsTaxRuleModalOpen] = useState(false);
  const [taxRuleName, setTaxRuleName] = useState("");
  const [taxRuleType, setTaxRuleType] = useState<"GST" | "VAT" | "SERVICE_CHARGE">("GST");
  const [taxRulePercentage, setTaxRulePercentage] = useState("");
  const [taxRuleIsSplit, setTaxRuleIsSplit] = useState(false);
```

In `loadSettings()`, after loading org data, add:
```typescript
        // Load tax rules
        const taxRulesRes = await apiFetch<TaxRule[]>(
          `/organizations/${userRes.data.organizationId}/tax-rules`
        );
        if (taxRulesRes.success && taxRulesRes.data) {
          setTaxRules(taxRulesRes.data);
        }
```

Add handler functions:
```typescript
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
```

Replace the static `TabsContent value="tax_rules"` card body with a live-rendered list from `taxRules` state. The "Add Tax Rule" button should open `isTaxRuleModalOpen`. Each rule row should have a delete `<Button variant="ghost" size="icon">` calling `handleDeleteTaxRule(rule.id)`. Add a `<Dialog>` for the add-rule form.

Complete replacement for the tax rules card content area (inside `<CardContent className="pt-6 space-y-6">`):
```tsx
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
          onChange={e => setTaxRuleType(e.target.value as any)}
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
```

Also move the "Add Tax Rule" button to `onClick={() => setIsTaxRuleModalOpen(true)}` in the CardHeader.

Add the required `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` imports from `@/components/ui/dialog` — these are likely already imported for other uses or need to be added.

**Verify**: Build succeeds.

---

## Priority 3 — Connect Reports Page to Real Reporting Endpoints

### Item 13 — Replace client-side aggregation with real reporting API calls

**Decision**: The current reports page fetches all raw orders per outlet and aggregates client-side. Replace the data loading layer entirely. The real endpoints are:
- `GET /reports/sales?outletId=&startDate=&endDate=&groupBy=day` → `{ summary, breakdown[] }`
- `GET /reports/dashboard?outletId=` → `{ today, alerts, staff }`
- `GET /reports/inventory?lowStockOnly=false` → `{ summary, items[] }`
- `GET /reports/profitability?outletId=&startDate=&endDate=` → `{ revenue, costs, topSellingItems[] }`

The page keeps its date range filter UI and outlet filter. KPI cards, revenue trend chart, top items chart, and outlet breakdown come from the sales + profitability endpoints. Add a new "Profitability" tab alongside the existing content. The existing CSV export functions (GSTR-1 and general) can be retained for the currently loaded orders data but source from the sales report breakdown.

**File**: `apps/web-admin/src/app/(dashboard)/reports/page.tsx`

**Replace the entire `loadData` function and top-level state** with the following approach:

Remove:
```typescript
  const [orders, setOrders] = useState<Order[]>([]);
```

Replace with:
```typescript
  const [salesReport, setSalesReport] = useState<{
    summary: { totalOrders: number; totalRevenue: number; totalTax: number; totalDiscount: number; avgOrderValue: number; totalItemsSold: number };
    breakdown: { period: string; orderCount: number; totalRevenue: number; totalTax: number; totalDiscount: number; avgOrderValue: number; itemsSold: number }[];
  } | null>(null);
  const [profitReport, setProfitReport] = useState<{
    revenue: { totalRevenue: number; totalTax: number; totalDiscounts: number; netRevenueBeforeTax: number; orderCount: number; avgOrderValue: number };
    costs: { labourCost: number; commissions: number };
    online: { orderCount: number; revenue: number; commissions: number };
    topSellingItems: { name: string; quantity: number; revenue: number }[];
  } | null>(null);
  const [inventoryReport, setInventoryReport] = useState<{
    summary: { totalItems: number; lowStockItems: number; totalInventoryValue: number };
    items: { id: string; name: string; unit: string; currentStock: number; minimumStock: number; costPerUnit: number; totalValue: number; isLowStock: boolean; stockPercentage: number }[];
  } | null>(null);
  const [activeReportTab, setActiveReportTab] = useState<"overview" | "profitability" | "inventory">("overview");
```

Replace `loadData()`:
```typescript
  const loadData = async () => {
    setLoading(true);

    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);
    }

    await loadReports();
    setLoading(false);
  };

  const loadReports = async () => {
    const outletId = selectedOutletId === "all" ? outlets[0]?.id : selectedOutletId;
    if (!outletId) return;

    const rangeStart = getDateRangeStart(dateRange);
    const startDate = rangeStart.toISOString().split("T")[0]!;
    const endDate = new Date().toISOString().split("T")[0]!;

    const [salesRes, profitRes, inventoryRes] = await Promise.all([
      apiFetch<typeof salesReport>(`/reports/sales?outletId=${outletId}&startDate=${startDate}&endDate=${endDate}&groupBy=day`),
      apiFetch<typeof profitReport>(`/reports/profitability?outletId=${outletId}&startDate=${startDate}&endDate=${endDate}`),
      apiFetch<typeof inventoryReport>(`/reports/inventory`),
    ]);

    if (salesRes.success && salesRes.data) setSalesReport(salesRes.data);
    if (profitRes.success && profitRes.data) setProfitReport(profitRes.data);
    if (inventoryRes.success && inventoryRes.data) setInventoryReport(inventoryRes.data);
  };
```

Add a `useEffect` that re-fetches when `dateRange` or `selectedOutletId` changes:
```typescript
  useEffect(() => {
    if (outlets.length > 0) {
      loadReports();
    }
  }, [dateRange, selectedOutletId, outlets]);
```

**Update KPI cards** to use `salesReport.summary` instead of the old computed values:
- `totalRevenue` → `salesReport?.summary.totalRevenue ?? 0`
- `totalOrders` → `salesReport?.summary.totalOrders ?? 0`
- `avgOrderValue` → `salesReport?.summary.avgOrderValue ?? 0`

**Update Revenue Trend chart** to use `salesReport.breakdown` instead of `revenueByDay`:
- `revenueByDay` is now `(salesReport?.breakdown ?? []).map(b => ({ day: b.period, value: b.totalRevenue }))`

**Update Top Items** to use `profitReport?.topSellingItems ?? []` instead of computed `topItems`.

**Add Profitability tab** — after the existing charts grid, add a new `<Tabs>` sub-section (or use a separate toggle) showing:
- Revenue vs. costs summary cards from `profitReport.revenue` and `profitReport.costs`
- Online orders (Zomato/Swiggy) commission card from `profitReport.online`
- Estimated margin = `(totalRevenue - labourCost - commissions) / totalRevenue * 100`

**Add Inventory summary section** — below the profitability section:
- Low stock count badge from `inventoryReport.summary.lowStockItems`
- Total inventory value from `inventoryReport.summary.totalInventoryValue`
- Low-stock items table (items where `isLowStock === true`)

Remove all the computed `useMemo` blocks that worked on the old `orders` array (`completedOrders`, `revenueByDay`, `topItems`, `revenueByOutlet`, `statusBreakdown`, `paymentDistribution`, `peakHours`) — these are now replaced by server-side data. Keep only the `filteredOrders`-based export functions, but source them from `salesReport.breakdown` for the GSTR-1 export (note: the breakdown doesn't have per-invoice data, so the per-invoice GSTR-1 rows will no longer be available from the API endpoint alone; simplify the export to use the summary totals only, or remove the per-order rows and show only the summary rows).

Remove the `Order` and `OrderStatus` type imports (no longer needed).

**Verify**: `cd /Users/agni/Developer/Gustos && npx turbo build --filter=web-admin` — no type errors.

---

## Priority 4 — Add Missing HR Module Pages

### Item 14 — Create HR Shifts page

**What**: New page at `apps/web-admin/src/app/(dashboard)/hr/page.tsx`. Fetches `GET /hr/shifts?outletId=` (requires selecting an outlet first) and `POST /hr/shifts`. Uses the same `useEffect + useState + apiFetch + Card/Table/Dialog` pattern.

**File to create**: `apps/web-admin/src/app/(dashboard)/hr/page.tsx`

```tsx
"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import {
  type Shift,
  type Outlet,
  type CreateShift,
  createShiftSchema,
} from "@gusto/api-contracts";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Clock, Plus, Loader2, MoreHorizontal, Edit, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";

export default function HRShiftsPage() {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const form = useForm<CreateShift & { isActive?: boolean }>({
    resolver: zodResolver(createShiftSchema) as any,
    defaultValues: { outletId: "", name: "", startTime: "09:00", endTime: "17:00", isActive: true },
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      const outletId = outletsRes.data[0]!.id;
      setCurrentOutletId(outletId);
      form.setValue("outletId", outletId);
      const shiftsRes = await apiFetch<Shift[]>(`/hr/shifts?outletId=${outletId}`);
      if (shiftsRes.success && shiftsRes.data) {
        setShifts(shiftsRes.data);
      } else {
        setError(shiftsRes.message || "Failed to load shifts.");
      }
    } else {
      setError(outletsRes.message || "Failed to load outlets.");
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const openCreateModal = () => {
    setEditingShift(null);
    form.reset({ outletId: currentOutletId, name: "", startTime: "09:00", endTime: "17:00", isActive: true });
    setIsModalOpen(true);
  };

  const openEditModal = (shift: Shift) => {
    setEditingShift(shift);
    form.reset({ outletId: shift.outletId, name: shift.name, startTime: shift.startTime, endTime: shift.endTime, isActive: shift.isActive });
    setIsModalOpen(true);
  };

  const handleSaveShift = async (data: any) => {
    setIsSubmitting(true);
    if (editingShift) {
      const res = await apiFetch<Shift>(`/hr/shifts/${editingShift.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: data.name, startTime: data.startTime, endTime: data.endTime, isActive: data.isActive }),
      });
      if (res.success && res.data) {
        setShifts(shifts.map(s => s.id === editingShift.id ? res.data! : s));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message, variant: "error" });
      }
    } else {
      const res = await apiFetch<Shift>("/hr/shifts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (res.success && res.data) {
        setShifts([...shifts, res.data]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message, variant: "error" });
      }
    }
    setIsSubmitting(false);
  };

  const handleDeleteShift = async (id: string) => {
    if (!confirm("Delete this shift?")) return;
    const res = await apiFetch(`/hr/shifts/${id}`, { method: "DELETE" });
    if (res.success) {
      setShifts(shifts.filter(s => s.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message, variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">HR — Shifts</h1>
          <p className="text-gray-500">Manage work shifts and schedules for your outlets.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/hr/attendance">
            <Button variant="outline" className="bg-white">Attendance</Button>
          </Link>
          <Link href="/hr/payroll">
            <Button variant="outline" className="bg-white">Payroll</Button>
          </Link>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />Add Shift
            </Button>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={form.handleSubmit(handleSaveShift)}>
                <DialogHeader>
                  <DialogTitle>{editingShift ? "Edit Shift" : "Add Shift"}</DialogTitle>
                  <DialogDescription>{editingShift ? "Update this shift." : "Create a new work shift."}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  {!editingShift && (
                    <div className="space-y-2">
                      <Label>Outlet</Label>
                      <select className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register("outletId")}>
                        {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Shift Name</Label>
                    <Input placeholder="e.g. Morning Shift" {...form.register("name")} />
                    {form.formState.errors.name && <p className="text-red-500 text-xs">{form.formState.errors.name.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input type="time" {...form.register("startTime")} />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input type="time" {...form.register("endTime")} />
                    </div>
                  </div>
                  {editingShift && (
                    <div className="flex items-center space-x-2 pt-2">
                      <Switch checked={form.watch("isActive")} onCheckedChange={v => form.setValue("isActive", v)} />
                      <Label className="font-normal cursor-pointer">Shift is active</Label>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingShift ? "Save Changes" : "Save Shift"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span><span>{error}</span>
        </div>
      )}

      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Work Shifts</CardTitle>
              <CardDescription>All configured shifts for your outlets.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading shifts...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Shift Name</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map(shift => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium text-gray-900">{shift.name}</TableCell>
                    <TableCell className="text-gray-500 font-mono">{shift.startTime}</TableCell>
                    <TableCell className="text-gray-500 font-mono">{shift.endTime}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${shift.isActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"}`}>
                        {shift.isActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditModal(shift)}>
                            <Edit className="w-4 h-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteShift(shift.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {shifts.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500 py-8">No shifts configured. Add one to get started.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify**: Build succeeds.

---

### Item 15 — Create HR Attendance page

**What**: New page calling `GET /hr/attendance?outletId=` (paginated) and `POST /hr/attendance/clock-in` / `POST /hr/attendance/clock-out`. Shows a date-filtered table of attendance records with employee name, date, clock-in/out times.

**File to create**: `apps/web-admin/src/app/(dashboard)/hr/attendance/page.tsx`

Follow the exact same `useEffect + useState + Card/Table/Dialog + apiFetch` pattern as the shifts page. Key state: `attendances` (`Attendance[]`), `outlets`, `staff` (`User[]`), `loading`, `error`, `selectedOutletId`, `selectedMonth` (YYYY-MM string, default to current month).

Load: `GET /hr/attendance?outletId=${selectedOutletId}&month=${selectedMonth}&limit=50`

Add a "Clock In" dialog: select an employee from the `staff` list, select a shift from `shifts` state, call `POST /hr/attendance/clock-in`. Add a "Clock Out" button per row (only active if no `clockOut`) that calls `POST /hr/attendance/clock-out` with `{ attendanceId: row.id }`.

Table columns: Employee Name, Date, Shift, Clock In, Clock Out, Hours Worked, Status, Actions (Clock Out button when applicable).

Import types: `Attendance`, `AttendanceStatus`, `Shift`, `User`, `Outlet` from `@gusto/api-contracts`.

**Verify**: Build succeeds.

---

### Item 16 — Create HR Payroll page

**What**: New page calling `GET /hr/payrolls?outletId=&month=` and `POST /hr/payrolls/generate`. Shows a table of payroll records with employee name, month, days worked, base salary, deductions, net salary, status. Add Generate Payroll button that calls `POST /hr/payrolls/generate` with outlet and month.

**File to create**: `apps/web-admin/src/app/(dashboard)/hr/payroll/page.tsx`

Follow the same pattern. Key state: `payrolls` (`Payroll[]`), `outlets`, `loading`, `error`, `selectedOutletId`, `selectedMonth`.

Load: `GET /hr/payrolls?outletId=${selectedOutletId}&month=${selectedMonth}&limit=50`

"Generate Payroll" button calls `POST /hr/payrolls/generate` with `{ outletId, month }`.

Table columns: Employee, Month, Days Worked, Base Salary, Deductions, Bonus, Net Salary, Status, Paid At.

Show status badges: DRAFT (gray), CALCULATED (blue), APPROVED (amber), PAID (green).

Import types: `Payroll`, `PayrollStatus`, `Outlet` from `@gusto/api-contracts`.

**Verify**: Build succeeds.

---

### Item 17 — Add HR nav link in layout.tsx

**What**: Add an "HR" nav item to `sidebarNavItems` pointing to `/hr`.

**File**: `apps/web-admin/src/app/(dashboard)/layout.tsx`

Add to the `sidebarNavItems` array, after the "Staff" entry:
```typescript
  {
    title: "HR",
    href: "/hr",
    icon: CalendarDays,
  },
```

Add `CalendarDays` to the lucide-react import line.

**Verify**: Build succeeds. The sidebar shows "HR" between Staff and Reports.

---

## Priority 5 — Add Missing CRM Module Pages

### Item 18 — Create CRM Feedback page

**What**: New page calling `GET /crm/feedbacks` and `POST /crm/feedbacks`. Shows a table of customer feedback with rating (1–5 stars), comment, outlet, and customer.

**File to create**: `apps/web-admin/src/app/(dashboard)/crm/page.tsx`

Pattern: same `useEffect + useState + Card/Table` as existing pages. State: `feedbacks` (`Feedback[]`), `outlets`, `loading`, `error`.

Load: `GET /crm/feedbacks?limit=50`

Add "Record Feedback" dialog using `createFeedbackSchema` for form validation (fields: `outletId`, `rating` 1–5, `comment`, `source`).

Table columns: Rating (star icons), Comment (truncated), Source, Outlet, Date.

Import types: `Feedback`, `CreateFeedback`, `createFeedbackSchema` from `@gusto/api-contracts`.

**Verify**: Build succeeds.

---

### Item 19 — Create CRM Coupons page

**What**: Full CRUD page for coupons. `GET /crm/coupons`, `POST /crm/coupons`, `PUT /crm/coupons/:id`, `DELETE /crm/coupons/:id`.

**File to create**: `apps/web-admin/src/app/(dashboard)/crm/coupons/page.tsx`

Follow same CRUD pattern as menu/staff pages. State: `coupons` (`Coupon[]`), `loading`, `error`, modal state.

Form fields (from `createCouponSchema`): `code`, `description`, `type` (PERCENTAGE/FLAT), `value`, `minOrderAmount`, `usageLimit`, `validFrom`, `validUntil`, `isActive`.

Table columns: Code, Type, Value, Min Order, Usage (used/limit), Valid From/Until, Status, Actions (Edit/Delete).

Import: `Coupon`, `CreateCoupon`, `UpdateCoupon`, `createCouponSchema`, `updateCouponSchema`, `CouponType` from `@gusto/api-contracts`.

**Verify**: Build succeeds.

---

### Item 20 — Create CRM Loyalty page

**What**: Page showing loyalty balance and transaction history for a specific customer. Navigated to from the Customers page via a "View Loyalty" action.

**File to create**: `apps/web-admin/src/app/(dashboard)/crm/loyalty/[customerId]/page.tsx`

This is a dynamic route page. Accept `params.customerId`. Load:
- `GET /crm/loyalty/:customerId` → `{ customer: { name, phone, loyaltyPoints }, balance: number }`
- `GET /crm/loyalty/:customerId/history` → paginated `LoyaltyTransaction[]`

Display: customer name, current points balance, transaction history table (type, points change, balance after, description, date).

Add "Manual Adjust" button (OWNER role) using `adjustLoyaltySchema` that calls `POST /crm/loyalty/adjust`.

Import: `LoyaltyTransaction`, `AdjustLoyalty`, `adjustLoyaltySchema` from `@gusto/api-contracts`.

**Link from Customers page**: In `apps/web-admin/src/app/(dashboard)/customers/page.tsx`, add to the `DropdownMenuContent` for each customer row:
```tsx
<DropdownMenuItem asChild>
  <Link href={`/crm/loyalty/${customer.id}`}>
    <Star className="w-4 h-4 mr-2" />
    View Loyalty
  </Link>
</DropdownMenuItem>
```
Add `Link` import from `next/link`.

**Verify**: Build succeeds.

---

### Item 21 — Add CRM nav link in layout.tsx

**What**: Add a "CRM" nav item pointing to `/crm`.

**File**: `apps/web-admin/src/app/(dashboard)/layout.tsx`

Add to `sidebarNavItems` after the "Customers" entry:
```typescript
  {
    title: "CRM",
    href: "/crm",
    icon: MessageSquare,
  },
```

Add `MessageSquare` to the lucide-react import.

**Verify**: Build succeeds. Sidebar shows "CRM" between Customers and Staff.

---

## Priority 6 — Production Hardening

### Item 22 — Remove demo credentials from login page

**What**: Delete the entire "Demo Login" block — the small gray box with the fill-button that puts `admin@gusto.dev / admin123` into the form fields.

**File**: `apps/web-admin/src/app/(auth)/login/page.tsx`

Remove:
```tsx
              <div className="text-xs text-center text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="font-semibold text-gray-700">Demo Login:</span>{" "}
                <button
                  type="button"
                  className="text-blue-600 hover:underline font-mono"
                  onClick={() => {
                    loginForm.setValue("email", "admin@gusto.dev");
                    loginForm.setValue("password", "admin123");
                  }}
                >
                  admin@gusto.dev / admin123
                </button>
              </div>
```

**Verify**: Build succeeds. The login page no longer shows any hardcoded credentials.

---

### Item 23 — Cookie security: Secure + SameSite flags on gusto_token

**What**: In both places where `gusto_token` is set (login page) and where NEXT_PUBLIC_API_URL determines production context, add `Secure` when `NODE_ENV === 'production'` and always add `SameSite=Strict`.

**File**: `apps/web-admin/src/app/(auth)/login/page.tsx`

Replace both cookie-set lines (in `onLoginSubmit` and `onRegisterSubmit`):
```typescript
      document.cookie = `gusto_token=${res.data.token}; path=/; max-age=86400;`;
```
with:
```typescript
      const isProduction = process.env.NODE_ENV === "production";
      const secureFlag = isProduction ? "; Secure" : "";
      document.cookie = `gusto_token=${res.data.token}; path=/; max-age=86400; SameSite=Strict${secureFlag}`;
```

**Verify**: Build succeeds.

---

### Item 24 — Create .env files for web-admin

**What**: Create `.env.production` with the production API URL placeholder and `.env.local.example` for local development reference. Neither file should contain real secrets.

**File to create**: `apps/web-admin/.env.production`
```
# Production environment variables for web-admin
# Replace with your actual deployed API gateway URL before deploying
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api/v1
```

**File to create**: `apps/web-admin/.env.local.example`
```
# Copy this file to .env.local and fill in your values
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
```

**Verify**: Files exist at the correct paths. Build succeeds (Next.js will pick up `.env.production` during `next build`).

---

### Item 25 — CORS: use process.env.CORS_ORIGIN in production, fall back to false (not true)

**What**: Currently `process.env.CORS_ORIGIN || true` allows all origins in production if the env var is unset. Change the fallback to `false` in production, `true` only in development.

**File**: `apps/api-gateway/src/index.ts`

Replace:
```typescript
const allowedOrigin = process.env.CORS_ORIGIN || true;
```
with:
```typescript
const allowedOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN
  : process.env.NODE_ENV === "production"
  ? false
  : true;
```

Also update the Socket.IO cors config block:
```typescript
const io = new SocketServer(fastify.server, {
  cors: {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  },
});
```
Replace the `origin` line with the same logic:
```typescript
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN
      : process.env.NODE_ENV === "production"
      ? false
      : true,
```

**Verify**: Build succeeds.

---

### Item 26 — JWT_SECRET: refuse to start in production with default secret

**What**: Add a startup guard that throws if `JWT_SECRET === 'change-me-in-production'` and `NODE_ENV === 'production'`.

**File**: `apps/api-gateway/src/index.ts`

Add immediately after the `dotenv.config()` call, before any Fastify or Sentry initialization:
```typescript
// ─── Production Safety Checks ───
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change-me-in-production")
) {
  console.error(
    "FATAL: JWT_SECRET is set to the default insecure value. " +
    "Set a strong random JWT_SECRET before running in production."
  );
  process.exit(1);
}
```

**Verify**: Build succeeds.

---

### Item 27 — Add pagination controls to Orders, Customers, and Staff pages

**Decision**: All three pages already call their list APIs with `limit=100` or similar but no page navigation. Add `page` state (starts at 1), pass `?page=N&limit=20` to the API, and render Previous / Page X of Y / Next controls.

#### Orders page

**File**: `apps/web-admin/src/app/(dashboard)/orders/page.tsx`

Add state:
```typescript
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
```

Update the orders API call. The current code calls:
```typescript
apiFetch<Order[]>(`/orders?outletId=${outletId}&limit=100`)
```
Change to:
```typescript
const ordersRes = await apiFetch<Order[]>(`/orders?outletId=${outletId}&page=${page}&limit=20`);
```
After setting `setOrders(ordersRes.data)`, also:
```typescript
if (ordersRes.pagination) {
  setTotalPages(ordersRes.pagination.totalPages);
}
```

Add `page` to the `useEffect` dependency array so changing page re-fetches.

Add pagination controls below the orders table:
```tsx
{totalPages > 1 && (
  <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
    <Button
      variant="outline"
      size="sm"
      onClick={() => setPage(p => Math.max(1, p - 1))}
      disabled={page === 1}
    >
      Previous
    </Button>
    <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
    <Button
      variant="outline"
      size="sm"
      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
      disabled={page === totalPages}
    >
      Next
    </Button>
  </div>
)}
```

Reset `page` to 1 when the outlet filter changes.

#### Customers page

**File**: `apps/web-admin/src/app/(dashboard)/customers/page.tsx`

Same pattern: add `page`/`totalPages` state. Change the API call to `/customers?page=${page}&limit=20`. Add pagination controls below the table. Add `page` to the `useEffect` dependency array.

#### Staff page

**File**: `apps/web-admin/src/app/(dashboard)/staff/page.tsx`

Same pattern for `/users?page=${page}&limit=20`.

**Verify**: `cd /Users/agni/Developer/Gustos && npx turbo build --filter=web-admin --filter=api-gateway` — full build succeeds with no TypeScript errors.

---

## Final Build Verification

Run the following command to confirm all changes compile successfully:

```bash
cd /Users/agni/Developer/Gustos && npx turbo build --filter=web-admin --filter=api-gateway
```

Expected outcome: both `web-admin` and `api-gateway` build packages complete without TypeScript errors. Next.js static analysis should pass. No `generateMockTables`, no mock fallback objects, no demo credential strings in the built output.

---

## Dependency Order Summary

The items must be implemented in this order to avoid broken intermediate states:

1. Items 1–6 (mock removal) — independent of each other, all depend only on existing types
2. Item 7 (schema + API contracts extension) — must precede Items 8–12 (settings wiring)
3. Items 8–12 (settings wiring) — depends on Item 7
4. Item 13 (reports rewire) — independent, depends only on existing reporting endpoints
5. Items 14–16 (HR pages) — independent of each other
6. Item 17 (HR nav link) — depends on Items 14–16 existing
7. Items 18–20 (CRM pages) — independent of each other
8. Item 21 (CRM nav link) — depends on Items 18–20 existing
9. Items 22–27 (production hardening) — independent of each other
10. Final build verification — last
