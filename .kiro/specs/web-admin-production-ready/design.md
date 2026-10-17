# Design Document

## web-admin-production-ready

---

## Overview

This document describes the technical design for bringing the `apps/web-admin` Next.js 15 dashboard to a fully production-ready state. The work spans fifteen requirements covering new modules (Vendors, Purchase Orders, GRNs, HR Attendance, HR Payroll, CRM Loyalty), completing stub pages, upgrading existing pages with outlet-switcher consistency and UX improvements, and adding cross-cutting resilience patterns (error boundaries, empty states, search/filter, pagination, mobile responsiveness).

The design is deliberately incremental: it reuses all existing patterns (React local state, `apiFetch`, React Hook Form + zodResolver, shadcn/ui, `useToast`) and adds only the shared components strictly needed to meet the requirements — primarily `OutletSwitcher`, `EmptyState`, and a page-level `ErrorBoundary`.

---

## Architecture

### Tech Stack (unchanged)

- **Framework**: Next.js 15 App Router, TypeScript
- **Styling**: Tailwind CSS v4 utility classes
- **Component library**: shadcn/ui (`@/components/ui/`)
- **API layer**: `apiFetch()` from `@/lib/api-client.ts`
- **Types**: `@gusto/api-contracts` (Zod schemas + TypeScript inference)
- **Forms**: React Hook Form + zodResolver
- **Notifications**: `useToast` from `@/lib/toast`
- **State**: React `useState`/`useEffect` — no global store

### Directory Structure for New Files

```
apps/web-admin/src/
├── components/
│   ├── ui/                           (existing shadcn/ui — no changes)
│   ├── inventory/
│   │   └── RecipeManagerModal.tsx    (modify in-place)
│   └── shared/
│       ├── OutletSwitcher.tsx        (NEW)
│       ├── EmptyState.tsx            (NEW)
│       └── PageErrorBoundary.tsx     (NEW)
├── app/(dashboard)/
│   ├── outlets/
│   │   └── page.tsx                  (modify — hierarchy view)
│   ├── menu/
│   │   └── page.tsx                  (modify — outlet switcher, category filter, inline toggle)
│   ├── tables/
│   │   └── page.tsx                  (modify — outlet switcher, bulk status update)
│   ├── staff/
│   │   └── page.tsx                  (modify — role badges, outlet column, search, permission matrix)
│   ├── inventory/
│   │   └── page.tsx                  (modify — vendors, PO, GRN tabs)
│   ├── orders/
│   │   └── page.tsx                  (modify — outlet switcher, date filter, search, row highlighting)
│   ├── hr/
│   │   ├── page.tsx                  (existing shifts — add outlet switcher)
│   │   ├── attendance/
│   │   │   └── page.tsx              (NEW)
│   │   └── payroll/
│   │       └── page.tsx              (NEW)
│   └── crm/
│       ├── page.tsx                  (existing — no changes needed beyond customers link fix)
│       └── loyalty/
│           └── [customerId]/
│               └── page.tsx          (NEW)
└── lib/
    └── outlet-context.ts             (NEW — localStorage outlet persistence)
```

### Outlet Selection Persistence

Selected outlet ID is persisted across page navigations using `localStorage` under the key `gusto_selected_outlet_id`. A thin utility module (`outlet-context.ts`) exposes `getPersistedOutletId()` and `setPersistedOutletId(id: string)` — no React context required since each page reads from storage on mount.

---

## Components and Interfaces

### 1. `OutletSwitcher` (`src/components/shared/OutletSwitcher.tsx`)

A self-contained controlled component that renders either a `<select>` dropdown (≥2 outlets) or a static label (1 outlet).

```typescript
interface OutletSwitcherProps {
  outlets: Outlet[];
  currentOutletId: string;
  onOutletChange: (outletId: string) => void;
  isLoading?: boolean;   // shows spinner overlay while data reloads
}
```

**Rendering logic:**

