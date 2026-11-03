# Implementation Plan: Dashboard Daily/Weekly View

## Overview

Refactor `apps/web-admin/src/app/(dashboard)/page.tsx` to add a Daily/Weekly view toggle, per-mode KPI metrics with comparison badges, a mode-aware main chart, and a permanent weekly trend line chart rendered in raw SVG. All changes are contained within the single page file.

## Tasks

- [x] 1. Add helper functions and derived types
  - [x] 1.1 Add `ViewMode` type, `getDayBounds` helper, and `computeChange` helper inside `page.tsx`
    - Define `type ViewMode = "Daily" | "Weekly"` at the top of the file
    - Implement `getDayBounds(daysAgo: number): { start: Date; end: Date }` using local midnight boundaries
    - Implement `computeChange(curr: number, prev: number): number | null` returning `null` when both are zero, `100` when only prev is zero, and `Math.round(((curr - prev) / prev) * 100)` otherwise
    - _Requirements: 3.6, 3.7, 3.8, 3.9, 3.10, 4.6, 4.7, 4.8_

- [x] 2. Add `viewMode` state and KPI `useMemo` hooks
  - [x] 2.1 Add `viewMode` state initialised to `"Daily"` and compute `dailyMetrics` and `weeklyMetrics` via `useMemo`
    - Add `const [viewMode, setViewMode] = useState<ViewMode>("Daily")` to the component
    - Implement `dailyMetrics` useMemo (today vs yesterday completed orders — revenue, count, avg, change values)
    - Implement `weeklyMetrics` useMemo (last 7 days vs prior 7 days completed orders — revenue, count, avg, change values)
    - Derive `activeMetrics` and `period` from `viewMode`
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

  - [ ]* 2.2 Write property test for daily revenue computation
    - **Property 2: Daily revenue computation correctness**
    - **Validates: Requirements 3.2**
    - For any orders array, `dailyMetrics.revenue` must equal the manual sum of `totalAmount` for COMPLETED orders with `createdAt` within today's calendar day

  - [ ]* 2.3 Write property test for `computeChange` badge logic
    - **Property 3: Comparison badge percentage and styling**
    - **Validates: Requirements 3.6, 3.7, 3.8, 3.9, 3.11, 4.6, 4.7, 4.8**
    - For any `(curr, prev)` pair not both zero, `computeChange` returns `round((curr−prev)/prev×100)` or `100` when prev=0

  - [ ]* 2.4 Write property test for weekly KPI computation
    - **Property 4: Weekly KPI computation correctness**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - For any orders array, `weeklyMetrics.revenue` must equal the manual sum of `totalAmount` for COMPLETED orders in the last 7 calendar days

- [x] 3. Add `ComparisonBadge` component and `WeeklyTrendChart` SVG component
  - [x] 3.1 Implement `ComparisonBadge` inline in `page.tsx`
    - Render nothing when `change` is `null`
    - Apply `text-emerald-700 bg-emerald-50` for positive/zero change
    - Apply `text-red-700 bg-red-50` for negative change
    - Format as `"+X% vs {period}"` or `"−X% vs {period}"`
    - _Requirements: 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.6, 4.7, 4.8_

  - [x] 3.2 Implement `WeeklyTrendChart` SVG component inline in `page.tsx`
    - Use `viewBox="0 0 500 180"` with `width="100%"`
    - Draw 5 horizontal grid lines (slate-100)
    - Render last-week polyline (gray, dashed `strokeDasharray="4 3"`)
    - Render this-week polyline (blue `#3b82f6`, solid)
    - Render circle data points for this-week with `<title>` tooltip
    - Render Mon–Sun x-axis labels
    - Render inline legend (blue rect + "This Week", dashed line + "Last Week")
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 3.3 Write property test for weekly trend series data correctness
    - **Property 6: Weekly trend series data correctness**
    - **Validates: Requirements 7.2, 7.3**
    - For any orders array, each data point at index `i` in both series must equal the manual sum for that calendar day

