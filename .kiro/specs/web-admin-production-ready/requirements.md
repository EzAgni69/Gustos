# Requirements Document

## Introduction

The Gusto ERP web-admin dashboard (`apps/web-admin`) is a Next.js 15 application that provides the cloud management interface for a multi-tenant restaurant ERP system. The dashboard shell, layout, and core CRUD pages for outlets, menu, tables, staff, inventory, customers, CRM, HR, orders, reports, and settings are all in place with functional API integration.

This feature covers all work required to bring the web-admin to a production-ready state. That means: completing every "coming soon" stub page, adding outlet-switcher consistency across all multi-outlet pages, building the Franchise → Outlet hierarchy management view, elevating the recipe management UX, adding cross-cutting production-quality patterns (search/filter, pagination, empty states, error boundaries, mobile responsiveness), and ensuring every page in the sidebar is fully functional and deployable.

---

## Glossary

- **Web_Admin**: The Next.js 15 web application at `apps/web-admin/`.
- **API_Gateway**: The Fastify cloud API at `apps/api-gateway/` that backs all data operations.
- **Outlet_Switcher**: A UI control (select or tab row) that allows the user to change which outlet's data is displayed on a given page.
- **Franchise**: A brand/chain entity in the tenant hierarchy that groups one or more Outlets. Managed via `/franchises` API.
- **Outlet**: A physical restaurant location belonging to a Franchise. Managed via `/outlets` API.
- **Recipe**: A mapping of raw InventoryItems (ingredients with quantities) to a MenuItem, used for automated stock deduction.
- **Vendor**: A supplier entity used in the procurement workflow.
- **Purchase_Order**: A formal procurement document sent to a Vendor requesting delivery of inventory materials.
- **GRN**: Goods Received Note — a record confirming delivery of items against a Purchase_Order.
- **Stub_Page**: Any page in the current codebase that renders a "coming soon" placeholder instead of functional content.
- **Error_Boundary**: A React error boundary component that catches rendering exceptions and displays a recoverable error UI instead of a blank screen.
- **Empty_State**: A designed UI state shown when a data list has zero items, providing context and a primary call-to-action.
- **Outlet_Scoped_Page**: Any page whose data is filtered by a selected outlet (e.g., menu, tables, shifts, attendance, payroll).

---

## Requirements

### Requirement 1: Franchise & Outlet Hierarchy Management

**User Story:** As an organization owner, I want to manage my brands (franchises) and their outlet locations from a unified hierarchy view, so that I can clearly see the structure of my restaurant chain and make changes at the correct level.

#### Acceptance Criteria

1. WHEN the user navigates to `/outlets`, THE Web_Admin SHALL display a "Franchises & Outlets" view that shows all Franchises with their child Outlets listed beneath each parent brand.
2. THE Web_Admin SHALL provide a "New Franchise" action that opens a form to create a Franchise with a name (1–100 characters, required) and an optional description (0–500 characters).
3. IF the franchise name field is blank or exceeds 100 characters when the form is submitted, THEN THE Web_Admin SHALL reject the submission and display an inline validation error on the name field without closing the form.
4. WHEN the user activates the edit action on a Franchise, THE Web_Admin SHALL open an edit form pre-populated with the franchise's current name and description values.
5. WHEN the user submits a valid franchise edit form, THE Web_Admin SHALL update the franchise's name and description and reflect the changes in the hierarchy view.
6. WHEN the user activates "New Outlet" from within a franchise section, THE Web_Admin SHALL open the outlet creation form with that franchise pre-selected.
7. WHEN the user requests deletion of a Franchise that has no child Outlets, THE Web_Admin SHALL display a single confirmation dialog and proceed with deletion upon confirmation.
8. WHEN the user requests deletion of a Franchise that has existing Outlets, THE Web_Admin SHALL display a warning dialog stating that all child outlets will also be deleted and requiring the user to click a confirmation button before proceeding.
9. THE Web_Admin SHALL display each Outlet with its name, address, and active/inactive status badge; IF the outlet has a recorded sync event, THEN THE Web_Admin SHALL also display the most recent successful sync timestamp.
10. WHEN a Franchise has no outlets, THE Web_Admin SHALL render an empty state within that franchise section with a prompt to add the first outlet.
11. THE Web_Admin SHALL retain the existing "Edge Sync Monitor" tab alongside the hierarchy view.

