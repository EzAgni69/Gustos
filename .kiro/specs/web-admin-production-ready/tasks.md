# Implementation Plan: web-admin-production-ready

## Overview

This plan converts the existing Gusto ERP web-admin dashboard into a fully production-ready state. Work is organized in dependency order: shared infrastructure comes first (all other tasks rely on it), followed by per-page features, then cross-cutting concerns, and finally property-based tests. Every task uses the existing stack — Next.js 15 App Router, TypeScript, Tailwind CSS v4, shadcn/ui, `apiFetch`, React Hook Form + zodResolver, and `useToast`.

## Tasks

- [x] 1. Shared infrastructure — utilities and components every other task depends on
  - [x] 1.1 Create `src/lib/outlet-context.ts` with `getPersistedOutletId` and `setPersistedOutletId`
    - Export `getPersistedOutletId(): string | null` — reads from `localStorage` under key `gusto_selected_outlet_id`; returns `null` during SSR (`typeof window === "undefined"`)
    - Export `setPersistedOutletId(id: string): void` — writes to `localStorage`; no-ops during SSR
    - _Requirements: 2.4_

  - [x] 1.2 Create `src/components/shared/OutletSwitcher.tsx`
    - Accept props: `outlets: Outlet[]`, `currentOutletId: string`, `onOutletChange: (id: string) => void`, `isLoading?: boolean`, `className?: string`
    - Render nothing when `outlets.length === 0`
    - Render a static `<span>` with outlet name when `outlets.length === 1`
    - Render a `<select>` populated with all outlets when `outlets.length >= 2`; call `onOutletChange` on change
    - Show a `<Loader2>` spinner adjacent to the select when `isLoading === true`
    - Forward `className` to the wrapper element for responsive sizing
    - _Requirements: 2.1, 2.2, 2.3, 15.4_

  - [x] 1.3 Create `src/components/shared/EmptyState.tsx`
    - Accept props: `icon?: LucideIcon`, `title: string`, `description?: string`, `action?: { label: string; onClick?: () => void; href?: string }`
    - Render a centred flex column: icon (if provided), title, description (if provided), and an optional primary `Button`
    - When `action.href` is provided, render a `<Link>` inside the button; otherwise use `onClick`
    - _Requirements: 1.10, 4.8, 6.6, 7.6, 8.6, 9.5, 12.6, 13.6_

  - [x] 1.4 Create `src/components/shared/PageErrorBoundary.tsx`
    - Implement as a React class component (required for error boundaries)
    - Accept props: `children: ReactNode`, `pageName?: string`
    - State: `{ hasError: boolean; errorMessage: string }`
    - On caught error: render an error card with message `"The {pageName} page encountered an error"` and a "Try Again" button that resets `hasError` to `false`
    - _Requirements: 13.1, 13.2_

  - [x] 1.5 Enhance `src/lib/api-client.ts` with AbortController timeout and network error handling
    - Create an `AbortController` before each fetch; set a 30-second timeout with `setTimeout(() => controller.abort(), 30_000)`; pass `signal` to `fetch`; call `clearTimeout` after fetch resolves
    - In the `catch` block: if the error is a `DOMException` with `name === "AbortError"`, return `{ success: false, message: "Request timed out. Check your network connection and try again." }`
    - For all other caught errors, preserve the existing `"Network error occurred"` message path
    - _Requirements: 13.5_

  - [x] 1.6 Wire `PageErrorBoundary` into `src/app/(dashboard)/layout.tsx`
    - Import `PageErrorBoundary` from `@/components/shared/PageErrorBoundary`
    - Wrap only the `{children}` div (the `className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto"` element) with `<PageErrorBoundary>`
    - Do not wrap the sidebar or topbar
    - _Requirements: 13.1_

  - [ ]* 1.7 Write unit tests for `outlet-context.ts`
    - Mock `localStorage` and `window` (undefined during SSR)
    - Test `getPersistedOutletId` returns `null` when key is absent, returns stored value when present, returns `null` when `window` is undefined
    - Test `setPersistedOutletId` writes the value, no-ops when `window` is undefined
    - _Requirements: 2.4_