- [x] 4. Checkpoint — core logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Render ViewToggle and update KPI Cards
  - [x] 5.1 Add the `ViewToggle` pill above the main chart and replace the four KPI cards
    - Render two `<button>` elements in a rounded pill container using `cn()` for active/inactive styles
    - Active segment: `bg-white text-gray-900 shadow-sm`; inactive: `text-gray-500 hover:text-gray-700`
    - Replace the existing four KPI cards (Weekly Revenue, Active Outlets, Organization, Total Staff) with: Revenue, Orders, Avg Order Value, Active Outlets
    - Each card shows the value from `activeMetrics`, a spinner when `loading`, and a `<ComparisonBadge>` for the three computed metrics
    - Active Outlets card shows `outlets.filter(o => o.isActive).length` with no badge
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.5, 4.1, 4.5, 8.1_

  - [ ]* 5.2 Write unit tests for toggle rendering and KPI card display
    - Verify default `viewMode` is `"Daily"` on mount
    - Verify exactly two segment buttons with correct labels
    - Verify clicking each segment updates `viewMode` correctly
    - Verify active segment has `bg-white` class and inactive does not
    - Verify `ComparisonBadge` renders nothing when both values are zero
    - _Requirements: 1.1, 1.2, 2.1, 2.3, 2.4, 3.10_

  - [ ]* 5.3 Write property test for toggle active style exclusivity
    - **Property 1: Toggle active style exclusivity**
    - **Validates: Requirements 2.4**
    - For any `viewMode`, the active segment has the active class and the other does not

- [x] 6. Update main chart to be mode-aware and add Weekly Trend Section
  - [x] 6.1 Parameterise the existing bar chart and add `dailyBarData` useMemo
    - Compute `dailyBarData` (single bar, `[{ day: "Today", value: todayRevenue }]`)
    - Derive `chartData`, `chartTitle`, `chartSubtitle`, and `maxChartValue` based on `viewMode`
    - Update bar chart JSX to use `chartData` / `maxChartValue` / `chartTitle` / `chartSubtitle`
    - Show spinner in the chart area while `loading`
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 8.2_

  - [x] 6.2 Add `weeklyTrendData` useMemo and render the Weekly Trend Section card
    - Compute `weeklyTrendData` with `thisWeek` (7 values from this Monday) and `lastWeek` (7 values from last Monday) using completed-order revenue sums
    - Render a new `<Card>` below the main chart + activity row with title "Weekly Growth" and subtitle "Revenue comparison: this week vs last week"
    - Pass `weeklyTrendData` into `<WeeklyTrendChart>`, always visible regardless of `viewMode`
    - Show `<Loader2>` spinner in card while `loading`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.3_

  - [ ]* 6.3 Write unit tests for chart title/subtitle and Weekly Trend Section visibility
    - Verify chart title and subtitle update correctly per mode
    - Verify the Weekly Trend Section card is present in both "Daily" and "Weekly" renders
    - _Requirements: 5.2, 5.3, 6.2, 6.3, 7.1, 7.5, 7.6_

  - [ ]* 6.4 Write property test for Weekly Trend Section visibility invariant
    - **Property 5: Weekly Trend Section visibility invariant**
    - **Validates: Requirements 7.1**
    - For any `viewMode`, the Weekly Trend Section card must be present in the rendered output

- [x] 7. Verify real-time event handling preserves `viewMode`
  - [x] 7.1 Confirm `useRealtimeEvent` callback does not reset `viewMode` and add an integration test
    - Verify the existing `loadDashboardData` callback in `useRealtimeEvent` does not call `setViewMode`
    - Write an example-based integration test with a mock socket: set `viewMode` to "Weekly", fire an `ORDER_COMPLETED` event, assert `viewMode` remains "Weekly"
    - _Requirements: 9.1_

  - [ ]* 7.2 Write integration test for real-time event preserving View Mode
    - **Property 7: Real-time event preserves View Mode**
    - **Validates: Requirements 9.1**
    - After any listed real-time event and data re-fetch, `viewMode` must be unchanged

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All helper functions and components are defined inline in `page.tsx` — no new files required
- The existing `revenueData` useMemo is kept for the Weekly view; `dailyBarData` is added for the Daily view
- The existing "Organization" and "Total Staff" KPI cards are removed and replaced with "Orders" and "Avg Order Value"
- The `cn` utility from `@/lib/utils` is already available in the project
- Property tests should use `fast-check` (or `vitest-property` if available in the project)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.3"] },
    { "id": 3, "tasks": ["5.1", "6.1", "6.2"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.3", "6.4", "7.1"] },
    { "id": 5, "tasks": ["7.2"] }
  ]
}
```