---

### Requirement 2: Outlet Switcher Consistency

**User Story:** As a multi-outlet manager, I want every outlet-scoped page to let me switch between outlets without navigating away, so that I can compare or manage data across branches quickly.

#### Acceptance Criteria

1. WHILE the user is on any Outlet_Scoped_Page (Menu Management, Tables, HR Shifts, HR Attendance, HR Payroll, or Orders), THE Web_Admin SHALL display a persistent Outlet_Switcher visible without scrolling, for users who have access to at least one outlet.
2. WHEN the user selects a different outlet in the Outlet_Switcher, THE Web_Admin SHALL reload the page's data for the newly selected outlet within 5 seconds, displaying a loading indicator during the fetch.
3. WHEN only one outlet exists, THE Web_Admin SHALL show the outlet name as a static label without a dropdown control.
4. WHILE the user's session is active (from login until logout or tab close), THE Web_Admin SHALL persist the last-selected outlet so the user does not need to re-select when navigating between Outlet_Scoped_Pages.
5. IF the outlet data fetch initiated by an outlet switch fails or exceeds 5 seconds, THEN THE Web_Admin SHALL dismiss the loading indicator, display an error message indicating the data could not be loaded, and retain the previously displayed outlet data.

---

### Requirement 3: Menu Management Completeness

**User Story:** As a restaurant manager, I want complete menu management with proper outlet switching and item availability toggling from the list view, so that I can manage menus for each branch efficiently without opening item edit modals for simple changes.

#### Acceptance Criteria

1. THE Web_Admin SHALL display the Outlet_Switcher at the top of the Menu Management page, showing the current outlet name and allowing the user to switch to another outlet.
2. WHEN the user switches outlets on the Menu Management page, THE Web_Admin SHALL reload both the category list and the item list for the newly selected outlet.
3. THE Web_Admin SHALL render a category filter row above the items table showing all categories belonging to the selected outlet, plus an "All" option, that filters the displayed items to those matching the selected category.
4. WHEN the user selects a category in the filter row, THE Web_Admin SHALL display only menu items belonging to that category for the current outlet.
5. WHEN a menu item row is displayed, THE Web_Admin SHALL provide an inline availability toggle that calls `PUT /menu/items/:id` with the updated `isAvailable` value without opening a modal; IF the toggle update succeeds, THE Web_Admin SHALL reflect the new availability state within the row.
6. IF the inline availability toggle call fails, THEN THE Web_Admin SHALL revert the toggle to its previous state and display an error message.
7. WHEN items are loaded, THE Web_Admin SHALL display a count badge per category in the filter row showing how many items in that category belong to the currently selected outlet.
8. IF the items list is empty for the selected outlet and category filter, THE Web_Admin SHALL render an Empty_State with a call-to-action that navigates the user to the add menu item form for the selected outlet.

---

### Requirement 4: Tables Management Improvements

**User Story:** As a floor manager, I want to manage tables across branches and update table statuses in bulk, so that I can reflect floor changes after events or deep-cleaning without editing tables one by one.

#### Acceptance Criteria