- [ ] 2. Outlets page — Franchise hierarchy view (Req 1)
  - [ ] 2.1 Restructure `src/app/(dashboard)/outlets/page.tsx` to load franchises and group outlets by `franchiseId`
    - Fetch `GET /franchises` and `GET /outlets` in parallel on mount
    - Build a `Map<franchiseId, Outlet[]>` client-side
    - Replace the flat outlets table with a vertical stack of shadcn/ui `Card` components — one per franchise — each listing its child outlets
    - Each outlet row displays: name, address, active/inactive badge, and most recent sync timestamp (if available)
    - Retain the existing "Edge Sync Monitor" `Tab` alongside the hierarchy using the existing `Tabs` component
    - _Requirements: 1.1, 1.9, 1.11_

  - [ ] 2.2 Add "New Franchise" dialog and "Edit Franchise" dialog to the Outlets page
    - "New Franchise" button in the page header opens a dialog with: name field (required, max 100 chars) and description field (optional, max 500 chars); validate with zodResolver inline schema; call `POST /franchises` on submit
    - Edit icon button on each franchise card header opens a pre-populated edit dialog; call `PUT /franchises/:id` on submit
    - On success: update local franchises state without full page reload
    - On validation failure: show inline field-level error; do not close the dialog
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [ ] 2.3 Add "New Outlet" per-franchise action and cascade-delete warning for franchises
    - "+ New Outlet" button in each franchise card header opens the existing outlet creation dialog with `franchiseId` pre-filled and the field hidden
    - Delete action on a franchise with zero outlets: single `Dialog` confirmation → `DELETE /franchises/:id`
    - Delete action on a franchise that has existing outlets: warning `Dialog` explicitly listing cascade impact → requires "Delete All" button click before proceeding
    - When a franchise section has zero outlets: render `<EmptyState>` with "+ Add Outlet" CTA inside the card body
    - _Requirements: 1.6, 1.7, 1.8, 1.10_

- [ ] 3. Menu page improvements (Req 2, 3)
  - [x] 3.1 Add `OutletSwitcher` to `src/app/(dashboard)/menu/page.tsx` with outlet-change data reload
    - Import `getPersistedOutletId` / `setPersistedOutletId` from `@/lib/outlet-context`
    - Initialise `currentOutletId` from persisted value (fall back to first outlet)
    - Add an `OutletSwitcher` component at the top of the page above the action buttons; pass `isLoading` while data is fetching
    - On outlet change: persist new ID, set `isLoading` on the switcher, re-fetch categories and items in parallel, clear previous state before setting new results
    - On fetch failure or timeout (>5 s): clear loading state, show inline error banner, retain previously displayed data
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2_

  - [ ] 3.2 Add category filter row with count badges to the Menu page
    - Render a horizontal scrollable row of pill buttons above the items table: "All" pill + one pill per category for the selected outlet
    - Each category pill shows a count badge: number of items in that category for the current outlet
    - Active pill: `bg-blue-600 text-white`; inactive pill: `bg-gray-100 text-gray-700`
    - Clicking a pill filters displayed rows client-side (no API re-fetch); "All" shows all items
    - When filtered + empty result: render `<EmptyState>` with "+ Add Menu Item" CTA
    - _Requirements: 3.3, 3.4, 3.7, 3.8_

  - [ ] 3.3 Add inline availability toggle with optimistic update to the Menu page
    - Add a `<Switch>` component in each menu item table row bound to `item.isAvailable`
    - On toggle: optimistically update local state; call `PUT /menu/items/:id` with `{ isAvailable: newValue }`
    - On success: leave the optimistic state
    - On failure: revert toggle to previous value; call `toast({ variant: "error" })`
    - _Requirements: 3.5, 3.6_

- [ ] 4. Tables page improvements (Req 2, 4)
  - [ ] 4.1 Add `OutletSwitcher` to `src/app/(dashboard)/tables/page.tsx` with outlet-change data reload
    - Same persistence pattern as Menu page (outlet-context.ts)
    - On outlet change: clear `tables` state, show switcher loading state, re-fetch `GET /tables?outletId=`
    - No tables for outlet: render `<EmptyState>` with "+ Add Table" CTA (opens existing create dialog)
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 4.1, 4.2, 4.8_

  - [ ] 4.2 Add Bulk Status Update dialog to the Tables page
    - Add "Bulk Status Update" button in the page header
    - Dialog contains: a `<select>` for section (derived from distinct `table.section` values for current outlet) and a `<select>` for target status with options AVAILABLE and CLEANING only
    - If selected section has 0 tables: disable confirm button and show inline message
    - On confirm: iterate tables in section, fire concurrent `PUT /tables/:id` requests, show progress text "Updating X of Y tables…" updated after each response, refresh affected table cards on completion, show success toast
    - Partial failure: show error toast "X table(s) failed to update"; successfully updated tables retain new status
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7_

