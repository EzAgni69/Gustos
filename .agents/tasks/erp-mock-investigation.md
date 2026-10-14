# ERP Mock Data Investigation Report

## Summary

The **ERP application is `apps/web-admin`** (a Next.js 15 app). It is already substantially connected to the real API gateway at `apps/api-gateway`. The majority of pages make real `apiFetch()` calls through a proper API client. However, **5 pages contain mock fallback data** that silently activates when the API fails, masking connection issues instead of surfacing errors. One additional tab (Tables) has a hardcoded `generateMockTables()` function used both as primary data and as fallback. Several Settings sub-pages save state only locally (no API call). There are also 4 ERP features with stub UIs that show "coming soon" placeholders with no real backend connection.

---

## 1. ERP Application Location

The ERP is **`apps/web-admin`** — a Next.js 15 app. There is no `apps/erp` directory. The app uses:
- **API client**: `apps/web-admin/src/lib/api-client.ts` — a hand-rolled `apiFetch()` wrapper using `fetch`, JWT tokens from a cookie (`gusto_token`), and the env var `NEXT_PUBLIC_API_URL`.
- **No React Query, SWR, or Axios** — plain `useEffect + useState` pattern throughout.
- **Types**: Imported from `@gusto/api-contracts` (workspace package `packages/api-contracts/src/index.ts`).
- **Zod schemas**: Also from `@gusto/api-contracts`, used for form validation via react-hook-form.

---

## 2. API Client Setup

**File**: `apps/web-admin/src/lib/api-client.ts`

- Reads `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001`).
- Appends `/api/v1` if not already present.
- Reads JWT token from the `gusto_token` cookie.
- On 401 response: clears cookie and redirects to `/login`.
- **Production gap**: The cookie is set with `max-age=86400` (24h) and no `Secure` or `HttpOnly` flags. This needs to be addressed for production.

