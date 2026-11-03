# Design Document

## Overview

This document describes the architecture and implementation plan for the Daily/Weekly toggle feature on the ERP web admin dashboard. The existing dashboard at `apps/web-admin/src/app/(dashboard)/page.tsx` is refactored to support two view modes, a permanent weekly trend line chart rendered in raw SVG, and per-mode KPI computation with comparison badges.

## Architecture

This document describes the architecture and implementation plan for the Daily/Weekly toggle feature on the ERP web admin dashboard. The existing dashboard at `apps/web-admin/src/app/(dashboard)/page.tsx` is refactored to support two view modes, a permanent weekly trend line chart rendered in raw SVG, and per-mode KPI computation with comparison badges.

---

### Overview Detail

The feature is entirely contained within a single Next.js page component (`DashboardOverviewPage`). No new routes, API endpoints, or server-side changes are required. All new logic is client-side state and `useMemo` derivations over the existing `recentOrders` array.

### High-Level Component Tree

```
DashboardOverviewPage
├── Header row
├── Low Stock Warning Banner (conditional)
├── ViewToggle (segmented pill — "Daily" | "Weekly")
├── KPI Cards row (4 cards, values change per viewMode)
├── Main Chart + Activity Feed row
│   ├── RevenueBarChart (title/data change per viewMode)
│   └── Recent Activity feed
├── Weekly Trend Section (always visible, raw SVG line chart)
└── Quick Actions
```

---

## State

| State variable | Type | Initial value | Purpose |
|---|---|---|---|
| `viewMode` | `"Daily" \| "Weekly"` | `"Daily"` | Controls which data slice is displayed on KPI cards and main chart |
| `loading` | `boolean` | `true` | Shows spinners while data is being fetched |
| `org` | `Organization \| null` | `null` | Organization details |
| `outlets` | `Outlet[]` | `[]` | All outlets |
| `staff` | `User[]` | `[]` | All staff |
| `recentOrders` | `Order[]` | `[]` | All orders fetched across all outlets |
| `lowStockItems` | `LowStockItem[]` | `[]` | Inventory items below minimum stock |

No new API calls are added — all derived metrics are computed from `recentOrders` and `outlets` already fetched.

---

## Components and Interfaces

### ViewToggle

A segmented pill rendered as two `<button>` elements inside a `<div>` with a rounded pill container. No external library needed.

```tsx
// Inline in page.tsx — no separate file needed given its simplicity
<div className="inline-flex rounded-full border border-gray-200 bg-gray-100 p-0.5 gap-0.5">
  {(["Daily", "Weekly"] as const).map((mode) => (
    <button
      key={mode}
      onClick={() => setViewMode(mode)}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-150",
        viewMode === mode
          ? "bg-white text-gray-900 shadow-sm"
          : "text-gray-500 hover:text-gray-700"
      )}
    >
      {mode}
    </button>
  ))}
</div>
```

### ComparisonBadge

A small inline badge rendered as a `<span>`. Receives `value` (number, the raw % change) and `period` (`"yesterday"` | `"last week"`).

```tsx
function ComparisonBadge({ change, period }: { change: number | null; period: string }) {
  if (change === null) return null; // both zero — omit
  const isPositive = change >= 0;
  return (
    <span className={cn(
      "inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded-full",
      isPositive ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"
    )}>
      {isPositive ? "+" : ""}{change}% vs {period}
    </span>
  );
}
```

### Weekly Trend Line Chart (raw SVG)

A pure SVG chart. Two `<polyline>` elements are drawn in a fixed 500×160 viewBox. The SVG is `viewBox="0 0 500 160"` with `preserveAspectRatio="none"`, scaled by a `width="100%"` on the container.

```
SVG structure:
  <svg viewBox="0 0 500 180" ...>
    <!-- Grid lines (horizontal, light gray) -->
    <line> × 4
    <!-- This-week polyline (blue) -->
    <polyline points="..." />
    <!-- Last-week polyline (gray dashed) -->
    <polyline points="..." stroke-dasharray="4 3" />
    <!-- X-axis labels (Mon … Sun) -->
    <text> × 7
    <!-- Legend -->
    <rect + text> × 2
    <!-- Data point circles (this week) -->
    <circle> × n
    <!-- Tooltip-style value labels on hover — title element inside circle group -->
  </svg>
```

Point mapping:
- x: `(dayIndex / 6) * 460 + 20` (padding 20 left/right)
- y: `140 - (value / maxValue) * 120` (top padding 20, bottom padding 20, chart height 120)
- When `maxValue === 0`, all points sit at y=140 (baseline)