1. THE Web_Admin SHALL display the Outlet_Switcher at the top of the Tables page.
2. WHEN the user switches outlets on the Tables page, THE Web_Admin SHALL clear the previously displayed floor plan sections and table cards and load the floor plan sections and table cards for the newly selected outlet.
3. THE Web_Admin SHALL provide a "Bulk Status Update" action in the Tables page header.
4. WHEN the user activates the "Bulk Status Update" action, THE Web_Admin SHALL open a dialog presenting a section selector scoped to the currently selected outlet and a target status selector with options AVAILABLE and CLEANING.
5. IF the user selects a section that contains no tables in the bulk status update dialog, THEN THE Web_Admin SHALL disable the confirm button and display a message indicating no tables are available in the selected section.
6. WHEN the bulk status update is confirmed, THE Web_Admin SHALL send a `PUT /tables/:id` request for each table in the selected section, display a progress indicator showing the count of completed requests out of the total, refresh all affected table cards upon completion, and display a success notification.
7. IF one or more `PUT /tables/:id` requests fail during a bulk status update, THEN THE Web_Admin SHALL display an error notification indicating the number of tables that failed to update, while tables whose requests succeeded SHALL retain their updated status.
8. IF an outlet has no tables, THE Web_Admin SHALL render an Empty_State with a call-to-action that navigates the user to the Add Table form for the current outlet.

---

### Requirement 5: Staff Role Indicators & Access Management

**User Story:** As an administrator, I want staff member role badges to be visually differentiated and want to see which outlet each staff member is assigned to, so that I can quickly understand access levels without opening edit modals.

#### Acceptance Criteria

1. THE Web_Admin SHALL render role badges on the Staff table with distinct color coding: MANAGER in blue, CASHIER in gray, WAITER in green, CHEF in orange; for any role value not in this defined set, THE Web_Admin SHALL render a neutral-colored badge displaying the raw role value.
2. THE Web_Admin SHALL display the assigned outlet name (resolved from outlet ID) in a dedicated column on the Staff table, showing "Global" when no outlet is assigned and "Unknown Outlet" when an outlet ID is present but cannot be resolved to a name.
3. WHEN a user types into the staff search input, THE Web_Admin SHALL filter the displayed staff list client-side to rows where the name, email, or role contains the entered text, and SHALL display a "No results found" message when no rows match.
4. IF a staff account has an inactive status, THEN THE Web_Admin SHALL render the entire table row at 40% opacity and display the Inactive badge on that row simultaneously.
5. THE Web_Admin SHALL replace the "Permission UI editor coming soon" placeholder in the Role & Permissions tab with a read-only permission matrix table mapping each role (MANAGER, CASHIER, WAITER, CHEF) to the following exhaustive set of permissions: View Reports, Edit Menu, Manage Staff, Process Orders, View Orders, Manage Inventory; each cell SHALL indicate whether the role is granted or denied that permission.

---

### Requirement 6: Recipe Management UX

**User Story:** As a kitchen manager, I want a dedicated and intuitive recipe builder that clearly shows which menu items have recipes configured and lets me manage ingredients inline, so that I can trust that automated inventory deductions are correct.

#### Acceptance Criteria

1. THE Web_Admin SHALL display a summary counter in the Recipe Builder tab header showing "X of Y menu items have recipes configured."
2. IF a menu item has no recipe configured, THEN THE Web_Admin SHALL highlight its table row with a visually differentiated background color that is distinct from rows with a configured recipe, applied consistently to all unconfigured rows.
3. WHEN the Recipe Manager modal opens, THE Web_Admin SHALL render an ingredient list where the user can edit any ingredient's quantity directly in the row without closing or reopening the modal, and changes are staged until the user explicitly saves the recipe.
4. WHEN the user adds an ingredient in the Recipe Manager modal, THE Web_Admin SHALL provide an autocomplete dropdown sourced from the existing active inventory items list rather than a free-text field.
5. WHEN the Recipe Manager modal opens, THE Web_Admin SHALL display the estimated cost per serving calculated as the sum of (quantity × costPerUnit) for all ingredients, rounded to 2 decimal places, showing 0.00 when no ingredients are present.
6. WHILE the Recipe Manager modal is open, THE Web_Admin SHALL recalculate and display the updated estimated cost per serving within 500 milliseconds of any change to an ingredient's quantity.
7. WHEN the user saves a recipe, THE Web_Admin SHALL update the "Recipe Status" and "Ingredients Count" columns in the table within 1 second without requiring a full page reload.
8. IF a recipe save operation fails, THEN THE Web_Admin SHALL display an error message indicating the save did not complete and preserve the unsaved ingredient changes in the modal so the user can retry.