**Env var** (`apps/web-admin`): No `.env` file exists in the app directory. The root `.env` / `.env.example` defines:
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
```
This value must be set to the real cloud API URL in production.

---

## 3. Mock Data Inventory

### ✅ Pages with NO mock data — fully real API calls

| Page | File | API Calls |
|------|------|-----------|
| Dashboard (Overview) | `src/app/(dashboard)/page.tsx` | `GET /organizations/me`, `GET /outlets`, `GET /users`, `GET /inventory`, `GET /orders?outletId=...` |
| Orders | `src/app/(dashboard)/orders/page.tsx` | `GET /outlets`, `GET /orders`, `PUT /orders/:id`, `DELETE /orders/:id` |
| Inventory (Materials + Recipes + Audit) | `src/app/(dashboard)/inventory/page.tsx` | `GET /inventory`, `POST/PUT/DELETE /inventory`, `GET /menu/items`, `GET/POST /recipes`, `GET /stock/transactions` |
| Organizations | `src/app/(dashboard)/organizations/page.tsx` | `GET /auth/me`, `GET /organizations/:id`, `PUT /organizations/:id` |
| Settings (General tab) | `src/app/(dashboard)/settings/page.tsx` | `GET /auth/me`, `GET /organizations/:id`, `PUT /organizations/:id` |
| Login / Register | `src/app/(auth)/login/page.tsx` | `POST /auth/login`, `POST /auth/register` |
| Layout (sidebar) | `src/app/(dashboard)/layout.tsx` | `GET /auth/me` |
| Recipe Manager Modal | `src/components/inventory/RecipeManagerModal.tsx` | `GET /inventory`, `POST /recipes` |

---

### ❌ Pages with MOCK FALLBACK data (silently activates on API failure)

#### 1. Staff Page — `src/app/(dashboard)/staff/page.tsx`, lines 85–98

```typescript
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
```
The API call is `GET /users`. When it fails, a single hardcoded employee appears silently. **Production problem**: a failed API call looks like a success with fake data.

---

#### 2. Menu Page — `src/app/(dashboard)/menu/page.tsx`, lines 112–127

```typescript
// Mock fallback data for visual demo if server is offline
setMenuItems([
  {
    id: "1",
    categoryId: "cat-1",
    outletId: "out-1",
    name: "Margherita Pizza",
    description: "Classic tomato sauce...",
    price: 399.0,
    ...
  }
]);
```
The API calls are `GET /menu/items?outletId=...` and `GET /menu/categories?outletId=...`. A failed request silently shows a fake pizza item.

---

#### 3. Customers Page — `src/app/(dashboard)/customers/page.tsx`, lines 87–100 and lines 169–183

Two separate mock fallbacks:
1. **Load** (line 87): On `GET /customers` failure, shows a fake customer "Rahul Verma" with loyalty points and spend data.
2. **Create** (line 169): On `POST /customers` failure, silently creates a fake local-only customer with a `cust-${Date.now()}` ID that doesn't persist anywhere.

---

#### 4. Outlets Page — `src/app/(dashboard)/outlets/page.tsx`, lines 91–103

```typescript
// Mock fallback data for visual demo if server is offline
setOutlets([
  {
    id: "1",
    organizationId: "org-1",
    franchiseId: "fran-1",
    name: "Downtown Gusto",
    address: "123 Main St, City Center",
    ...
  },
]);
```
On `GET /outlets` failure, one hardcoded outlet appears. This is particularly bad because outlets are used to scope almost all other data (orders, menu, inventory) — if a fake outlet ID is used by other pages, all their API calls will fail silently.

---

#### 5. Organizations Page — `src/app/(dashboard)/organizations/page.tsx`, lines 72–80

```typescript
// Fallback for visual demo if server is offline
setOrganizations([
  {
    id: "1",
    name: "Gusto Global Group",
    slug: "gusto-global",
    gstNumber: "22AAAAA0000A1Z5",
    ...
  },
]);
```
On `GET /auth/me` or `GET /organizations/:id` failure, a fake organization with hardcoded GST number appears.

---

#### 6. Tables Page — `src/app/(dashboard)/tables/page.tsx`, lines 87–100 and 159–162

This is the most egregious mock usage. There is an explicit `generateMockTables()` function that constructs 12 fake tables with hardcoded statuses, sections, IDs (`"table-1"` through `"table-12"`), and capacities. It is invoked:
- When outlets API fails (no outlets returned)
- When `GET /tables?outletId=...` fails

Additionally, on `POST /tables` failure (line 231–239), a new table is added locally with a fake `table-${Date.now()}` ID that doesn't exist in the database.

---

### ⚠️ Settings page — 3 tabs with no real API persistence

| Tab | File location | Issue |
|-----|--------------|-------|
| Notifications | `settings/page.tsx`, `handleSaveNotifications()` | Only shows a toast, saves nothing to any API |
| Billing & Tax | `settings/page.tsx`, `handleSaveBilling()` | Only shows a toast, saves nothing to any API |
| Tax Rules | `settings/page.tsx` | Static hardcoded rules ("GST Standard Split 18%", "Service Charge 5%"); no API; "Add Tax Rule" button is wired to nothing |

**Timezone and Currency** in the General tab also save nothing to the API — only `name` and `gstNumber` are saved via `PUT /organizations/:id`.

---

### 🚧 Stub UIs — "Coming Soon" placeholders with no backend

| Feature | Location |
|---------|----------|
| Inventory > Vendors tab | `inventory/page.tsx` — "Vendor management coming soon" |
| Inventory > Purchase Orders tab | `inventory/page.tsx` — "Purchase order workflow coming soon" |
| Inventory > GRNs tab | `inventory/page.tsx` — "GRN processing coming soon" |
| Outlets > Edge Sync Monitor tab | `outlets/page.tsx` — "Dashboard for sync latency coming soon" |
| Staff > Role & Permissions Matrix tab | `staff/page.tsx` — "Permission UI editor coming soon" |
| Settings > Integrations tab | `settings/page.tsx` — Zomato, Swiggy, Razorpay, Tally all show "Not Connected" with disabled inputs |

---

## 4. Real Backend Services Available

All routes are registered in `apps/api-gateway/src/index.ts` and implemented in `apps/api-gateway/src/routes/`:

| Route File | Endpoints Available |
|-----------|-------------------|
| `auth.routes.ts` | `POST /auth/login`, `POST /auth/register`, `GET /auth/me` |
| `organization.routes.ts` | `GET /organizations/:id`, `PUT /organizations/:id` |
| `franchise.routes.ts` | `GET /franchises`, `POST /franchises`, etc. |
| `outlet.routes.ts` | `GET /outlets`, `POST /outlets`, `PUT /outlets/:id`, `DELETE /outlets/:id` |
| `user.routes.ts` | `GET /users`, `POST /users`, `PUT /users/:id`, `DELETE /users/:id` |
| `menu.routes.ts` | `GET /menu/items`, `POST /menu/items`, `PUT/DELETE /menu/items/:id`, `GET/POST/PUT/DELETE /menu/categories` |
| `table.routes.ts` | `GET /tables`, `POST /tables`, `PUT/DELETE /tables/:id` |
| `customer.routes.ts` | `GET /customers`, `POST /customers`, `PUT/DELETE /customers/:id` |
| `order.routes.ts` | `GET /orders`, `POST /orders`, `PUT/DELETE /orders/:id` |
| `inventory.routes.ts` | `GET/POST/PUT/DELETE /inventory`, `GET /inventory/:id` |
| `recipe.routes.ts` | `GET /recipes`, `POST /recipes` |
| `stock.routes.ts` | `GET /stock/transactions` |
| `hr.routes.ts` | `GET/POST /hr/shifts`, `GET/POST /hr/attendance`, `POST /hr/attendance/clock-in/out`, `GET/POST /hr/payrolls` |
| `crm.routes.ts` | `GET/POST /crm/feedbacks`, `GET/POST/PUT/DELETE /crm/coupons`, `GET/POST /crm/loyalty/:customerId` |
| `reporting.routes.ts` | `GET /reports/sales`, `GET /reports/inventory`, `GET /reports/profitability`, `GET /reports/dashboard` |
| `integration.routes.ts` | `POST /integrations/webhooks/zomato`, `GET/POST/PUT/DELETE /integrations/configs`, `GET /integrations/online-orders` |
| `pos.routes.ts` | POS sync endpoints |
| `sync.routes.ts` | Cloud sync endpoints |

**Notable gap**: The ERP's Reports page (`/reports`) doesn't use the dedicated `/reports/sales`, `/reports/inventory`, or `/reports/dashboard` endpoints. Instead it fetches raw orders and does all aggregation client-side (sequential per-outlet loops). The real reporting endpoints are fully implemented in the API gateway but unused by the ERP.

---

## 5. Missing ERP Pages for Existing API Capabilities

The API gateway has full implementations for the following that have **no corresponding ERP page at all**:

| API Capability | Available Routes | Missing ERP Page |
|---------------|-----------------|-----------------|
| HR — Shifts | `GET/POST /hr/shifts` | No HR module in ERP |
| HR — Attendance | `GET/POST /hr/attendance`, clock-in/out | No attendance page |
| HR — Payroll | `GET/POST/PATCH /hr/payrolls` | No payroll page |
| CRM — Feedback | `GET/POST /crm/feedbacks` | No feedback page |
| CRM — Coupons | full CRUD + validate | No coupons page |
| CRM — Loyalty | earn/redeem/adjust/history | Loyalty points shown in Customers but no management page |
| Online Orders (Zomato etc.) | `GET /integrations/online-orders` | No online orders page |
| Profitability Report | `GET /reports/profitability` | Not shown in Reports page |

---

## 6. Environment Variables

**Required for production** (`apps/web-admin`):
- `NEXT_PUBLIC_API_URL` — must point to the deployed API gateway (e.g. `https://api.gusto.app/api/v1`)