---

## Data Models

All data consumed by this feature is derived from types already defined in `@gusto/api-contracts`. No new database tables, API endpoints, or shared type definitions are required.

### Derived Types (internal to page.tsx)

```ts
type ViewMode = "Daily" | "Weekly";

interface KpiMetrics {
  revenue: number;
  orders: number;
  avgOrderValue: number;
  revenueChange: number | null; // null = both periods are zero → badge omitted
  ordersChange: number | null;
  avgChange: number | null;
}

interface WeeklyTrendData {
  thisWeek: number[]; // 7 elements, Mon=0 … Sun=6
  lastWeek: number[]; // 7 elements
  labels: string[];   // ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
}
```

---

## Data Computations (useMemo)

All derived values live in `useMemo` hooks keyed on `[recentOrders, viewMode]` or narrower dependencies.

### Date Boundaries Helper

```ts
function getDayBounds(daysAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}
```

### Daily KPI Metrics

```ts
const dailyMetrics = useMemo(() => {
  const today = getDayBounds(0);
  const yesterday = getDayBounds(1);

  const todayOrders = recentOrders.filter(
    (o) => o.status === "COMPLETED" &&
    new Date(o.createdAt) >= today.start &&
    new Date(o.createdAt) < today.end
  );
  const yesterdayOrders = recentOrders.filter(
    (o) => o.status === "COMPLETED" &&
    new Date(o.createdAt) >= yesterday.start &&
    new Date(o.createdAt) < yesterday.end
  );

  const todayRevenue = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
  const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + o.totalAmount, 0);
  const todayCount = todayOrders.length;
  const yesterdayCount = yesterdayOrders.length;
  const todayAvg = todayCount > 0 ? todayRevenue / todayCount : 0;
  const yesterdayAvg = yesterdayCount > 0 ? yesterdayRevenue / yesterdayCount : 0;

  return {
    revenue: todayRevenue,
    orders: todayCount,
    avgOrderValue: todayAvg,
    revenueChange: computeChange(todayRevenue, yesterdayRevenue),
    ordersChange: computeChange(todayCount, yesterdayCount),
    avgChange: computeChange(todayAvg, yesterdayAvg),
  };
}, [recentOrders]);
```

### Weekly KPI Metrics

```ts
const weeklyMetrics = useMemo(() => {
  const windowStart = getDayBounds(6).start; // 7 days ago midnight
  const now = new Date();
  const prevWindowStart = getDayBounds(13).start; // 14 days ago
  const prevWindowEnd = windowStart;

  const thisWeekOrders = recentOrders.filter(
    (o) => o.status === "COMPLETED" &&
    new Date(o.createdAt) >= windowStart &&
    new Date(o.createdAt) <= now
  );
  const prevWeekOrders = recentOrders.filter(
    (o) => o.status === "COMPLETED" &&
    new Date(o.createdAt) >= prevWindowStart &&
    new Date(o.createdAt) < prevWindowEnd
  );

  const thisRevenue = thisWeekOrders.reduce((s, o) => s + o.totalAmount, 0);
  const prevRevenue = prevWeekOrders.reduce((s, o) => s + o.totalAmount, 0);
  const thisCount = thisWeekOrders.length;
  const prevCount = prevWeekOrders.length;
  const thisAvg = thisCount > 0 ? thisRevenue / thisCount : 0;
  const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

  return {
    revenue: thisRevenue,
    orders: thisCount,
    avgOrderValue: thisAvg,
    revenueChange: computeChange(thisRevenue, prevRevenue),
    ordersChange: computeChange(thisCount, prevCount),
    avgChange: computeChange(thisAvg, prevAvg),
  };
}, [recentOrders]);
```

### `computeChange` Helper

```ts
/**
 * Returns the integer % change from prev to curr, or null if both are zero.
 * Returns 100 when prev is 0 and curr > 0.
 */
function computeChange(curr: number, prev: number): number | null {
  if (curr === 0 && prev === 0) return null;
  if (prev === 0) return 100;
  return Math.round(((curr - prev) / prev) * 100);
}
```

### Weekly Trend Line Chart Data

```ts
const weeklyTrendData = useMemo(() => {
  // Current week: Monday of the current calendar week → today
  // Previous week: Monday of last calendar week → Sunday
  const now = new Date();
  const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const mondayOffset = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);

  const series = (weekStart: Date) =>
    Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(weekStart.getTime() + i * 86_400_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const revenue = recentOrders
        .filter((o) => {
          const d = new Date(o.createdAt);
          return o.status === "COMPLETED" && d >= dayStart && d < dayEnd;
        })
        .reduce((s, o) => s + o.totalAmount, 0);
      return revenue;
    });

  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);

  return {
    thisWeek: series(thisMonday),
    lastWeek: series(lastMonday),
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  };
}, [recentOrders]);
```

