# ERP Missing Cloud Migrations Bugfix Design

## Overview

The ERP cloud PostgreSQL database was deployed with only migrations `0000` and `0001` applied. Migration `0002_oval_shiver_man` — which creates the `stock_transactions` and `table_reservations` tables, adds the `order_mode` enum and 11 new columns to `orders`, 6 new columns to `invoices`, and 2 new columns to `order_items` — was never run against the cloud instance.

When the BullMQ sync worker processes `ORDER_COMPLETED` events from the POS, it uses the current Drizzle schema (which includes all columns from `0002`). The INSERT statements fail with PostgreSQL errors such as `column "order_mode" of relation "orders" does not exist` and `relation "stock_transactions" does not exist`. The worker re-throws the error, BullMQ retries the job up to 3 times, then marks it as failed. No data is written to the ERP database and no operator alert is raised beyond a Sentry capture.

The fix is a one-time operational action: run `drizzle-kit migrate` against the cloud database using `drizzle.config.cloud.ts` from the `@gusto/db-schema` package. No application code changes are required to make the sync worker function correctly after the migration is applied. However, two code-level improvements are included to prevent silent failures in the future: a schema health-check on worker startup and a structured error log that surfaces the database error message without requiring Sentry access.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — the cloud PostgreSQL database has applied migrations `0000` and `0001` but NOT `0002_oval_shiver_man`, so the `stock_transactions` table, `table_reservations` table, and new columns on `orders`, `order_items`, and `invoices` do not exist.
- **Property (P)**: The desired behavior when the bug condition holds — migration `0002` is applied to the cloud database and the sync worker can successfully INSERT/UPDATE using the full current schema.
- **Preservation**: All existing sync worker behavior for inputs that do not depend on schema added by `0002` must remain unchanged after the fix.
- **`processInventoryDeduction`**: The function in `apps/sync-worker/src/handlers/inventory.handler.ts` that inserts rows into `stock_transactions` and updates `inventory_items.current_stock` — this fails at the `INSERT INTO stock_transactions` statement when `0002` is missing.
- **`syncWorker` (ORDER_COMPLETED handler)**: The inline handler in `apps/sync-worker/src/index.ts` that upserts `orders`, deletes and re-inserts `order_items`, and upserts `invoices` — this fails at the `INSERT INTO orders` statement because the `order_mode`, `discount_type`, and other columns added by `0002` are referenced by Drizzle's generated SQL even when the caller does not supply them (Drizzle includes all columns with `NOT NULL DEFAULT` in the INSERT).
- **`drizzle-kit migrate`**: The Drizzle ORM CLI command that reads the `_journal.json` and applies any un-applied `.sql` migration files to the target database in sequence.
- **`drizzle.config.cloud.ts`**: The Drizzle configuration in `packages/db-schema/` that targets the cloud PostgreSQL instance via `DATABASE_URL`.

---

## Bug Details

### Bug Condition

The bug manifests when the sync worker attempts to write an `ORDER_COMPLETED` event payload to the cloud PostgreSQL database. The Drizzle ORM schema used by the worker includes all columns and tables defined through migration `0002`, but the live cloud database schema only contains objects up to migration `0001`. Every `INSERT INTO orders` emitted by Drizzle includes the `order_mode` column (added by `0002`, `NOT NULL DEFAULT 'DINE_IN'`), so PostgreSQL immediately raises `ERROR: column "order_mode" of relation "orders" does not exist`. The inventory deduction worker fails separately when it attempts `INSERT INTO stock_transactions`, because the `stock_transactions` table does not exist at all.

**Formal Specification:**

```
FUNCTION isBugCondition(dbState)
  INPUT:  dbState — the set of migration names applied to the cloud PostgreSQL instance
  OUTPUT: boolean

  RETURN "0002_oval_shiver_man" NOT IN dbState
         AND syncWorkerIsRunning()
         AND syncWorkerSchemaVersion INCLUDES columns_from("0002_oval_shiver_man")
END FUNCTION
```

### Examples

- **Example 1 — ORDER_COMPLETED sync fails**: POS completes order #1042. Sync worker dequeues the job and calls `db.transaction(...)` to upsert the order. Drizzle generates `INSERT INTO orders (..., order_mode, discount_type, ...) VALUES (...)`. PostgreSQL returns `ERROR: column "order_mode" of relation "orders" does not exist`. Worker catches, logs `[Sync] ❌ Failed to sync order 1042`, reports to Sentry, re-throws. BullMQ retries 3 times with exponential backoff; all fail. Job is moved to the failed queue. ERP shows zero orders.