**Root `.env` / `.env.example`** (for api-gateway):
- `DATABASE_URL` — PostgreSQL connection string (required)
- `REDIS_URL` — Redis for BullMQ (required for sync worker)
- `JWT_SECRET` — must be changed from default `"change-me-in-production"`
- `SENTRY_DSN` — optional but referenced in `index.ts`
- Integration keys (commented out): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `ZOMATO_WEBHOOK_SECRET`, `MSG91_AUTH_KEY`

**No `.env` file** exists in `apps/web-admin/` — the root `.env` only covers the API gateway. The web-admin needs its own `.env.local` or `.env.production` with `NEXT_PUBLIC_API_URL`.

---

## 7. Production Readiness Issues Beyond Mock Data

1. **JWT cookie security**: `gusto_token` is set without `Secure` or `HttpOnly` flags — vulnerable in production HTTPS environments.
2. **No error boundaries**: Pages silently show mock data instead of error states, hiding connectivity problems.
3. **Search bar non-functional**: The topbar search in `layout.tsx` is a static `<Input>` with no handler.
4. **Notifications bell non-functional**: The `<Bell>` icon in the topbar has no handler or notification system wired.
5. **Settings not persisted**: Notifications, billing, timezone, currency, and tax rule settings are purely client-side state.
6. **Reports page uses client-side aggregation**: Instead of the dedicated `/reports/sales` and `/reports/dashboard` endpoints, it fetches all raw orders and aggregates in the browser — this will not scale beyond a few hundred orders.
7. **No pagination**: All list APIs support pagination but the ERP uses `limit=100` or `limit=50` everywhere — data will truncate silently at scale.
8. **No real-time updates**: The API gateway has Socket.IO via `cloud-events.ts`, but the ERP never connects to it — order status changes, stock alerts, etc. require a manual page refresh.
9. **Demo credentials hardcoded in login page**: `admin@gusto.dev / admin123` are hardcoded as a "demo login" fill button.
10. **CORS_ORIGIN**: In production, `CORS_ORIGIN` env var must be set to the web-admin domain; currently defaults to `true` (allow all).