### Daily Bar Chart Data

```ts
const dailyBarData = useMemo(() => {
  const { start, end } = getDayBounds(0);
  const revenue = recentOrders
    .filter((o) => o.status === "COMPLETED" && new Date(o.createdAt) >= start && new Date(o.createdAt) < end)
    .reduce((s, o) => s + o.totalAmount, 0);
  return [{ day: "Today", value: revenue }];
}, [recentOrders]);
```

---

## KPI Card Rendering

The four KPI cards are driven by a `activeMetrics` derived value:

```ts
const activeMetrics = viewMode === "Daily" ? dailyMetrics : weeklyMetrics;
const period = viewMode === "Daily" ? "yesterday" : "last week";
```

Cards shown in both modes:
1. **Revenue** — `activeMetrics.revenue`, badge `activeMetrics.revenueChange`
2. **Orders** — `activeMetrics.orders`, badge `activeMetrics.ordersChange`
3. **Avg Order Value** — `activeMetrics.avgOrderValue`, badge `activeMetrics.avgChange`
4. **Active Outlets** — `outlets.filter(o => o.isActive).length`, no badge

The existing "Organization" and "Total Staff" cards are removed and replaced with "Orders" and "Avg Order Value" to match requirements.

---

## Main Chart Switching

```tsx
const chartData = viewMode === "Daily" ? dailyBarData : revenueData;
const chartTitle = viewMode === "Daily" ? "Today's Revenue" : "Weekly Revenue";
const chartSubtitle = viewMode === "Daily"
  ? "Completed orders revenue for today"
  : "Sales performance across all outlets (last 7 days)";
const maxChartValue = Math.max(...chartData.map((d) => d.value), 1);
```

The existing bar chart JSX is reused verbatim — only `revenueData` → `chartData`, `maxRevenue` → `maxChartValue`, and the card title/description are parameterised.

---

## Weekly Trend Section SVG

```tsx
function WeeklyTrendChart({
  thisWeek,
  lastWeek,
  labels,
}: {
  thisWeek: number[];
  lastWeek: number[];
  labels: string[];
}) {
  const W = 500, H = 180;
  const PAD_LEFT = 20, PAD_RIGHT = 20, PAD_TOP = 20, PAD_BOTTOM = 40;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;

  const maxVal = Math.max(...thisWeek, ...lastWeek, 1);

  const toX = (i: number) => PAD_LEFT + (i / 6) * chartW;
  const toY = (v: number) => PAD_TOP + chartH - (v / maxVal) * chartH;

  const polyPoints = (series: number[]) =>
    series.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      aria-label="Weekly revenue trend chart"
    >
      {/* Horizontal grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
        <line
          key={frac}
          x1={PAD_LEFT} y1={PAD_TOP + chartH * (1 - frac)}
          x2={W - PAD_RIGHT} y2={PAD_TOP + chartH * (1 - frac)}
          stroke="#f1f5f9" strokeWidth="1"
        />
      ))}

      {/* Last-week polyline (gray, dashed) */}
      <polyline
        points={polyPoints(lastWeek)}
        fill="none"
        stroke="#94a3b8"
        strokeWidth="2"
        strokeDasharray="4 3"
      />

      {/* This-week polyline (blue, solid) */}
      <polyline
        points={polyPoints(thisWeek)}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2.5"
      />

      {/* Data point circles — this week */}
      {thisWeek.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r="3.5" fill="#3b82f6">
          <title>₹{v.toLocaleString("en-IN")}</title>
        </circle>
      ))}

      {/* X-axis labels */}
      {labels.map((label, i) => (
        <text
          key={label}
          x={toX(i)}
          y={H - 10}
          textAnchor="middle"
          fontSize="10"
          fill="#94a3b8"
          fontFamily="sans-serif"
        >
          {label}
        </text>
      ))}

      {/* Legend */}
      <rect x={PAD_LEFT} y={4} width="10" height="3" fill="#3b82f6" rx="1" />
      <text x={PAD_LEFT + 14} y={9} fontSize="9" fill="#64748b" fontFamily="sans-serif">This Week</text>
      <line x1={PAD_LEFT + 72} y1={5.5} x2={PAD_LEFT + 82} y2={5.5} stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" />
      <text x={PAD_LEFT + 86} y={9} fontSize="9" fill="#64748b" fontFamily="sans-serif">Last Week</text>
    </svg>
  );
}
```