- **Example 2 — Inventory deduction fails**: Even if the order upsert were somehow patched, the inventory deduction job calls `tx.insert(schema.stockTransactions)`. PostgreSQL returns `ERROR: relation "stock_transactions" does not exist`. The `inventoryWorker` fails; stock levels are never updated.

- **Example 3 — ONLINE_ORDER_ACCEPTED is unaffected**: An `ONLINE_ORDER_ACCEPTED` event calls `db.update(schema.onlineOrders)`. The `online_orders` table was created in migration `0001` and has no columns added by `0002`. This event path succeeds even with `0002` missing.

- **Edge case — Re-running the migration on an already-migrated DB**: Running `drizzle-kit migrate` on a database that already has `0002` applied is a no-op; Drizzle's `__drizzle_migrations` journal table prevents re-application.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `ONLINE_ORDER_ACCEPTED`, `ONLINE_ORDER_REJECTED`, and `ONLINE_ORDER_READY` event handlers in the sync worker must continue to update the `online_orders` table status exactly as they do today.
- The idempotent upsert pattern for `orders` (`.onConflictDoUpdate`) and the delete-then-insert pattern for `order_items` must remain intact after the migration is applied.
- The sync pull endpoint (returns menu categories, menu items, dining tables, users, outlet config) must be completely unaffected.
- Multi-event sync push batches must continue to enqueue each event as an individual BullMQ job and return correct `received` / `queued` counts.
- The inventory deduction handler's recipe-not-found warning path (skips the item, continues deducting others) must remain unchanged.

**Scope:**

All inputs that do NOT involve writing to the columns and tables added by migration `0002` are unaffected by this fix. This includes:

- Mouse clicks and UI interactions on the ERP web-admin (read paths are unaffected)
- Online order webhook processing (Zomato/Swiggy flows)
- Local SQLite schema used by the POS — this fix targets only the cloud PostgreSQL database

---

## Hypothesized Root Cause

Based on code inspection of `apps/sync-worker/src/index.ts` and the migration file `packages/db-schema/drizzle/cloud/0002_oval_shiver_man.sql`, the root causes are:

1. **Migration not applied to cloud database**: The deployment process did not run `drizzle-kit migrate` against the cloud PostgreSQL instance before starting the sync worker. The worker's Drizzle ORM schema is always built from the full TypeScript schema definitions, which include all columns through `0002`. There is no runtime schema-version check to catch this mismatch.

2. **Silent retry exhaustion without operator alert**: The `ORDER_COMPLETED` catch block in `src/index.ts` calls `Sentry.captureException(err)` and logs to stdout, but does not emit a structured log entry that distinguishes a database schema error from a transient network error. BullMQ's `failed` event handler only logs `err.message`. Operators relying on console logs alone cannot immediately identify missing migrations as the root cause.

3. **No startup health-check for schema readiness**: The sync worker boots and immediately begins consuming jobs from Redis without verifying that the connected PostgreSQL database has the expected schema version. A lightweight check against the `__drizzle_migrations` table on startup would catch this class of deployment mistake before any jobs are processed.

4. **Deployment runbook gap**: There is no documented step in the deployment process that mandates running migrations before starting the sync worker container. This is a process gap, not a code bug, but it is the proximate cause of the production incident.

---

## Correctness Properties

Property 1: Bug Condition — Migration Applied, Sync Succeeds

_For any_ `ORDER_COMPLETED` event payload where the bug condition holds (cloud database is missing migration `0002`), after applying migration `0002_oval_shiver_man` to the cloud PostgreSQL database, the sync worker SHALL successfully complete the database transaction: upsert the order row (including all `0002`-added columns), delete and re-insert order items, upsert the invoice row, and enqueue an inventory deduction job — without raising a database error.

**Validates: Requirements 2.1, 2.3, 2.4**

Property 2: Preservation — Non-schema-dependent Event Paths Unchanged