- [ ] 5. Staff page improvements (Req 5)
  - [x] 5.1 Extract `getRoleBadgeClass` and `resolveOutletName` as pure functions in `src/lib/staff-utils.ts`
    - `getRoleBadgeClass(role: string): string` — returns `"bg-blue-100 text-blue-800"` for MANAGER, `"bg-gray-100 text-gray-700"` for CASHIER, `"bg-green-100 text-green-800"` for WAITER, `"bg-orange-100 text-orange-800"` for CHEF, `"bg-gray-100 text-gray-600"` for any other value
    - `resolveOutletName(outletId: string | null | undefined, outlets: Outlet[]): string` — returns matched outlet name, `"Global"` when outletId is null/undefined, `"Unknown Outlet"` when not found in array
    - _Requirements: 5.1, 5.2_

  - [x] 5.2 Apply role badges, outlet column, inactive row styling, and search to `src/app/(dashboard)/staff/page.tsx`
    - Import `getRoleBadgeClass` and `resolveOutletName` from `@/lib/staff-utils`
    - Replace the existing flat `bg-gray-100 text-gray-800` badge in the role cell with `getRoleBadgeClass(employee.role)` applied dynamically
    - Add an "Outlet" column between Role and Status; render resolved outlet name using `resolveOutletName`
    - Add `opacity-40` to `<TableRow>` for inactive employees (in addition to the existing Inactive badge)
    - Add a search `<Input>` above the table; `filterStaff(staff, query)` filters client-side on `name`, `email`, `role` (case-insensitive substring); show `<EmptyState title="No results found">` when no rows match
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 5.3 Replace "Permission UI editor coming soon" with a static read-only permission matrix table
    - Define `ROLE_PERMISSIONS` constant in the component covering MANAGER, CASHIER, WAITER, CHEF × 6 permissions: View Reports, Edit Menu, Manage Staff, Process Orders, View Orders, Manage Inventory
    - Render as a `<Table>` with role columns and permission rows; each cell shows a green ✓ or red ✗ icon
    - _Requirements: 5.5_

  - [ ]* 5.4 Write unit tests and property tests for `staff-utils.ts`
    - Unit test: `getRoleBadgeClass` returns correct class for all four defined roles and returns fallback for an arbitrary string
    - Unit test: `resolveOutletName` returns name when matched, "Global" for null/undefined, "Unknown Outlet" for unmatched string
    - **Property 1:** For any role string, `getRoleBadgeClass(role)` returns a non-empty string; for each of the four defined roles it returns the specific expected class; for any other string it returns the neutral fallback
    - **Property 2:** For any `outletId` value (null, undefined, arbitrary string) and any `Outlet[]` array, `resolveOutletName` returns exactly the matched name when found, "Global" when outletId is null/undefined, "Unknown Outlet" when outletId is a non-null string not in the array — and never throws
    - _Requirements: 5.1, 5.2_