---

## Error Handling

- All `apiFetch` responses are guarded by `if (res.success && res.data)` before being set in state (existing pattern, no changes).
- If `recentOrders` is empty, all computed metrics return `0` / `null` gracefully; charts render empty state (flat baseline bar for daily, empty polylines for trend).
- `computeChange(0, 0)` returns `null`, causing `ComparisonBadge` to render nothing — avoids division-by-zero and phantom badges.

---

## File Changes

| File | Action |
|---|---|
| `apps/web-admin/src/app/(dashboard)/page.tsx` | Modify — primary implementation |

No new files are required. Helper functions (`computeChange`, `getDayBounds`, `ComparisonBadge`, `WeeklyTrendChart`) are defined inline in the page file to keep the diff contained and consistent with the existing single-file approach.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Toggle active style exclusivity

*For any* selected `viewMode` ("Daily" or "Weekly"), the selected segment SHALL have the active style class applied and the other segment SHALL have the inactive style class applied — never both active or both inactive at the same time.

**Validates: Requirements 2.4**

---

### Property 2: Daily revenue computation correctness

*For any* array of orders with arbitrary dates, amounts, and statuses, the computed daily revenue SHALL equal exactly the sum of `totalAmount` for orders whose `status` is `"COMPLETED"` and whose `createdAt` falls within today's calendar day (midnight to now).

**Validates: Requirements 3.2**

---

### Property 3: Comparison badge percentage and styling

*For any* pair of numeric values (current, previous) where not both are zero, the comparison badge SHALL display a percentage value equal to `round((current − previous) / previous × 100)` (or `+100` when previous is zero and current > 0), and SHALL apply green styling when the percentage is ≥ 0 and red styling when the percentage is < 0.

**Validates: Requirements 3.6, 3.7, 3.8, 3.9, 3.11, 4.6, 4.7, 4.8**

---

### Property 4: Weekly KPI computation correctness

*For any* array of orders with arbitrary dates, amounts, and statuses, the computed weekly revenue SHALL equal exactly the sum of `totalAmount` for orders whose `status` is `"COMPLETED"` and whose `createdAt` falls within the last 7 calendar days (from 7 days ago midnight to now).

**Validates: Requirements 4.2, 4.3, 4.4**

---

### Property 5: Weekly Trend Section visibility invariant

*For any* value of `viewMode` ("Daily" or "Weekly"), the Weekly Trend Section card SHALL be present and visible in the rendered output.

**Validates: Requirements 7.1**

---

### Property 6: Weekly trend series data correctness

*For any* array of orders with arbitrary dates, amounts, and statuses, each data point in the "This Week" series at index `i` (Monday = 0) SHALL equal exactly the sum of `totalAmount` for orders whose `status` is `"COMPLETED"` and whose `createdAt` falls on calendar day `(thisMonday + i days)`. The same SHALL hold for the "Last Week" series using `(lastMonday + i days)`.

**Validates: Requirements 7.2, 7.3**

---

### Property 7: Real-time event preserves View Mode

*For any* current `viewMode` and any real-time event of type `ORDER_COMPLETED`, `ORDER_CREATED`, `ORDER_CANCELLED`, `ORDERS_MERGED`, `ORDER_MODE_CHANGED`, or `ORDER_COMPLIMENTARY`, after the triggered data re-fetch completes, `viewMode` SHALL remain unchanged from its value before the event.

**Validates: Requirements 9.1**

---

## Testing Strategy

**Unit / example tests** cover:
- Default `viewMode` is `"Daily"` on mount.
- Toggle renders exactly two segments with correct labels.
- Clicking each segment updates `viewMode`.
- Chart title and subtitle update correctly per mode.
- `ComparisonBadge` renders nothing when both values are zero.
- Loading spinners are shown while `loading === true`.

**Property-based tests** (using fast-check or vitest-property) cover:
- For any orders array, `dailyMetrics.revenue` equals manual filter sum (Property 2).
- For any `(curr, prev)` pair, `computeChange` returns correct % and badge styling (Property 3).
- For any orders array, `weeklyMetrics.revenue` equals manual filter sum (Property 4).
- For any `viewMode`, Weekly Trend Section is present in rendered output (Property 5).
- For any orders array, each trend series data point equals manual filter sum (Property 6).

**Integration test** covers:
- After triggering a real-time event, `viewMode` is preserved (Property 7, example-based with mock socket).