---

## 8. Recommendations

### Priority 1 — Remove mock fallbacks (makes failures visible)
1. **Staff/Menu/Customers/Outlets/Organizations/Tables pages**: Replace all `// Mock fallback` blocks with proper error state (`setError(res.message)`) and display an inline error banner. Do **not** silently populate with fake data.
2. **Tables page**: Remove the `generateMockTables()` function entirely. Show an empty state when no tables exist.
3. **Tables create fallback**: Remove the local fake-ID fallback on `POST /tables` failure. Show the toast error only.
4. **Customers create fallback**: Remove local fake-customer creation on `POST /customers` failure.

### Priority 2 — Wire settings to real API
5. **Notifications / Billing tabs in Settings**: These require either a new `PUT /organizations/settings` endpoint or a settings table in the DB.
6. **Timezone and Currency**: Store on the Organization record or a new settings model.
7. **Tax Rules**: The API currently hardcodes GST logic in order creation; a dynamic rules engine endpoint is needed.

### Priority 3 — Connect to real reporting endpoints
8. **Reports page**: Replace the sequential per-outlet order fetching + client-side aggregation with calls to `GET /reports/sales?outletId=...&startDate=...&endDate=...&groupBy=day` and `GET /reports/dashboard?outletId=...`. These are fully implemented in the API gateway but currently unused.

### Priority 4 — Add missing HR and CRM pages
9. **HR module**: Add `/staff` sub-pages for Shifts, Attendance, and Payroll using existing `GET/POST /hr/shifts`, `/hr/attendance`, `/hr/payrolls` routes.
10. **CRM module**: Add Feedback, Coupons, and Loyalty management pages using existing `/crm/feedbacks`, `/crm/coupons`, `/crm/loyalty/:id` routes.

### Priority 5 — Production hardening
11. **Cookie security**: Set `Secure; SameSite=Strict` flags on `gusto_token` in production.
12. **Env file**: Add `apps/web-admin/.env.production` with `NEXT_PUBLIC_API_URL` pointing to the real API.
13. **JWT_SECRET**: Rotate from `change-me-in-production` to a strong random secret before deploy.
14. **Pagination**: Add pagination controls to all list pages (orders, customers, staff, etc.) and use the `page`/`limit` query params supported by the API.
15. **Socket.IO connection**: Add a client-side Socket.IO connection to receive real-time order and stock updates without polling.
16. **CORS**: Set `CORS_ORIGIN` to the production web-admin domain.
17. **Remove demo credentials**: Remove the `admin@gusto.dev / admin123` fill button from the login page before production deploy.
