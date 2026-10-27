# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - ORDER_COMPLETED and stock_transactions INSERT fail with missing 0002 migration
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases — any `ORDER_COMPLETED` payload against a PostgreSQL instance that has only migrations `0000` and `0001` applied (missing `0002_oval_shiver_man`)
  - Spin up (or connect to) a PostgreSQL instance seeded with migrations `0000` and `0001` only
  - Attempt to upsert an order row using the full Drizzle schema (`schema.orders` including `order_mode`, `discount_type`, etc.)
  - Assert the error code is `42703` (`column "order_mode" of relation "orders" does not exist`) — from Bug Condition in design
  - Attempt to insert into `schema.stockTransactions` on the same database
  - Assert the error code is `42P01` (`relation "stock_transactions" does not exist`) — from Bug Condition in design
  - Attempt to upsert into `schema.invoices` — assert `42703` for `receipt_status` column
  - Attempt to insert into `schema.orderItems` — assert `42703` for `variant_name` column
  - Run test on UNFIXED code (database with only `0000` + `0001` applied)
  - **EXPECTED OUTCOME**: Test FAILS on the unfixed database (this is correct — it proves the bug exists)
  - Document counterexamples found (e.g., `"INSERT INTO orders (...order_mode...) → PostgreSQL 42703: column does not exist"`)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Online order event handlers and sync pull are unaffected by 0002 migration
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code (database with `0000` + `0001` only): `ONLINE_ORDER_ACCEPTED` with any `onlineOrderId` → `db.update(onlineOrders).set({ status: "ACCEPTED" })` succeeds
  - Observe on UNFIXED code: `ONLINE_ORDER_REJECTED` with any `onlineOrderId` and any `reason` string → succeeds
  - Observe on UNFIXED code: `ONLINE_ORDER_READY` with any `onlineOrderId` → succeeds
  - Write property-based test: for all valid `onlineOrderId` values, `ONLINE_ORDER_ACCEPTED` / `ONLINE_ORDER_REJECTED` / `ONLINE_ORDER_READY` succeed and produce the correct `online_orders` status update — from Preservation Requirements in design
  - Write property-based test: for all batches of mixed event types, `received` and `queued` counts are correct — from Preservation Requirements in design
  - Verify tests pass on UNFIXED code (confirms baseline behavior before migration)
  - **EXPECTED OUTCOME**: Tests PASS on unfixed code (this confirms the behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix for ERP missing cloud migration `0002_oval_shiver_man`

  - [ ] 3.1 Apply migration to the cloud PostgreSQL database (operational action)
    - Run from workspace root with production `DATABASE_URL` set:
      `DATABASE_URL=<cloud_postgres_url> pnpm --filter @gusto/db-schema db:migrate`
    - This executes `drizzle-kit migrate --config=drizzle.config.cloud.ts` and applies `0002_oval_shiver_man.sql`
    - Command is idempotent — safe to re-run if `0002` is already present
    - Confirm `__drizzle_migrations` table now contains `tag = '0002_oval_shiver_man'`
    - _Bug_Condition: `isBugCondition(dbState)` where `"0002_oval_shiver_man" NOT IN dbState`_
    - _Expected_Behavior: After migration, `orders`, `order_items`, `invoices`, `stock_transactions`, and `table_reservations` all reflect the full schema; `ORDER_COMPLETED` syncs succeed_
    - _Preservation: All event handlers not dependent on `0002`-added schema are unaffected_
    - _Requirements: 2.1, 2.3, 2.4_

  - [ ] 3.2 Add structured error classification in the ORDER_COMPLETED catch block
    - **File**: `apps/sync-worker/src/index.ts`
    - **Location**: The `catch (err)` block inside the `ORDER_COMPLETED` handler (after the `db.transaction(...)` call)
    - Add import for nothing new — `err?.code` is accessed directly from the error object
    - Detect PostgreSQL schema-mismatch errors using error code `'42703'` (undefined column) and `'42P01'` (undefined table)
    - Replace bare `console.error` with a `console.error(JSON.stringify({...}))` structured log entry containing: `level`, `worker`, `jobId`, `eventType`, `orderNumber`, `pgErrorCode`, `message`, and a `hint` field with value `'Database schema mismatch — run: pnpm --filter @gusto/db-schema db:migrate'` when `isSchemaMismatch` is true
    - Keep `Sentry.captureException(err)` and `throw err` unchanged
    - _Bug_Condition: `pgCode === '42703' || pgCode === '42P01'`_
    - _Expected_Behavior: Operators can identify missing migration from console logs without Sentry access_
    - _Preservation: Sentry capture and re-throw behavior unchanged; only the log format changes_
    - _Requirements: 2.2_

  - [ ] 3.3 Add `assertSchemaReady()` startup health-check in the sync worker
    - **File**: `apps/sync-worker/src/index.ts`
    - **Location**: After the `Sentry.init(...)` block, before the Queue and Worker declarations
    - Import `sql` from `drizzle-orm` (add to existing imports if not already present)
    - Implement `assertSchemaReady()` as an async function that queries `SELECT tag FROM __drizzle_migrations WHERE tag = '0002_oval_shiver_man' LIMIT 1` using `db.execute(sql\`...\`)`
    - If zero rows returned: emit a structured fatal log (`level: 'fatal'`, migration name, hint to run `db:migrate`) then call `process.exit(1)`
    - If the `__drizzle_migrations` table itself does not exist (catch block): log a fatal error and call `process.exit(1)`
    - If the row is present: log `[Startup] ✅ Schema health-check passed (0002_oval_shiver_man present)`
    - Call `await assertSchemaReady()` as a top-level await after the function definition
    - _Bug_Condition: `isBugCondition(dbState)` — worker detects missing migration at boot time_
    - _Expected_Behavior: Worker exits immediately with code 1 rather than consuming and exhausting jobs silently_
    - _Preservation: Worker startup sequence is unaffected when all migrations are present_
    - _Requirements: 1.2, 2.2_

  - [ ] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - ORDER_COMPLETED INSERT succeeds after 0002 migration applied
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (no `42703` / `42P01` errors)
    - Point the test database at the now-migrated PostgreSQL instance (with `0002` applied)
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms migration resolves the schema errors)
    - _Requirements: 2.1, 2.3, 2.4_

  - [ ] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Online order handlers and sync pull are unchanged after fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2 against the migrated database
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in online order and pull sync paths)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Re-run the full test suite (unit + property + integration tests)
  - Confirm Property 1 passes (bug condition exploration test now succeeds)
  - Confirm Property 2 passes (preservation tests still pass)
  - Confirm unit test for `assertSchemaReady()` — mock `__drizzle_migrations` without `0002` → `process.exit(1)` is called
  - Confirm unit test for structured error classifier — mock error with `code: '42703'` → JSON log contains `pgErrorCode` and migration hint
  - Ensure all tests pass; ask the user if questions arise.