- [ ] 6. Inventory — Recipe improvements (Req 6)
  - [x] 6.1 Extract `calculateRecipeCost` and `countConfiguredRecipes` as pure functions in `src/lib/recipe-utils.ts`
    - `calculateRecipeCost(ingredients: { quantity: number; costPerUnit: number }[]): number` — returns `Math.round(sum(q × c) × 100) / 100`; returns `0` for empty array
    - `countConfiguredRecipes(menuItems: MenuItem[], recipes: Recipe[]): { configured: number; total: number }` — configured = count of menuItems whose id appears in recipes; total = menuItems.length
    - _Requirements: 6.1, 6.5_

  - [x] 6.2 Update `src/components/inventory/RecipeManagerModal.tsx` with live cost display, error resilience, and save-without-close on failure
    - Add `watch` on all ingredient fields; compute estimated cost via `calculateRecipeCost` on each render using `inventoryItems` lookup for `costPerUnit`; display `₹{cost.toFixed(2)}` in the modal header area
    - Change `handleSave`: on failure, do NOT call `onClose`; keep modal open with all field values intact; show `toast({ variant: "error" })` with server message
    - On success: call `onSave()` then `onClose()`
    - _Requirements: 6.5, 6.6, 6.8_

  - [ ] 6.3 Add recipe coverage counter and unconfigured-row highlighting to the Recipes tab in `src/app/(dashboard)/inventory/page.tsx`
    - In the Recipes tab `CardHeader`: display summary text "X of Y menu items have recipes configured" using `countConfiguredRecipes`
    - Apply `className="bg-amber-50/50"` to `<TableRow>` for menu items with no recipe (those where `recipes.find(r => r.menuItemId === item.id)` is undefined)
    - _Requirements: 6.1, 6.2_

  - [ ]* 6.4 Write unit tests and property tests for `recipe-utils.ts`
    - Unit test: `calculateRecipeCost` correctly sums quantities × costPerUnit, rounds to 2 decimal places, returns 0 for empty array
    - Unit test: `countConfiguredRecipes` returns correct configured/total counts
    - **Property 4:** For any array of `{ quantity: number; costPerUnit: number }[]` with non-negative values, `calculateRecipeCost` equals `Math.round(sum(q × c) × 100) / 100` and returns `0.00` for empty array
    - **Property 5:** For any `MenuItem[]` and `Recipe[]`, `countConfiguredRecipes` returns `{ configured: N, total: M }` where `N <= M` always holds
    - _Requirements: 6.1, 6.5, 6.6_

- [ ] 7. Inventory — Vendors tab (Req 7)
  - [ ] 7.1 Replace the Vendors "coming soon" stub in `src/app/(dashboard)/inventory/page.tsx` with a full vendors CRUD UI
    - Load `GET /vendors` lazily (only when `activeTab === "vendors"` and vendors not yet loaded), store in `vendors` state
    - Render a vendors table: Name, Email, Phone, Address, Actions (Edit, Delete)
    - "Add Vendor" dialog: name (required, max 100 chars), email (optional, valid format), phone (optional, max 20 chars), address (optional); validate with inline zod schema
    - Delete: confirmation dialog → `DELETE /vendors/:id` → filter from state on success
    - All mutation errors: show `toast({ variant: "error" })`; preserve current list state
    - Zero vendors: render `<EmptyState icon={Truck} title="No vendors yet" action={{ label: "Add First Vendor", onClick: openCreateVendorModal }}>` 
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 8. Inventory — Purchase Orders tab (Req 8)
  - [x] 8.1 Extract `calculatePOTotal` as a pure function in `src/lib/po-utils.ts`
    - `calculatePOTotal(lineItems: { quantity: number; unitPrice: number }[]): number` — returns `Math.round(sum(q × p) × 100) / 100`; returns `0` for empty array
    - _Requirements: 8.3_

  - [ ] 8.2 Replace the Purchase Orders "coming soon" stub in `src/app/(dashboard)/inventory/page.tsx` with a full PO CRUD UI
    - Load `GET /purchase-orders` lazily on tab activation
    - PO table: PO Number, Vendor Name (resolved from loaded vendors), Total Value (via `calculatePOTotal`), Status badge, Created Date
    - RECEIVED rows: Edit and Delete actions disabled; show "View GRN" text link
    - "Create PO" dialog using `useFieldArray` for line items: vendor selector (from vendors state), expected delivery date, dynamic line items (inventory item selector, quantity int 1–9999, unit price 0.01–999999.99); min 1 max 50 line items; submit disabled unless vendor + date + ≥1 line item are filled
    - On failure: keep form open, preserve all values, show error toast
    - Zero POs: `<EmptyState>` with "Create First PO" CTA
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 8.3 Write unit tests and property tests for `po-utils.ts`
    - Unit test: `calculatePOTotal` sums correctly, rounds to 2 decimal places, returns 0 for empty array
    - **Property 6:** For any line items array with quantity (int 1–9999) and unitPrice (0.01–999999.99), `calculatePOTotal` equals `Math.round(sum(q × p) × 100) / 100`
    - _Requirements: 8.3_

