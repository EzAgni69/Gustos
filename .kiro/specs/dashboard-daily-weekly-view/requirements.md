# Requirements Document

## Introduction

The ERP web admin dashboard currently shows a fixed weekly view for KPI cards (Weekly Revenue, Active Outlets, Organization, Total Staff) and a 7-day bar chart. This feature introduces a Daily/Weekly toggle that lets users switch between a daily snapshot (today vs yesterday) and the existing weekly summary (last 7 days). The default view on page load is Daily. A secondary weekly trend section — a line chart comparing the current week vs the previous week day by day — is added permanently below the main chart area.

## Glossary

- **Dashboard**: The home screen at `/` of the ERP web admin (`apps/web-admin/src/app/(dashboard)/page.tsx`).
- **View Mode**: The currently selected period — either "Daily" or "Weekly".
- **Daily View**: KPI data scoped to today (midnight to now) with a comparison badge showing percentage change vs yesterday.
- **Weekly View**: KPI data scoped to the last 7 calendar days (current behavior for revenue, extended to Orders and Avg Order Value).
- **Toggle**: An inline segmented pill control with two segments — "Daily" and "Weekly" — rendered above the main revenue chart.
- **KPI Card**: One of the four summary cards at the top of the Dashboard (Revenue, Orders, Avg Order Value, Active Outlets).
- **Comparison Badge**: A small inline label on a KPI Card showing the percentage change vs the previous period (e.g., "+8% vs yesterday" or "+12% vs last week").
- **Main Chart**: The bar chart currently titled "Weekly Revenue" rendered in the 4-column card on the Dashboard.
- **Weekly Trend Section**: A separate card below the main chart area containing a line chart comparing current-week revenue vs previous-week revenue, plotted day by day (Mon–Sun).
- **Active Orders**: Orders with status `PLACED` or `IN_PROGRESS`.
- **Completed Orders**: Orders with status `COMPLETED`.
- **recentOrders**: The in-memory array of orders loaded via `apiFetch` from all outlets.

## Requirements

### Requirement 1: Default View Mode

**User Story:** As an ERP admin, I want the dashboard to load in Daily view by default, so that I immediately see today's performance without taking any action.

#### Acceptance Criteria

1. WHEN the Dashboard page mounts, THE Dashboard SHALL initialise View Mode to "Daily".
2. WHEN the Dashboard page mounts, THE Dashboard SHALL render the Toggle with the "Daily" segment visually selected.

---

### Requirement 2: Toggle Control

**User Story:** As an ERP admin, I want a clearly visible toggle above the revenue chart, so that I can switch between Daily and Weekly views with one click.

#### Acceptance Criteria

1. THE Dashboard SHALL render a segmented pill Toggle with exactly two segments: "Daily" and "Weekly".
2. THE Toggle SHALL be positioned directly above the Main Chart card.
3. WHEN the user selects a Toggle segment, THE Dashboard SHALL update View Mode to the selected segment without a full page reload.
4. WHILE a Toggle segment is selected, THE Toggle SHALL apply a visually distinct active style to that segment and an inactive style to the other segment.

---

### Requirement 3: KPI Cards in Daily View

**User Story:** As an ERP admin, I want to see today's totals on the KPI cards when Daily view is active, so that I can quickly assess same-day performance.

#### Acceptance Criteria

1. WHILE View Mode is "Daily", THE Dashboard SHALL display the following four KPI Cards: Revenue (today), Orders (today), Avg Order Value (today), Active Outlets.
2. WHILE View Mode is "Daily", THE Revenue KPI Card SHALL show the sum of `totalAmount` for all Completed Orders whose `createdAt` falls within today (from 00:00:00 to the current time).
3. WHILE View Mode is "Daily", THE Orders KPI Card SHALL show the count of Completed Orders whose `createdAt` falls within today.
4. WHILE View Mode is "Daily", THE Avg Order Value KPI Card SHALL show the result of dividing today's total revenue by today's completed order count, or zero when there are no completed orders today.
5. WHILE View Mode is "Daily", THE Active Outlets KPI Card SHALL show the count of outlets where `isActive` is `true`.
6. WHILE View Mode is "Daily", THE Revenue KPI Card SHALL display a Comparison Badge showing the percentage change between today's revenue and yesterday's revenue, formatted as "+X% vs yesterday" for positive change or "−X% vs yesterday" for negative change.
7. WHILE View Mode is "Daily", THE Orders KPI Card SHALL display a Comparison Badge showing the percentage change between today's completed order count and yesterday's completed order count, formatted as "+X% vs yesterday" or "−X% vs yesterday".
8. WHILE View Mode is "Daily", THE Avg Order Value KPI Card SHALL display a Comparison Badge showing the percentage change between today's average order value and yesterday's average order value, formatted as "+X% vs yesterday" or "−X% vs yesterday".
9. IF yesterday's value for a KPI metric is zero and today's value is greater than zero, THEN THE Dashboard SHALL display the Comparison Badge as "+100% vs yesterday".
10. IF both yesterday's value and today's value for a KPI metric are zero, THEN THE Dashboard SHALL omit the Comparison Badge for that metric.
11. WHILE View Mode is "Daily", THE Comparison Badge SHALL apply green styling for positive change and red styling for negative change.