- If `outlets.length === 0`: renders nothing (parent handles no-outlet empty state).
- If `outlets.length === 1`: renders `<span>` with outlet name — no dropdown.
- If `outlets.length >= 2`: renders a `<select>` populated with all outlet options, current value highlighted.
- On mobile (`< 640 px`): receives `className="w-full"` from the parent to satisfy Req 15.4.
- Shows a small `<Loader2>` spinner adjacent to the select when `isLoading` is true.

**Usage pattern (shared across all outlet-scoped pages):**

```typescript
const [currentOutletId, setCurrentOutletId] = useState(getPersistedOutletId() ?? outlets[0]?.id ?? "");

const handleOutletChange = async (id: string) => {
  setCurrentOutletId(id);
  setPersistedOutletId(id);
  await loadPageData(id);   // page-specific reload
};
```

### 2. `EmptyState` (`src/components/shared/EmptyState.tsx`)

```typescript
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;           // use Link when navigating to another page
  };
}
```

Renders a centred flex column with icon, title, description, and an optional primary `Button`. Used in every list page for zero-item conditions.

### 3. `PageErrorBoundary` (`src/components/shared/PageErrorBoundary.tsx`)

A React class component (error boundaries must be class components) that:

- Wraps each dashboard page's content area.
- On caught error: renders an error card with a descriptive message and a "Try Again" button that calls `this.setState({ hasError: false })` to remount the child tree.
- Does **not** wrap the sidebar/topbar in `layout.tsx` — only the `{children}` region.

```typescript
interface PageErrorBoundaryProps {
  children: ReactNode;
  pageName?: string;   // used in error message: "The {pageName} page encountered an error"
}

interface PageErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}
```

Integration in `layout.tsx`:

```tsx
<div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
  <PageErrorBoundary>
    {children}
  </PageErrorBoundary>
</div>
```

### 4. `outlet-context.ts` (`src/lib/outlet-context.ts`)

```typescript
const STORAGE_KEY = "gusto_selected_outlet_id";

export function getPersistedOutletId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setPersistedOutletId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, id);
}
```

---

## Data Models

All entity types come from `@gusto/api-contracts`. The following are the relevant types this feature interacts with (not re-defined here — imported as needed):

| Type | Source | Used by |
|---|---|---|
| `Outlet` | `@gusto/api-contracts` | OutletSwitcher, all outlet-scoped pages |
| `Franchise` | `@gusto/api-contracts` | Outlets page hierarchy view |
| `MenuItem`, `MenuCategory` | `@gusto/api-contracts` | Menu page, Recipe modal |
| `DiningTable` | `@gusto/api-contracts` | Tables page |
| `User` | `@gusto/api-contracts` | Staff page |
| `InventoryItem`, `Recipe` | `@gusto/api-contracts` | Inventory page, Recipe modal |
| `Vendor` | `@gusto/api-contracts` | Inventory → Vendors tab |
| `PurchaseOrder`, `PurchaseOrderLineItem` | `@gusto/api-contracts` | Inventory → Purchase Orders tab |
| `GoodsReceivedNote`, `GRNLineItem` | `@gusto/api-contracts` | Inventory → GRNs tab |
| `Order` | `@gusto/api-contracts` | Orders page |
| `Shift`, `AttendanceRecord`, `Payroll` | `@gusto/api-contracts` | HR pages |
| `Customer` | `@gusto/api-contracts` | Customers page |
| `LoyaltyTransaction` | `@gusto/api-contracts` | CRM Loyalty page |

### New local-only form types (defined per-page, not exported)

**Vendor creation form:**
```typescript
type VendorFormValues = { name: string; email?: string; phone?: string; address?: string; };
```

**Purchase Order creation form:**
```typescript
type POFormValues = {
  vendorId: string;
  expectedDeliveryDate: string;         // ISO date string
  lineItems: { inventoryItemId: string; quantity: number; unitPrice: number; }[];
};
```