- [ ] 9. Inventory — GRNs tab (Req 9)
  - [ ] 9.1 Replace the GRNs "coming soon" stub in `src/app/(dashboard)/inventory/page.tsx` with a full GRN creation UI
    - Load `GET /grns` lazily on tab activation
    - GRN table: GRN Number, PO Number, Received Date, Supplier Name, Total Items Received
    - "New GRN" dialog: PO selector (only POs with status OPEN or PARTIALLY_RECEIVED), on PO select fetch PO line items, render each with ordered quantity and received quantity field (0.001–99999, 3 decimal places)
    - Inline validation: if received quantity > remaining ordered quantity, show field-level error; disable submit
    - Submit disabled unless ≥1 line item has received quantity > 0
    - On successful save: re-fetch `/inventory` to refresh Raw Materials tab stock levels; refresh GRN list
    - On failure: keep dialog open, preserve values, show error toast
    - Zero GRNs: `<EmptyState>` with "Record First GRN" CTA
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 10. Checkpoint — Shared infrastructure and inventory complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Orders page improvements (Req 2, 10)
  - [x] 11.1 Extract `filterOrders` as a pure function in `src/lib/order-utils.ts`
    - `filterOrders(orders: Order[], query: string): Order[]` — returns full list for empty query; otherwise returns rows where `order.orderNumber.toLowerCase().startsWith(query.toLowerCase())` OR `(order.customerName ?? "").toLowerCase().includes(query.toLowerCase())`
    - _Requirements: 10.4_

  - [ ] 11.2 Add OutletSwitcher, date range filter, search, table name resolution, and row highlighting to `src/app/(dashboard)/orders/page.tsx`
    - Import `getPersistedOutletId` / `setPersistedOutletId` and `filterOrders`
    - Add `<OutletSwitcher>` as the first element in the filter bar
    - Add two `<Input type="date">` fields (from / to) defaulting to today; max range 90 days with inline validation message when exceeded; re-fetch `GET /orders?outletId=&from=&to=` on apply
    - Load `GET /tables?outletId=` alongside orders; resolve `order.tableId` → table name in the table column; display "—" when unresolved
    - Add search `<Input>` (max 100 chars) above the table using `filterOrders`; filter on each keystroke
    - Apply `className="bg-blue-50/60"` to `<TableRow>` when `order.status === "PLACED" || order.status === "IN_PROGRESS"`
    - _Requirements: 2.1, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 11.3 Write unit tests and property tests for `order-utils.ts`
    - Unit test: `filterOrders` with empty query returns full list; with a matching prefix returns matching rows; with no match returns empty array
    - **Property 7:** For any orders list and any query up to 100 chars, `filterOrders` returns only rows where orderNumber starts with query (case-insensitive) OR customerName contains query (case-insensitive); no matching row is omitted; for empty query the full list is returned unchanged
    - _Requirements: 10.4_

