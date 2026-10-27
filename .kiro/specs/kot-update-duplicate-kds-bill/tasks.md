# Implementation Plan

## Overview

Fix two independent bugs triggered when a KOT item is removed (voided) and the order is refired or checked out:
1. `generateKOT` re-sends already-fired items when `itemIds` is provided explicitly, causing KDS duplication.
2. `processCheckout` passes the unfiltered `items` array (including VOIDED items) to the sync event and receipt builder, causing the bill to include removed items.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Already-Fired Items Re-Sent on Explicit Refire
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate that `generateKOT` with explicit `itemIds` re-sends already-fired items
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — an order with one fired item (`kotId` set) passed explicitly to `generateKOT`
  - Set up a test order with one order item that already has a `kotId` assigned (simulating a previously-fired KOT item)
  - Call `generateKOT(orderId, [alreadyFiredItemId])` with the already-fired item's ID in the explicit list
  - Assert: the function throws `"No items to send to kitchen"` (from Bug Condition 1.2 in bugfix.md)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS — `generateKOT` does NOT throw and instead creates a new KOT with the already-fired item, confirming the duplication bug
  - Document the counterexample found: e.g., `generateKOT(orderId, [firedItemId])` creates a new KOT instead of throwing
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Normal KOT Generation With Unfired Items
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (items with `kotId IS NULL`)
  - **Case A**: Call `generateKOT(orderId)` with no `itemIds` — observe only un-fired items are included
  - **Case B**: Call `generateKOT(orderId, [unfiredItemId])` with explicit ID of an un-fired item — observe the item is included in the new KOT
  - Write property-based test: for all order items where `kotId IS NULL`, calling `generateKOT` (with or without explicit IDs that reference only un-fired items) always includes those items in the resulting KOT
  - Verify tests pass on UNFIXED code (these cases are not affected by the bug)
  - Also verify: `processCheckout` totals computed from `activeItems` are correct on un-voided orders (Preservation 4.1, 4.2)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (baseline behavior confirmed)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 2.1, 2.2, 4.1, 4.2_

- [x] 3. Fix KOT duplication and stale bill bugs

  - [x] 3.1 Fix `generateKOT` to exclude already-fired items even when `itemIds` is explicit
    - Open `apps/pos-local-server/src/services/kot.service.ts`
    - Locate the `itemsToSend` filter block (around line 52–55):
      ```typescript
      const itemsToSend = itemIds
        ? allItems.filter((item) => itemIds.includes(item.id))
        : allItems.filter((item) => !item.kotId);
      ```
    - Change to add `&& !item.kotId` guard on the explicit-`itemIds` path:
      ```typescript
      const itemsToSend = itemIds
        ? allItems.filter((item) => itemIds.includes(item.id) && !item.kotId)
        : allItems.filter((item) => !item.kotId);
      ```
    - This ensures already-fired items are silently excluded regardless of whether `itemIds` is provided
    - The existing `"No items to send to kitchen"` error is thrown naturally when all specified items are already fired
    - _Bug_Condition: isBugCondition = itemIds provided AND some items in itemIds have kotId set_
    - _Expected_Behavior: those already-fired items are excluded; error thrown if none remain_
    - _Preservation: un-fired items in itemIds still included; no-itemIds path unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

  - [x] 3.2 Fix `processCheckout` to use `activeItems` for sync event and receipt builder
    - Open `apps/pos-local-server/src/services/checkout.service.ts`
    - Locate the `queueSyncEvent("ORDER_COMPLETED", ...)` call
    - Change `items: items.map(...)` to `items: activeItems.map(...)` in that payload
    - Locate the `buildReceiptFromOrder({ ..., items, ... })` call
    - Change `items` to `activeItems` in the `buildReceiptFromOrder` argument
    - Do NOT change `totals` computation — it already uses `activeItems` correctly
    - Do NOT change the `schema.invoices` insert — it uses `totals` which are already correct
    - _Bug_Condition: isBugCondition = order has VOIDED items at checkout time_
    - _Expected_Behavior: sync payload and receipt contain only non-VOIDED items_
    - _Preservation: totals calculation from activeItems unchanged; invoice record unchanged_
    - _Requirements: 3.1, 3.2, 4.1, 4.2_

  - [x] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Already-Fired Items Re-Sent on Explicit Refire
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 asserts `generateKOT(orderId, [firedItemId])` throws `"No items to send to kitchen"`
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES — confirms the KDS duplication bug is fixed
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Normal KOT Generation With Unfired Items
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS — confirms no regressions in normal KOT generation
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Both bugs are in `apps/pos-local-server/src/services/` — `kot.service.ts` and `checkout.service.ts`.
- The KDS (`apps/kds-tv`) already deduplicates by `kotId` in `useKOTStore` — no changes needed there.
- The `voidItem` → `generateModificationKOT` → `emitKOTModification` flow is already correct and must not be modified.
- The fix to `generateKOT` is a one-line guard; the fix to `processCheckout` is two variable name changes.
- Test the KDS duplication fix by running the pos-local-server tests. Test the billing fix by inspecting the `queueSyncEvent` payload and the receipt output in integration/unit tests.