---

### Requirement 7: Inventory Vendors Module

**User Story:** As an operations manager, I want to register and manage suppliers so that I can associate purchase orders with the correct vendors and track procurement sources.

#### Acceptance Criteria

1. THE Web_Admin SHALL replace the "Vendor management coming soon" placeholder in the Vendors tab with a vendors list table populated from the vendor data API.
2. WHEN the user submits the vendor creation form, THE Web_Admin SHALL validate that the name field is present and does not exceed 100 characters, and that if provided, email is a valid email format and phone does not exceed 20 characters.
3. WHEN a vendor is successfully created, THE Web_Admin SHALL close the creation form and refresh the vendors list to include the new vendor.
4. WHEN the user requests deletion of a vendor, THE Web_Admin SHALL display a confirmation prompt before calling the delete API, and refresh the vendor list on success.
5. IF any vendor mutation request (create, update, or delete) fails, THEN THE Web_Admin SHALL display an error message and preserve the current vendors list state without modification.
6. IF no vendors exist, THE Web_Admin SHALL render an Empty_State with a call-to-action to add the first vendor.

---

### Requirement 8: Purchase Orders Module

**User Story:** As an operations manager, I want to create and track purchase orders against vendors so that I can manage procurement from ordering through to goods receipt.

#### Acceptance Criteria

1. THE Web_Admin SHALL replace the "Purchase order workflow coming soon" placeholder with a purchase orders list table that renders all existing purchase orders fetched from the API.
2. THE Web_Admin SHALL provide a "Create PO" form with: a vendor selector populated from the Vendor list, an expected delivery date field, and a line-items section where the user can add between 1 and 50 inventory items each with a quantity (integer, 1–9,999) and unit price (0.01–999,999.99), submitting only when all required fields (vendor, expected delivery date, and at least one line item) are populated.
3. THE Web_Admin SHALL display each purchase order with its system-generated PO number, vendor name, total value calculated as the sum of (quantity × unit price) across all line items, status badge (DRAFT, SENT, RECEIVED, or CANCELLED), and created date.
4. IF a purchase order has status RECEIVED, THEN THE Web_Admin SHALL disable the edit and delete actions for that purchase order and display a "View GRN" link in its row.
5. IF the purchase order creation request fails, THEN THE Web_Admin SHALL display an error message indicating the failure and retain all form field values so the user can retry without re-entering data.
6. IF no purchase orders exist, THE Web_Admin SHALL render an Empty_State with a call-to-action to create the first PO.

---

### Requirement 9: Goods Received Notes (GRN) Module

**User Story:** As a stock manager, I want to record incoming stock deliveries against purchase orders so that inventory levels are updated and procurement is tracked end-to-end.

#### Acceptance Criteria

1. THE Web_Admin SHALL replace the "GRN processing coming soon" placeholder with a GRN list table that displays each GRN's GRN number, linked PO number, received date, supplier name, and total items received.
2. THE Web_Admin SHALL provide a "New GRN" form that restricts Purchase_Order selection to POs with status "Open" or "Partially Received", lists each ordered line item with its ordered quantity and a received quantity field accepting values between 0.001 and 99,999 (up to 3 decimal places), and requires at least one line item to have a received quantity greater than zero before submission is enabled.
3. WHEN a GRN is saved, THE Web_Admin SHALL reflect the updated stock quantities in the Raw Materials tab within 3 seconds without requiring a manual page reload.
4. IF a received quantity entered for any line item exceeds the remaining ordered quantity for that line, THEN THE Web_Admin SHALL display an inline validation error on that field and disable the submit button until all quantities are within the remaining ordered bounds.
5. IF no GRNs exist, THE Web_Admin SHALL render an Empty_State with a button that navigates the user to the New GRN form.
6. IF GRN submission fails, THEN THE Web_Admin SHALL display an error message indicating the failure reason and preserve all entered field values so the user can retry without re-entering data.

