# Bugfix Requirements Document

## Introduction

POS and Captain app data is not reflecting on the ERP (web-admin) after deployment. The root cause is that the ERP's cloud PostgreSQL database is missing migration `0002_oval_shiver_man`, which adds the `stock_transactions` table, `table_reservations` table, and a large number of new columns to the `orders`, `order_items`, and `invoices` tables. When the sync worker (BullMQ) processes `ORDER_COMPLETED` events from the POS, it attempts to insert rows using the full current Drizzle schema. Without migration `0002` applied, those INSERT and UPDATE statements fail with "column does not exist" errors. The worker catches the exception, reports it to Sentry, and re-throws — causing the job to be retried and eventually exhausted, while the ERP shows no new order data.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the ERP cloud PostgreSQL database has only migrations `0000` and `0001` applied (missing `0002`) AND the sync worker processes an `ORDER_COMPLETED` event THEN the system fails with a "column does not exist" or "relation does not exist" database error and the order is not persisted in the cloud

1.2 WHEN the sync worker job fails due to missing schema THEN the system silently retries up to the BullMQ job retry limit (3 attempts) without alerting operators, leaving the POS operator with no feedback that sync has failed

1.3 WHEN migration `0002` is missing AND the sync worker attempts to deduct inventory via the `stock_transactions` table THEN the system fails with a "relation does not exist" error because the `stock_transactions` table does not exist in the deployed database

1.4 WHEN the ERP web-admin dashboard queries orders, invoices, or inventory THEN the system returns empty results because no data was successfully synced, making it appear as though no POS activity occurred

### Expected Behavior (Correct)

2.1 WHEN the ERP cloud PostgreSQL database has all three migrations (`0000`, `0001`, `0002`) applied AND the sync worker processes an `ORDER_COMPLETED` event THEN the system SHALL successfully upsert the order, insert order items, upsert the invoice, and enqueue an inventory deduction job without database errors

2.2 WHEN a sync worker job fails due to a database schema mismatch THEN the system SHALL emit a structured error log entry that includes the job name, event type, and the database error message, enabling operators to diagnose the root cause without inspecting Sentry

2.3 WHEN migration `0002` is applied AND the inventory deduction worker processes a deduction job THEN the system SHALL successfully insert rows into the `stock_transactions` table and update `inventory_items.current_stock`

2.4 WHEN all pending migrations are applied to the ERP cloud database THEN the system SHALL reflect all orders, invoices, and inventory transactions that were queued by the POS in the ERP web-admin dashboard

### Unchanged Behavior (Regression Prevention)

3.1 WHEN migrations are applied and the sync worker processes a valid `ORDER_COMPLETED` event with positive quantities THEN the system SHALL CONTINUE TO upsert orders and order items idempotently (on-conflict-do-update / delete-then-insert pattern remains intact)

3.2 WHEN the POS submits a sync push with multiple events in a single batch THEN the system SHALL CONTINUE TO enqueue all events as individual BullMQ jobs and return the correct `received` and `queued` counts

3.3 WHEN the sync worker processes `ONLINE_ORDER_ACCEPTED`, `ONLINE_ORDER_REJECTED`, or `ONLINE_ORDER_READY` events THEN the system SHALL CONTINUE TO update the `online_orders` table status correctly

3.4 WHEN the inventory deduction handler finds no recipe for a menu item THEN the system SHALL CONTINUE TO skip that item with a warning and complete deductions for all other items that do have recipes

3.5 WHEN a sync pull request is made for a valid outlet THEN the system SHALL CONTINUE TO return menu categories, menu items, dining tables, users, and outlet config unaffected by the migration fix