**GRN creation form:**
```typescript
type GRNFormValues = {
  purchaseOrderId: string;
  receivedDate: string;
  lineItems: { poLineItemId: string; receivedQuantity: number; }[];
};
```

**Payroll action:**
```typescript
type PayrollStatusUpdate = { status: "APPROVED" | "PAID"; paidAt?: string; };
```

**Loyalty adjustment form:**
```typescript
type LoyaltyAdjustFormValues = { amount: number; reason: string; };
```

---

## Page-by-Page Design

### Outlets Page — Franchise Hierarchy View (Req 1)

Replace the current flat table with a two-level hierarchy:

1. Load `GET /franchises` and `GET /outlets` in parallel on mount.
2. Group outlets by `franchiseId` client-side.
3. Render a vertical stack of `Card` components, one per franchise, with outlet rows inside each card.
4. Each franchise card header has: franchise name, optional description, "Edit" icon button, "Delete" icon button, and "+ New Outlet" button that opens the outlet creation dialog with `franchiseId` pre-filled.
5. A top-level "+ New Franchise" button opens a separate dialog with name (required, max 100 chars) and description (optional, max 500 chars) fields.
6. Deletion flow:
   - Franchise with no outlets → single `Dialog` confirmation → `DELETE /franchises/:id`.
   - Franchise with outlets → warning `Dialog` explicitly stating cascade deletion → requires explicit "Delete All" button click.
7. Retain the "Edge Sync Monitor" tab alongside the hierarchy using existing `Tabs` component.
8. Each outlet row displays: name, address, active/inactive badge, and last sync timestamp if available.
9. When a franchise section has zero outlets: render `<EmptyState>` within the card body with "+ Add Outlet" CTA.

### Menu Page — Outlet Switcher + Category Filter + Inline Toggle (Req 2, 3)

1. Add `<OutletSwitcher>` at the top of the page, above the existing action buttons.
2. On outlet change: re-fetch both `GET /menu/categories?outletId=` and `GET /menu/items?outletId=` in parallel; show loading spinner on OutletSwitcher during fetch.
3. Add a horizontal scrollable category filter row (pill buttons) above the items table:
   - Pill for "All" + one pill per category, each showing a count badge (`{count}` items in that category for the selected outlet).
   - Clicking a pill filters the displayed rows client-side; no API re-fetch needed.
   - Active pill has `bg-blue-600 text-white`; inactive has `bg-gray-100 text-gray-700`.
4. Add an inline availability toggle (`<Switch>`) in each table row:
   - On toggle: optimistically update the row's `isAvailable` state, call `PUT /menu/items/:id` with `{ isAvailable: newValue }`.
   - On success: leave the optimistic state in place.
   - On failure: revert the toggle back to the previous value and call `toast({ variant: "error" })`.
5. When items list is empty for the current outlet+category filter: render `<EmptyState>` with "+ Add Menu Item" CTA.

### Tables Page — Outlet Switcher + Bulk Status Update (Req 2, 4)

1. Add `<OutletSwitcher>` to the page header.
2. On outlet change: clear `tables` state and re-fetch `GET /tables?outletId=`.
3. Add "Bulk Status Update" button in the page header.
4. Bulk Status Update Dialog:
   - `<select>` for section (populated from distinct `table.section` values for current outlet).
   - `<select>` for target status: "AVAILABLE" or "CLEANING" only.
   - If selected section has 0 tables: disable confirm button and show inline message.
   - On confirm: iterate tables in the section, fire `PUT /tables/:id` requests, show progress indicator (e.g. "Updating 3 of 8 tables…"), refresh affected cards on completion, show success toast.
   - Partial failure: show error toast with failure count; successfully updated tables retain new status.
5. When outlet has no tables: render `<EmptyState>` with "+ Add Table" CTA (opens existing create dialog).

### Staff Page — Role Badges, Outlet Column, Search, Permission Matrix (Req 5)

**Role badge color mapping:**