---

### Requirement 4: KPI Cards in Weekly View

**User Story:** As an ERP admin, I want to see last-7-days totals on the KPI cards when Weekly view is active, so that I can assess week-to-date performance.

#### Acceptance Criteria

1. WHILE View Mode is "Weekly", THE Dashboard SHALL display four KPI Cards: Revenue (last 7 days), Orders (last 7 days), Avg Order Value (last 7 days), Active Outlets.
2. WHILE View Mode is "Weekly", THE Revenue KPI Card SHALL show the sum of `totalAmount` for all Completed Orders in the last 7 calendar days (identical to the existing `totalWeekRevenue` calculation).
3. WHILE View Mode is "Weekly", THE Orders KPI Card SHALL show the count of Completed Orders in the last 7 calendar days.
4. WHILE View Mode is "Weekly", THE Avg Order Value KPI Card SHALL show the result of dividing the 7-day revenue total by the 7-day completed order count, or zero when there are no completed orders.
5. WHILE View Mode is "Weekly", THE Active Outlets KPI Card SHALL show the count of outlets where `isActive` is `true`.
6. WHILE View Mode is "Weekly", THE Revenue KPI Card SHALL display a Comparison Badge showing the percentage change vs the prior 7-day period, formatted as "+X% vs last week" or "−X% vs last week".
7. WHILE View Mode is "Weekly", THE Orders KPI Card SHALL display a Comparison Badge showing the percentage change vs the prior 7-day period.
8. WHILE View Mode is "Weekly", THE Avg Order Value KPI Card SHALL display a Comparison Badge showing the percentage change vs the prior 7-day period.

---

### Requirement 5: Main Chart in Daily View

**User Story:** As an ERP admin, I want the main chart to show today's revenue when Daily view is active, so that the chart and KPI cards present consistent data.

#### Acceptance Criteria

1. WHILE View Mode is "Daily", THE Main Chart SHALL display a single-day bar chart showing today's completed-order revenue as one bar.
2. WHILE View Mode is "Daily", THE Main Chart card title SHALL read "Today's Revenue".
3. WHILE View Mode is "Daily", THE Main Chart card subtitle SHALL read "Completed orders revenue for today".

---

### Requirement 6: Main Chart in Weekly View

**User Story:** As an ERP admin, I want the main chart to show the last 7 days of revenue when Weekly view is active, consistent with the existing behaviour.

#### Acceptance Criteria

1. WHILE View Mode is "Weekly", THE Main Chart SHALL display the existing 7-day bar chart (one bar per day, Mon–Sun labels, same rendering logic as the current implementation).
2. WHILE View Mode is "Weekly", THE Main Chart card title SHALL read "Weekly Revenue".
3. WHILE View Mode is "Weekly", THE Main Chart card subtitle SHALL read "Sales performance across all outlets (last 7 days)".

---

### Requirement 7: Weekly Trend Section

**User Story:** As an ERP admin, I want a permanent week-over-week revenue trend chart below the main chart area, so that I can quickly compare this week's daily revenue against last week without toggling.

#### Acceptance Criteria

1. THE Dashboard SHALL render the Weekly Trend Section as a separate card, always visible regardless of View Mode, positioned below the main chart and activity feed row.
2. THE Weekly Trend Section SHALL contain a line chart with two series: "This Week" (Mon–day-today of the current calendar week) and "Last Week" (Mon–Sun of the previous calendar week).
3. THE Weekly Trend Section line chart SHALL plot one data point per day of the week (up to 7 points per series) where each point equals the sum of `totalAmount` for Completed Orders on that calendar day.
4. THE Weekly Trend Section SHALL label the x-axis with abbreviated day names: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
5. THE Weekly Trend Section card title SHALL read "Weekly Growth".
6. THE Weekly Trend Section card subtitle SHALL read "Revenue comparison: this week vs last week".
7. IF no chart library is available in the project, THEN THE Dashboard SHALL render the Weekly Trend Section line chart using raw SVG elements consistent with the existing custom bar chart approach.

---

### Requirement 8: Loading State

**User Story:** As an ERP admin, I want the dashboard to show loading indicators while data is being fetched, so that I am not confused by blank or stale values.

#### Acceptance Criteria

1. WHILE the Dashboard is in a loading state, THE KPI Cards SHALL each display a spinner in place of the numeric value and Comparison Badge.
2. WHILE the Dashboard is in a loading state, THE Main Chart SHALL display a centred spinner in place of the chart bars.
3. WHILE the Dashboard is in a loading state, THE Weekly Trend Section SHALL display a centred spinner in place of the line chart.

---

### Requirement 9: Real-time Updates

**User Story:** As an ERP admin, I want the dashboard to refresh automatically when an order event is received, so that the KPI values and charts stay current.

#### Acceptance Criteria

1. WHEN a real-time event of type `ORDER_COMPLETED`, `ORDER_CREATED`, `ORDER_CANCELLED`, `ORDERS_MERGED`, `ORDER_MODE_CHANGED`, or `ORDER_COMPLIMENTARY` is received, THE Dashboard SHALL re-fetch all order data and recompute KPI values and chart data for the currently selected View Mode without resetting View Mode.