- [ ] 12. HR pages (Req 2, 11)
  - [ ] 12.1 Add `OutletSwitcher` and outlet persistence to `src/app/(dashboard)/hr/page.tsx` (Shifts)
    - Import `getPersistedOutletId` / `setPersistedOutletId`; initialise `currentOutletId` from persisted value
    - Add `<OutletSwitcher>` above the existing shift actions; on outlet change: persist, reload `GET /hr/shifts?outletId=`
    - _Requirements: 2.1, 2.2, 2.4_

  - [ ] 12.2 Create `src/app/(dashboard)/hr/attendance/page.tsx` — HR Attendance page
    - Load outlets on mount, initialise with persisted outlet ID; show `<OutletSwitcher>`
    - Date filter defaulting to today's date; fetch `GET /hr/attendance?outletId=&date=YYYY-MM-DD`
    - Attendance table: Employee Name, Shift, Clock In, Clock Out, Duration, Status
    - "Record Attendance" button → dialog with: employee selector (`GET /users?outletId=`), shift selector (`GET /hr/shifts?outletId=`), date, clock-in time, clock-out time (optional); call `POST /hr/attendance`
    - Navigation links to Shifts and Payroll in the page header (matching existing hr/page.tsx pattern)
    - _Requirements: 2.1, 2.2_

  - [ ] 12.3 Create `src/app/(dashboard)/hr/payroll/page.tsx` — HR Payroll page with Approve/Mark Paid workflow and summary row
    - Load outlets; show `<OutletSwitcher>`
    - Month selector `<Input type="month">` defaulting to current month in `YYYY-MM` format
    - Fetch `GET /hr/payrolls?outletId=&month=YYYY-MM`
    - Payroll table: Employee Name (resolved or fallback to employee ID), Base Salary, Deductions, Bonuses, Net Salary, Status badge, Action button
    - CALCULATED row: "Approve" button → `PUT /hr/payrolls/:id` `{ status: "APPROVED" }` → update row on success; toast error without changing row on failure
    - APPROVED row: "Mark Paid" button → `PUT /hr/payrolls/:id` `{ status: "PAID", paidAt: new Date().toISOString() }` → update row on success; toast error on failure
    - Summary row pinned at table bottom using `<tfoot>`: sums of base salary, deductions, bonuses, net salary across all visible rows; zeros when empty
    - Extract `calculatePayrollSummary` as a pure function in `src/lib/payroll-utils.ts`
    - Navigation links to Shifts and Attendance in page header
    - Zero payroll rows: `<EmptyState>` describing that payroll is generated from shifts and attendance
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 12.4 Write unit tests and property tests for `payroll-utils.ts`
    - Unit test: `calculatePayrollSummary` sums all fields correctly; returns zeros for empty array
    - **Property 8:** For any array of payroll records, `calculatePayrollSummary` returns `{ totalBaseSalary, totalDeductions, totalBonuses, totalNetSalary }` where each value equals the exact sum of the corresponding field across all records; all values are `0` when the array is empty
    - _Requirements: 11.5_

- [ ] 13. CRM Loyalty page (Req 12)
  - [ ] 13.1 Create `src/app/(dashboard)/crm/loyalty/[customerId]/page.tsx` — CRM Loyalty viewer
    - On mount: fetch `GET /customers/:customerId` and `GET /crm/loyalty/:customerId/transactions` in parallel
    - Display: customer name, current loyalty points balance (large prominent number), transaction history table in reverse chronological order
    - Transaction table: Date, Type (EARN/BURN/ADJUSTMENT), Points (signed, colored), Description, Running Balance
    - "Adjust Points" button → dialog: adjustment amount (integer, -10000 to +10000, non-zero, zodResolver), reason (1–255 chars); call `POST /crm/loyalty/:customerId/adjust`; on success: update balance display and prepend new transaction
    - On failure: show error toast; preserve balance and history unchanged
    - "← Back to Customers" link using `<Link>` at the top of the page
    - Zero transactions: `<EmptyState title="No loyalty history yet">`
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6_

  - [ ] 13.2 Update "View Loyalty" navigation in `src/app/(dashboard)/customers/page.tsx` to use `router.push`
    - Add `import { useRouter } from "next/navigation"`; initialise `const router = useRouter()`
    - Replace `window.location.href = /crm/loyalty/${customer.id}` with `router.push(\`/crm/loyalty/\${customer.id}\`)`
    - _Requirements: 12.2_

- [ ] 14. Checkpoint — Orders, HR, and CRM complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Cross-cutting: inline error banners and no-outlet empty states (Req 13)
  - [ ] 15.1 Standardise inline error banners across all modified pages
    - Ensure every page that calls `apiFetch` displays the existing red banner pattern (⚠️ icon + message) when `success === false`; add a "Retry" `Button` that re-calls the load function for pages that don't yet have one
    - No-outlet check: pages Menu, Tables, HR Shifts, HR Attendance, HR Payroll, Orders — after outlets load, if `outlets.length === 0`, render `<EmptyState title="No outlets configured" description="..." action={{ label: "Go to Outlets", href: "/outlets" }}>` instead of the page content
    - _Requirements: 13.3, 13.6_