| Role | Classes |
|---|---|
| MANAGER | `bg-blue-100 text-blue-800` |
| CASHIER | `bg-gray-100 text-gray-700` |
| WAITER | `bg-green-100 text-green-800` |
| CHEF | `bg-orange-100 text-orange-800` |
| (other) | `bg-gray-100 text-gray-600` |

**Outlet column:** Add an "Outlet" column between Role and Status. Resolve `user.outletId` against the loaded `outlets[]` array. Display:
- Matched name → outlet name
- `outletId === null/undefined` → "Global" (muted text)
- `outletId` present but not in array → "Unknown Outlet" (muted text)

**Search:** Add a search `<Input>` above the table. Client-side filter on each keystroke: show rows where `name`, `email`, or `role` (case-insensitive substring match) contains the query. Show `<EmptyState title="No results found">` when no rows match.

**Inactive row styling:** `className={employee.isActive ? "" : "opacity-40"}` on `<TableRow>`.

**Permission Matrix tab:** Replace "coming soon" with a static read-only `<Table>` rendered from a constant:

```typescript
const ROLE_PERMISSIONS = {
  MANAGER:  { viewReports: true,  editMenu: true,  manageStaff: true,  processOrders: true,  viewOrders: true,  manageInventory: true  },
  CASHIER:  { viewReports: false, editMenu: false, manageStaff: false, processOrders: true,  viewOrders: true,  manageInventory: false },
  WAITER:   { viewReports: false, editMenu: false, manageStaff: false, processOrders: true,  viewOrders: true,  manageInventory: false },
  CHEF:     { viewReports: false, editMenu: false, manageStaff: false, processOrders: false, viewOrders: true,  manageInventory: false },
};
```

Cells show a green check (✓) or red cross (✗) icon.

### Inventory Page — Vendors, Purchase Orders, GRNs (Req 6, 7, 8, 9)

#### Recipe Builder Tab — UX Improvements (Req 6)

1. Add summary counter in card header: "X of Y menu items have recipes configured."
2. Rows without a recipe: apply `bg-amber-50/50` background.
3. Delegate to updated `RecipeManagerModal` (see below).

#### RecipeManagerModal Improvements (Req 6)