---

### Requirement 10: Orders Page Improvements

**User Story:** As a restaurant manager, I want to view and manage orders with proper outlet filtering and date range controls, so that I can monitor operations for specific branches and time periods.

#### Acceptance Criteria

1. THE Web_Admin SHALL display the Outlet_Switcher as the first control in the filter bar at the top of the Orders page, applying the selected outlet as the `outletId` filter for all order queries on that page.
2. WHEN the user applies the date range filter on the Orders page, THE Web_Admin SHALL fetch orders using the selected from-date and to-date values, where the default date range on page load is the current calendar day, and the selectable range spans a maximum of 90 consecutive days.
3. THE Web_Admin SHALL display the table name associated with the table ID in the table column; IF the table name cannot be resolved from the table ID, THEN THE Web_Admin SHALL display "—" in that column cell.
4. THE Web_Admin SHALL provide a search input of maximum 100 characters that filters the currently loaded orders list client-side by order number (exact prefix match, case-insensitive) or customer name (partial match, case-insensitive), updating the displayed list on each keystroke.
5. IF an order has a status of PLACED or IN_PROGRESS, THEN THE Web_Admin SHALL render that order's table row with a distinct background color that differs from the background color used for rows with any other status.

---

### Requirement 11: HR Payroll Improvements

**User Story:** As an HR manager, I want to approve and mark payroll records as paid individually, so that I can track the payment status of each employee's salary separately.

#### Acceptance Criteria

1. THE Web_Admin SHALL display the Outlet_Switcher on the Payroll page, satisfying Requirement 2 criteria.
2. IF a payroll row has status CALCULATED, THEN THE Web_Admin SHALL display an "Approve" button for that row, and WHEN the user activates it, THE Web_Admin SHALL call `PUT /hr/payrolls/:id` with `{ status: "APPROVED" }`, update that row's status to APPROVED on success, and display an error message indicating the failure on API error without changing the row's status.
3. IF a payroll row has status APPROVED, THEN THE Web_Admin SHALL display a "Mark Paid" button for that row, and WHEN the user activates it, THE Web_Admin SHALL call `PUT /hr/payrolls/:id` with `{ status: "PAID", paidAt: <current UTC timestamp in ISO 8601 format> }`, update that row's status to PAID on success, and display an error message indicating the failure on API error without changing the row's status.
4. THE Web_Admin SHALL display the employee's full name in the Employee column; IF the employee name cannot be resolved, THEN THE Web_Admin SHALL display the employee ID in that column.
5. THE Web_Admin SHALL display a summary row at the bottom of the payroll table showing the sum of base salary, deductions, bonuses, and net salary for all rows matching the selected month and outlet; IF no payroll rows exist for the selected month and outlet, THEN the summary row SHALL display zero for each total.

---

### Requirement 12: CRM — Loyalty Points Viewer

**User Story:** As a CRM manager, I want to view a customer's loyalty account and adjust points when needed, so that I can resolve discrepancies and reward loyal customers manually.

#### Acceptance Criteria

1. WHEN the CRM manager navigates to `/crm/loyalty/:customerId`, THE Web_Admin SHALL render the page with the customer's name, current loyalty points balance, and a transaction history table listing all point earn and burn events in reverse chronological order.
2. WHEN the user clicks "View Loyalty" from the Customers page dropdown, THE Web_Admin SHALL navigate to `/crm/loyalty/:customerId` for that customer.
3. THE Web_Admin SHALL provide an "Adjust Points" action on the loyalty page that opens a form with an adjustment amount field (integer between -10,000 and +10,000, non-zero) and a reason field (1 to 255 characters).
4. WHEN the user submits the Adjust Points form with valid inputs, THE Web_Admin SHALL send a request to update the customer's loyalty balance and, upon success, update the displayed balance and append the new adjustment event to the transaction history table.
5. IF the loyalty balance update request fails, THEN THE Web_Admin SHALL display an error message indicating the adjustment could not be saved and preserve the previously displayed balance and transaction history without modification.
6. IF a customer has no loyalty transaction history, THE Web_Admin SHALL render an Empty_State indicating no transactions have occurred yet.