- [ ] 16. Cross-cutting: search, filter & pagination consistency (Req 14)
  - [ ] 16.1 Add client-side search to Inventory (Raw Materials) and Menu Item list pages
    - Inventory Raw Materials tab: add search `<Input>` above the table; filter on `name` field (case-insensitive); show `<EmptyState title="No results found">` when empty
    - Menu Items: already filtered by category pill (task 3.2); add additional text search on `name` field that works in combination with the category filter
    - _Requirements: 14.1, 14.2, 14.5_

  - [ ] 16.2 Ensure pagination controls are hidden when total items ≤ 25 on all paginated pages
    - Check Staff page and Customers page pagination logic: show pagination `div` only when `totalPages > 1` AND total item count > 25
    - Apply the same guard to new paginated lists (Vendors, Purchase Orders) implemented in tasks 7.1 and 8.2
    - Display total matching item count in the `CardDescription` or header of each list page
    - _Requirements: 14.3, 14.4, 14.5_

- [ ] 17. Cross-cutting: mobile responsiveness (Req 15)
  - [ ] 17.1 Add `overflow-x-auto` to all table wrapper `CardContent` components on modified pages
    - Update `CardContent` `className` from `"p-0"` to `"p-0 overflow-x-auto"` on: Menu, Tables (section cards), Staff, Inventory (all tabs with tables), Orders, HR pages, Customers, CRM Loyalty
    - _Requirements: 15.1_

  - [ ] 17.2 Fix KPI grid responsive breakpoints and dialog mobile styles
    - Customers page summary cards: change `grid-cols-3` to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
    - Any other `grid-cols-N` (N ≥ 2) added in this feature: use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` pattern
    - `OutletSwitcher` container on all outlet-scoped pages: add `className="sm:w-auto w-full"` so the switcher spans full width below 640 px
    - _Requirements: 15.2, 15.4_

- [ ] 18. Property-based tests for remaining correctness properties (Req Correctness)
  - [ ]* 18.1 Write property tests for `filterStaff` (Property 3)
    - The `filterStaff(staff, query)` function should already exist in `staff-utils.ts` after task 5.2; if extracted separately, ensure it is importable
    - **Property 3:** For any array of staff members and any non-empty query, `filterStaff` returns a subset where every row contains the query in name, email, or role (case-insensitive), and no matching row is omitted
    - _Requirements: 5.3, 14.2_

  - [ ]* 18.2 Write property tests for `calculateRecipeCost` (Property 4) and `countConfiguredRecipes` (Property 5)
    - These functions were extracted in task 6.1; property tests were added in task 6.4 — this task ensures they are included in the test suite and wired to the vitest run
    - Confirm `fc.assert` with `numRuns: 100` for each property
    - _Requirements: 6.1, 6.5, 6.6_

  - [ ]* 18.3 Write property tests for `calculatePOTotal` (Property 6)
    - Function extracted in task 8.1; property test added in task 8.3 — wire into vitest run
    - _Requirements: 8.3_

  - [ ]* 18.4 Write property tests for `filterOrders` (Property 7)
    - Function extracted in task 11.1; property test added in task 11.3 — wire into vitest run
    - _Requirements: 10.4_

  - [ ]* 18.5 Write property tests for `calculatePayrollSummary` (Property 8)
    - Function extracted in task 12.3; property test added in task 12.4 — wire into vitest run
    - _Requirements: 11.5_

- [ ] 19. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; property tests require `fast-check` (`npm install -D fast-check` in `apps/web-admin`)
- All new utility functions must be co-located in `src/lib/` so they are independently importable by tests
- Outlet persistence (`outlet-context.ts`) must be implemented before any outlet-switcher page task
- The `PageErrorBoundary` (task 1.4) must be wired into layout.tsx (task 1.6) before deploying any page changes
- Checkpoints at tasks 10 and 14 are good moments to run `pnpm --filter web-admin build` to catch TypeScript errors early
- `apiFetch` timeout enhancement (task 1.5) is non-breaking — existing call sites need no changes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.6", "1.7", "5.1", "6.1", "8.1", "11.1"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.2", "6.2", "7.1", "8.2", "9.1", "11.2", "12.1", "12.3", "13.2"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.2", "5.3", "6.3", "8.3", "11.3", "12.2", "13.1"] },
    { "id": 4, "tasks": ["2.3", "3.3", "5.4", "6.4", "12.4"] },
    { "id": 5, "tasks": ["15.1", "16.1", "16.2", "17.1", "17.2", "11.3"] },
    { "id": 6, "tasks": ["18.1", "18.2", "18.3", "18.4", "18.5"] }
  ]
}
```