1. Replace the plain `<select>` for ingredient with a combo-box style `<select>` that is pre-filtered to active inventory items only.
2. Add "Estimated Cost Per Serving" display, calculated live:
   ```typescript
   const estimatedCost = fields.reduce((sum, field, idx) => {
     const qty = form.watch(`ingredients.${idx}.quantity`) ?? 0;
     const item = inventoryItems.find(i => i.id === form.watch(`ingredients.${idx}.inventoryItemId`));
     return sum + qty * (item?.costPerUnit ?? 0);
   }, 0);
   ```
   Displayed as `₹{estimatedCost.toFixed(2)}` — recalculates on every `watch` change (React Hook Form's `watch` is reactive by default).
3. Ingredient rows use direct `<Input>` for quantity editing — already the case; ensure `onBlur` is not used so editing is immediate without form submission.
4. On save failure: keep modal open, preserve all field values, show toast with error message.
5. After successful save: call `onSave()`, close modal, parent refreshes recipes list and updates "Recipe Status" and "Ingredients Count" columns without full page reload (parent re-fetches `/recipes`).

#### Vendors Tab (Req 7)

Replace "coming soon" with:
1. Load `GET /vendors` on tab activation (lazy — only when `activeTab === "vendors"` and not yet loaded).
2. Vendors table: Name, Email, Phone, Address, Actions (Edit, Delete).
3. "Add Vendor" dialog with validation: name required (max 100 chars), email optional (valid format), phone optional (max 20 chars).
4. Delete with confirmation dialog. All errors show toast; list state preserved on API failure.
5. No vendors: `<EmptyState>` with "+ Add First Vendor" CTA.

#### Purchase Orders Tab (Req 8)

1. Load `GET /purchase-orders` on tab activation.
2. PO table columns: PO Number, Vendor Name, Total Value, Status badge (DRAFT/SENT/RECEIVED/CANCELLED), Created Date.
3. "Create PO" dialog:
   - Vendor selector (from loaded vendors list).
   - Expected delivery date (date picker input).
   - Dynamic line items section using `useFieldArray`: each row has inventory item selector, quantity (int 1–9999), unit price (0.01–999999.99).
   - "+ Add Item" button (min 1, max 50 line items).
   - Submit disabled unless vendor, delivery date, and ≥1 line item are all populated.
4. RECEIVED status rows: Edit and Delete actions disabled; show "View GRN" link.
5. No POs: `<EmptyState>` with "Create First PO" CTA.

**PO Total Value calculation (client-side):**
```typescript
const poTotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
```

#### GRNs Tab (Req 9)

1. Load `GET /grns` on tab activation.
2. GRN table columns: GRN Number, PO Number (linked), Received Date, Supplier Name, Total Items Received.
3. "New GRN" dialog:
   - PO selector: only POs with status "Open" or "Partially Received".
   - When PO selected: fetch PO line items, render each with ordered quantity and a received quantity field (0.001–99999, 3 decimal places).
   - Submit disabled unless at least one received quantity > 0.
   - Inline validation: if received quantity > remaining ordered quantity, show field-level error and disable submit.
4. On successful save: re-fetch `/inventory` to refresh stock levels in Raw Materials tab within the same page render cycle.
5. No GRNs: `<EmptyState>` with "Record First GRN" CTA.

### Orders Page — Outlet Switcher, Date Filter, Search, Row Highlighting (Req 2, 10)

1. Add `<OutletSwitcher>` as first element in the filter bar.
2. Date range filter: two `<Input type="date">` fields (from / to). Default on load: today's date for both. Max range 90 days — if user selects a range > 90 days, show inline validation message. Re-fetch orders with `&from=YYYY-MM-DD&to=YYYY-MM-DD` params on apply.
3. Resolve table names: load `GET /tables?outletId=` alongside orders. In the table column, look up `order.tableId` in the loaded tables array; display table name or "—" if not resolved.
4. Search input (max 100 chars) above the table: client-side filter on the loaded orders list — order number prefix match (case-insensitive) OR customer name partial match (case-insensitive). Filter on each keystroke.
5. Row highlighting: `<TableRow className={order.status === "PLACED" || order.status === "IN_PROGRESS" ? "bg-blue-50/60" : ""}>`.

### HR Attendance Page (`/hr/attendance/page.tsx`) (Req 2)

New page following the same pattern as the Shifts page:
1. Load outlets, default to first (or persisted).
2. `<OutletSwitcher>` at page top.
3. Fetch `GET /hr/attendance?outletId=` with date filter (default: today).
4. Table: Employee Name, Shift, Clock In, Clock Out, Duration, Status.
5. "Record Attendance" button → dialog: employee selector, shift selector, date, clock-in time, clock-out time (optional).
6. Navigation links to Shifts and Payroll (already present pattern in hr/page.tsx).

### HR Payroll Page (`/hr/payroll/page.tsx`) (Req 2, 11)

1. `<OutletSwitcher>` at page top.
2. Month selector (default: current month in `YYYY-MM` format).
3. Fetch `GET /hr/payrolls?outletId=&month=YYYY-MM`.
4. Table: Employee Name (resolved from employee ID), Base Salary, Deductions, Bonuses, Net Salary, Status badge, Action button.
5. Inline action buttons per row:
   - `CALCULATED` status → "Approve" button → `PUT /hr/payrolls/:id` `{ status: "APPROVED" }`.
   - `APPROVED` status → "Mark Paid" button → `PUT /hr/payrolls/:id` `{ status: "PAID", paidAt: new Date().toISOString() }`.
   - On API error: toast with error message; row status unchanged.
6. Summary row (pinned at table bottom): sum of base salary, deductions, bonuses, net salary for all visible rows. Shows zeros when no rows.
7. No payroll rows: `<EmptyState>` describing that payroll is generated from shifts and attendance.

### CRM Loyalty Page (`/crm/loyalty/[customerId]/page.tsx`) (Req 12)

New dynamic route page:
1. On mount: fetch `GET /customers/:customerId` and `GET /crm/loyalty/:customerId/transactions` in parallel.
2. Display: customer name, current loyalty points balance (large number display), transaction history table.
3. Transaction table: Date, Type (EARN/BURN/ADJUSTMENT), Points (signed), Description, Running Balance.
4. "Adjust Points" button → dialog:
   - Adjustment amount: integer, -10000 to +10000, non-zero. Validated client-side with zodResolver.
   - Reason: 1–255 characters.
   - Submit → `POST /crm/loyalty/:customerId/adjust` (or equivalent endpoint).
   - On success: update balance display and prepend new transaction to history.
   - On failure: toast error; balance and history unchanged.
5. "← Back to Customers" link at page top.
6. No transactions: `<EmptyState title="No loyalty history yet">`.

In `customers/page.tsx`: update the "View Loyalty" dropdown item to use `router.push(\`/crm/loyalty/\${customer.id}\`)` (replace the existing `window.location.href` call).

---

## Cross-Cutting Patterns

### Error Handling (Req 13)

**Error Boundary placement:**
```tsx
// layout.tsx
<div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
  <PageErrorBoundary>
    {children}
  </PageErrorBoundary>
</div>
```

**API error inline banners:** Every `apiFetch` call that fails already returns `{ success: false, message }`. Pages already handle this with a red banner `div`. The pattern is standardised as:
```tsx
{error && (
  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
    <span>⚠️</span>
    <span>{error}</span>
    {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>}
  </div>
)}
```

**Network timeout (30s):** Enhance `apiFetch` with an `AbortController`:
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
const res = await fetch(requestUrl, { ...options, headers, signal: controller.signal });
clearTimeout(timeout);
```
Catch `AbortError` separately and return a specific message: `"Request timed out. Check your network connection and try again."`.

**No-outlet state:** Pages that require an outlet detect `outlets.length === 0` after loading and render:
```tsx
<EmptyState
  title="No outlets configured"
  description="This page requires at least one outlet. Set one up first."
  action={{ label: "Go to Outlets", href: "/outlets" }}
/>
```

**Loading states:** Every data-fetching section renders a `<Loader2>` spinner while `loading === true`. For tables specifically, a skeleton approach can be used (alternating gray rows) but the existing `<Loader2>` pattern is acceptable and consistent.

### Search, Filter & Pagination (Req 14)

**Client-side search pattern (standard across all pages):**
```typescript
const filteredItems = useMemo(() => {
  if (!searchQuery.trim()) return items;
  const q = searchQuery.toLowerCase();
  return items.filter(item =>
    SEARCH_FIELDS[entityType].some(field =>
      String((item as any)[field] ?? "").toLowerCase().includes(q)
    )
  );
}, [items, searchQuery]);
```

Search field configuration per entity:
- Staff: `["name", "role"]` (email omitted per Req 5.3 — add email too: `["name", "email", "role"]`)
- Customers: `["name", "phone"]`
- Inventory: `["name"]`
- Menu Items: `["name"]` (category is a resolved name — filter against resolved category name)
- Vendors: `["name"]`
- Purchase Orders: `["poNumber", "vendorName"]` (vendorName is a resolved field)

**Pagination:** Server-side pagination is already wired via `?page=&limit=` on Staff and Customers pages. The same pattern is applied to Vendors and POs. Pagination controls (`Previous` / `Next` / page counter) are shown only when `totalPages > 1`. Total item count displayed in the `CardDescription`.

### Mobile Responsiveness (Req 15)

All existing tables gain `overflow-x-auto` on their wrapping `div`:
```tsx
<CardContent className="p-0 overflow-x-auto">
  <Table>...</Table>
</CardContent>
```

KPI grids (`grid-cols-3`, `grid-cols-4`) gain responsive prefix:
```tsx
className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
```

Dialog forms on mobile: add `data-mobile-sheet` styling via a shared utility — at `< 640px`, dialogs are rendered with `rounded-t-2xl rounded-b-none fixed bottom-0 left-0 right-0 w-full px-4` overriding the default centered modal. This is achieved by adding a CSS class variant to `DialogContent` in shadcn/ui or using a Tailwind responsive override.

`OutletSwitcher` receives `className` prop; all outlet-scoped page parent wrappers pass `sm:w-auto w-full` to the switcher container.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The following properties are identified for property-based testing using **fast-check** (the standard PBT library for TypeScript/JavaScript).

---

### Property 1: Role badge class is always non-empty and role-specific

*For any* role string value, `getRoleBadgeClass(role)` must return a non-empty CSS class string; for each of the four defined roles (MANAGER, CASHIER, WAITER, CHEF) it must return the specific expected color class; for any other role string it must return the neutral fallback class.

**Validates: Requirements 5.1**

---

### Property 2: Outlet name resolution is exhaustive

*For any* `outletId` value (including `null`, `undefined`, and any arbitrary string) and *for any* array of `Outlet` objects, `resolveOutletName(outletId, outlets)` must return exactly the matched outlet's name when a match exists, exactly `"Global"` when `outletId` is null or undefined, and exactly `"Unknown Outlet"` when `outletId` is a non-null string not found in the array — covering all possible input combinations without throwing.

**Validates: Requirements 5.2, 11.4**

---

### Property 3: Staff search filter contains only matching rows

*For any* array of staff members and *for any* non-empty search query string, `filterStaff(staff, query)` must return a subset of the original array where every returned row contains the query string (case-insensitive) in at least one of: `name`, `email`, or `role`; and no row that satisfies this condition is omitted from the results.

**Validates: Requirements 5.3, 14.2**

---

### Property 4: Recipe cost calculation is exact

*For any* array of recipe ingredient objects each having a `quantity` (non-negative number) and a resolved `costPerUnit` (non-negative number), `calculateRecipeCost(ingredients)` must equal `Math.round(sum(quantity_i × costPerUnit_i) × 100) / 100` — i.e. the sum rounded to exactly 2 decimal places — and must return `0.00` for an empty ingredients array.

**Validates: Requirements 6.5, 6.6**

---

### Property 5: Recipe configured counter matches actual recipe coverage

*For any* array of `MenuItem` objects and *for any* array of `Recipe` objects, `countConfiguredRecipes(menuItems, recipes)` must return `{ configured: N, total: M }` where `N` equals the count of menu items whose `id` appears in the recipes array and `M` equals the total number of menu items — with `N <= M` always holding.

**Validates: Requirements 6.1**

---

### Property 6: Purchase order total value is exact

*For any* array of PO line items each having a `quantity` (integer 1–9999) and `unitPrice` (number 0.01–999999.99), `calculatePOTotal(lineItems)` must equal `Math.round(sum(quantity_i × unitPrice_i) × 100) / 100` — rounded to 2 decimal places — and must return `0.00` for an empty line items array.

**Validates: Requirements 8.3**

---

### Property 7: Order search filter contains only matching rows

*For any* loaded orders list and *for any* search query string of up to 100 characters, `filterOrders(orders, query)` must return only rows where `order.orderNumber.toLowerCase().startsWith(query.toLowerCase())` OR `order.customerName?.toLowerCase().includes(query.toLowerCase())` — and no matching row is omitted; for an empty query the full list is returned unchanged.

**Validates: Requirements 10.4**

---

### Property 8: Payroll summary totals match row-level aggregation

*For any* array of payroll records, `calculatePayrollSummary(records)` must return `{ totalBaseSalary, totalDeductions, totalBonuses, totalNetSalary }` where each value equals the exact sum of the corresponding field across all records, and all values are `0` when the records array is empty.

**Validates: Requirements 11.5**

---

## Error Handling

| Scenario | Handling |
|---|---|
| `apiFetch` returns `{ success: false }` | Show inline red banner with `res.message`; preserve existing displayed data |
| `apiFetch` throws `AbortError` (30s timeout) | Show banner: "Request timed out. Check your network connection and try again." |
| `apiFetch` returns HTTP 401 | Existing redirect to `/login` in `api-client.ts` — no change needed |
| React render throws | `PageErrorBoundary` catches; shows error card with "Try Again" button |
| Outlet switch fetch fails or exceeds 5s | Dismiss loading indicator; show error banner; retain previously displayed outlet data (Req 2.5) |
| Bulk table status update partial failure | Show `toast({ variant: "error" })` with count of failed updates; successful tables keep new status |
| Recipe save fails | Keep modal open; preserve all field values; show error toast |
| GRN received quantity exceeds remaining | Field-level inline error; submit button disabled until resolved |
| Loyalty balance update fails | Toast error; displayed balance and history unchanged |
| No outlets exist on outlet-scoped page | `EmptyState` with link to `/outlets` instead of page content |

---

## Testing Strategy

### Unit Tests (Vitest)

Unit tests target pure utility functions that underpin the correctness properties:

- `src/lib/outlet-context.ts` — `getPersistedOutletId` / `setPersistedOutletId` (mock `localStorage`)
- `getRoleBadgeClass(role)` — extracted pure function from staff page
- `resolveOutletName(outletId, outlets)` — extracted pure function
- `filterStaff(staff, query)` — extracted pure function
- `calculateRecipeCost(ingredients)` — extracted pure function from RecipeManagerModal
- `countConfiguredRecipes(menuItems, recipes)` — extracted pure function
- `calculatePOTotal(lineItems)` — extracted pure function
- `filterOrders(orders, query)` — extracted pure function
- `calculatePayrollSummary(records)` — extracted pure function

Each function should be extracted into a co-located or shared utils file to make it independently testable.

### Property-Based Tests (Vitest + fast-check)

One property-based test per correctness property listed above. Each test is configured to run 100 iterations minimum via fast-check's `fc.assert(fc.property(...), { numRuns: 100 })`.

Tag format in test file comments:
```typescript
// Feature: web-admin-production-ready, Property 1: Role badge class is always non-empty and role-specific
```

**Example structure for Property 3:**
```typescript
import * as fc from "fast-check";
import { filterStaff } from "../lib/staff-utils";

test("Property 3: Staff search filter contains only matching rows", () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ id: fc.uuid(), name: fc.string(), email: fc.option(fc.emailAddress()), role: fc.string() })),
      fc.string({ minLength: 1 }),
      (staff, query) => {
        const result = filterStaff(staff, query);
        const q = query.toLowerCase();
        // All returned rows must match
        const allMatch = result.every(r =>
          r.name.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          r.role.toLowerCase().includes(q)
        );
        // No matching row is omitted
        const noneOmitted = staff
          .filter(r =>
            r.name.toLowerCase().includes(q) ||
            (r.email ?? "").toLowerCase().includes(q) ||
            r.role.toLowerCase().includes(q)
          )
          .every(r => result.some(res => res.id === r.id));
        return allMatch && noneOmitted;
      }
    ),
    { numRuns: 100 }
  );
});
```

### Integration Tests

Integration tests (using Playwright or Vitest with MSW mocks) cover:

- Outlet switcher: selecting a different outlet triggers a data reload for each outlet-scoped page
- Franchise hierarchy: creating/editing/deleting franchises and outlets updates the view
- Bulk table status update: progress indicator appears; table cards refresh after completion
- GRN save: Raw Materials tab stock levels update after a GRN is saved
- Error boundary: simulated render throw → error card rendered; "Try Again" button → page remounts
- Loyalty page: adjusting points updates the balance and prepends to transaction history

### Snapshot / Visual Tests (optional, not required for production readiness)

Role badge color rendering and permission matrix layout are candidates for snapshot tests, but are not required by the acceptance criteria.