---

### Requirement 13: Error Boundaries & Resilience

**User Story:** As a user, I want the dashboard to recover gracefully from unexpected errors so that a failure in one section does not make the entire admin interface unusable.

#### Acceptance Criteria

1. THE Web_Admin SHALL wrap each dashboard page in a React Error_Boundary component such that a runtime rendering error within one page does not propagate to or unmount other pages or the navigation shell.
2. IF a React Error_Boundary catches a runtime rendering error, THEN THE Web_Admin SHALL display an error state within the failed page's boundary containing a descriptive message indicating what failed and a "Try Again" button that remounts the failed component tree, restoring the page to its pre-error loading state.
3. IF an API call returns an HTTP 4xx or 5xx response, THEN THE Web_Admin SHALL display an inline error banner within the page section that originated the request, containing a human-readable message describing the failure and, where applicable, a retry action.
4. WHEN a network request is initiated, THE Web_Admin SHALL display a loading skeleton or spinner in the data area of the requesting section until the request resolves or fails.
5. IF an API call receives no response within 30 seconds due to a network connectivity failure, THEN THE Web_Admin SHALL display an error message within the affected section that explicitly attributes the failure to a network connectivity issue, distinct from messages shown for HTTP 4xx or 5xx responses.
6. IF a user navigates to a page that requires at least one outlet to be configured and no outlets exist, THEN THE Web_Admin SHALL display an empty state containing a message stating that the page requires an outlet to be set up and a navigation link that takes the user directly to the Outlets management page.

---

### Requirement 14: Search, Filter & Pagination Consistency

**User Story:** As a power user managing large datasets, I want consistent search, filtering, and pagination controls across all list pages, so that I can find and navigate records efficiently regardless of which module I am in.

#### Acceptance Criteria

1. THE Web_Admin SHALL provide a client-side search input on the following list pages: Staff, Customers, Inventory (Raw Materials), Menu Items, Vendors, and Purchase Orders.
2. WHEN the user types in a search input, THE Web_Admin SHALL filter the displayed rows against the following per-entity fields: Staff (name, role), Customers (name, phone), Inventory (name), Menu Items (name, category), Vendors (name), Purchase Orders (PO number, vendor name); if a search produces no matching rows, THE Web_Admin SHALL display a "No results found" message and reset pagination to page 1.
3. WHEN a list page has more than 25 items and server-side pagination is active, THE Web_Admin SHALL display a "Previous" button (disabled on page 1) and a "Next" button (disabled on the last page), along with the current page number and total page count.
4. IF the total item count is 25 or fewer, THEN THE Web_Admin SHALL hide all pagination controls.
5. THE Web_Admin SHALL display the total count of matching items in the table header row for all list pages.

---

### Requirement 15: Mobile Responsiveness

**User Story:** As an owner who checks the dashboard on a tablet or phone, I want all pages to be usable on small screens, so that I can monitor operations and make quick edits while away from a desktop.

#### Acceptance Criteria

1. IF the viewport width is less than 768px, THEN THE Web_Admin SHALL render all data tables with horizontal scroll so that table content is not truncated by viewport clipping.
2. IF the viewport width is less than 640px, THEN THE Web_Admin SHALL collapse multi-column KPI card grids of two or more columns to a single column.
3. IF the viewport width is less than 640px, THEN THE Web_Admin SHALL render dialog forms as a full-width bottom-sheet spanning 100% of the viewport width with 16px of left and right padding, replacing the default modal style.
4. IF the viewport width is less than 640px, THEN THE Web_Admin SHALL display the Outlet_Switcher as a full-width select element spanning 100% of its container width.
5. WHILE the sidebar is collapsed, WHEN the user opens a page with a viewport width less than 640px, THE Web_Admin SHALL render the main content area at 100% of the viewport width with 16px of left and right padding.