_For any_ sync event that does NOT write to tables or columns added by migration `0002` (i.e., `ONLINE_ORDER_ACCEPTED`, `ONLINE_ORDER_REJECTED`, `ONLINE_ORDER_READY` events and all sync pull requests), the fixed deployment (with `0002` applied) SHALL produce exactly the same behavior as before the fix, preserving all existing online order status update logic, pull sync responses, and multi-event batch enqueuing behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

The primary fix is operational (run the migration). Two supporting code changes harden the system against future silent failures.

---

**Action 1 — Apply migration to cloud database (operational)**

Run the following from the workspace root with the production `DATABASE_URL` set:

```bash
DATABASE_URL=<cloud_postgres_url> pnpm --filter @gusto/db-schema db:migrate
```

This executes `drizzle-kit migrate --config=drizzle.config.cloud.ts`, which reads `packages/db-schema/drizzle/cloud/_journal.json`, checks the `__drizzle_migrations` table in the target database, and applies `0002_oval_shiver_man.sql`. The command is idempotent: if `0002` has already been applied it does nothing.

---

**Action 2 — Add structured error classification in the sync worker**

**File**: `apps/sync-worker/src/index.ts`

**Function**: `ORDER_COMPLETED` catch block (around line 130)

**Specific Changes**:

1. **Detect schema-mismatch errors**: Inspect the PostgreSQL error code (`42703` = undefined column, `42P01` = undefined table) or match the error message against known patterns before re-throwing.

2. **Emit a structured log entry**: Replace the bare `console.error` with a structured log that includes `jobId`, `eventType`, `orderNumber`, the PostgreSQL error code, and a human-readable hint: `"Possible missing database migration — run drizzle-kit migrate"`.

3. **Example implementation**:

```typescript
} catch (err: any) {
  Sentry.captureException(err);
  const pgCode = err?.code ?? '';
  const isSchemaMismatch = pgCode === '42703' || pgCode === '42P01';
  console.error(JSON.stringify({
    level: 'error',
    worker: 'pos-sync',
    jobId: job.id,
    eventType,
    orderNumber,
    pgErrorCode: pgCode,
    message: err?.message,
    hint: isSchemaMismatch
      ? 'Database schema mismatch — run: pnpm --filter @gusto/db-schema db:migrate'
      : undefined,
  }));
  throw err;
}
```

---

**Action 3 — Add schema health-check on worker startup**

**File**: `apps/sync-worker/src/index.ts`

**Location**: After the `Sentry.init(...)` block, before the worker declarations.

**Specific Changes**:

1. **Query `__drizzle_migrations`** at startup to verify that `0002_oval_shiver_man` is present.
2. **If missing, log a fatal error and exit** with a non-zero code so container orchestration (Docker / ECS / Railway) can surface the failure immediately rather than letting the worker consume and exhaust jobs silently.

```typescript
async function assertSchemaReady() {
  const REQUIRED_MIGRATION = '0002_oval_shiver_man';
  try {
    const rows = await db.execute(
      sql`SELECT tag FROM __drizzle_migrations WHERE tag = ${REQUIRED_MIGRATION} LIMIT 1`
    );
    if (rows.rows.length === 0) {
      console.error(JSON.stringify({
        level: 'fatal',
        message: `Required migration "${REQUIRED_MIGRATION}" has not been applied to the cloud database.`,
        hint: 'Run: pnpm --filter @gusto/db-schema db:migrate',
      }));
      process.exit(1);
    }
    console.log(`[Startup] ✅ Schema health-check passed (${REQUIRED_MIGRATION} present)`);
  } catch (e) {
    // If the migrations table itself is missing, also fatal
    console.error('[Startup] ❌ Cannot verify schema version:', e);
    process.exit(1);
  }
}

await assertSchemaReady();
```

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed database state, then verify the fix works correctly and preserves all unaffected behavior.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE the migration is applied. Confirm the root cause analysis (column/table does not exist errors) or refute it (e.g., if the real failure is elsewhere). If refuted, re-hypothesize.

**Test Plan**: Write integration tests that connect to a fresh PostgreSQL instance seeded with only migrations `0000` and `0001`, then invoke the `ORDER_COMPLETED` handler logic directly and assert that the expected database errors are thrown.

**Test Cases**:

1. **orders INSERT with 0002 missing**: Attempt to upsert an order row using the full Drizzle schema against a database missing `0002`. Expect a PostgreSQL error with code `42703` (`column "order_mode" does not exist`). (Will fail on unfixed database)
2. **stock_transactions INSERT with 0002 missing**: Attempt to insert into `schema.stockTransactions` against a database missing `0002`. Expect a PostgreSQL error with code `42P01` (`relation "stock_transactions" does not exist`). (Will fail on unfixed database)
3. **invoices INSERT with 0002 missing**: Attempt to upsert an invoice row. Expect `column "receipt_status" of relation "invoices" does not exist`. (Will fail on unfixed database)
4. **order_items INSERT with 0002 missing**: Attempt to insert order items. Expect `column "variant_name" of relation "order_items" does not exist`. (Will fail on unfixed database)

**Expected Counterexamples**:

- All four INSERT/UPDATE operations targeting tables modified by `0002` fail with PostgreSQL schema errors
- Confirms root cause: the Drizzle schema includes `0002` columns but the cloud database does not

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, applying the fix (running migration `0002`) causes the sync worker to produce the expected behavior.

**Pseudocode:**

```
FOR ALL orderPayload WHERE isBugCondition(dbState) DO
  APPLY migration "0002_oval_shiver_man" TO dbState
  result := syncWorker_ORDER_COMPLETED_handler(orderPayload)
  ASSERT result.synced == true
  ASSERT ordersTable contains row with id == orderPayload.orderId
  ASSERT invoicesTable contains row with orderId == orderPayload.orderId
  ASSERT inventoryQueue contains job for orderPayload.orderId
END FOR

FOR ALL deductionJob WHERE isBugCondition(dbState) DO
  APPLY migration "0002_oval_shiver_man" TO dbState
  result := processInventoryDeduction(deductionJob)
  ASSERT stockTransactionsTable contains row with orderId == deductionJob.orderId
END FOR
```

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (i.e., events that do not write to `0002`-added schema), the behavior is identical before and after the migration.

**Pseudocode:**

```
FOR ALL event WHERE NOT isBugCondition(event) DO
  result_before := syncWorker_original(event)   // 0001-only database
  APPLY migration "0002" TO dbState
  result_after  := syncWorker_fixed(event)       // 0002 database
  ASSERT result_before == result_after
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because online order event payloads can vary in shape (different order IDs, status strings, optional reason fields) and manual unit tests cannot cover the full domain.

**Test Cases**:

1. **ONLINE_ORDER_ACCEPTED preservation**: Generate random `onlineOrderId` values and verify that `db.update(onlineOrders).set({ status: "ACCEPTED" })` succeeds with identical behavior before and after `0002` is applied.
2. **ONLINE_ORDER_REJECTED preservation**: Same pattern for `REJECTED` status with varied `reason` strings.
3. **Sync pull response preservation**: Verify that the pull sync endpoint returns identical payloads (menu categories, dining tables, etc.) before and after the migration.
4. **Multi-event batch enqueue preservation**: Verify `received` and `queued` counts are identical for a batch of mixed event types.

---

### Unit Tests

- Test the `isBugCondition` check: given a mock `__drizzle_migrations` result without `0002`, `assertSchemaReady()` should call `process.exit(1)`.
- Test the structured error classifier: given a mock error with `code: '42703'`, the catch block should emit a JSON log containing `pgErrorCode` and the migration hint.
- Test `processInventoryDeduction` with a recipe-less item: verify the warning is emitted and deductions for other items still complete (existing behavior, unchanged).

### Property-Based Tests

- Generate random `OrderItem[]` arrays with varying `menuItemId` values; verify that `processInventoryDeduction` always returns a `DeductionResult` with `deducted: true` regardless of which items have recipes (preservation of the skip-on-no-recipe logic).
- Generate random `ORDER_COMPLETED` payloads with valid UUIDs and numeric amounts; verify that after `0002` is applied, every payload produces `synced: true` and a corresponding row in `orders`.

### Integration Tests

- Full end-to-end test: seed a clean PostgreSQL instance with `0000` + `0001`, confirm `ORDER_COMPLETED` sync fails. Apply `0002`. Confirm same payload now succeeds and all three tables (`orders`, `order_items`, `invoices`) contain the expected rows.
- Verify `stock_transactions` row is created with correct `type: "ORDER_DEDUCTION"` and `quantityChange` after inventory deduction runs post-migration.
- Verify that `ONLINE_ORDER_ACCEPTED` succeeds both before and after `0002` is applied (preservation).
