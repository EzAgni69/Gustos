# KOT Update — Duplicate KDS Items & Stale Bill Bugfix Design

## Overview

Two related bugs surface when a KOT item is removed (voided after being sent to the kitchen)
and the KOT is subsequently reprinted/refired:

1. **KDS Duplication**: The kitchen display shows duplicate items for the same order. The reprint
   path in `reprintKOT()` reads raw `kotItems` rows without filtering out voided `orderItems`,
   so the reprinted KOT contains items the waiter already removed. Simultaneously, the
   `voidItem()` flow also emits a `kot:modification` event, so the kitchen receives both a
   modification slip and a full reprint — showing the same order twice in different states.

2. **Stale Bill / Invoice**: The invoice stored at checkout time captures totals computed at
   that moment. If checkout happens after a void the totals are correct — but the printed bill
   (receipt) still comes from `reprintKOT()`, which builds its item list from the unfiltered
   `kotItems` snapshot. The cashier and customer therefore see an itemised receipt that still
   lists the removed item, even though the charge itself may be correct.

The fix strategy is minimal and targeted:

- In `reprintKOT()`: filter `kotItems` through the linked `orderItems` to exclude any item
  whose `orderItem.status === 'VOIDED'`, and skip emitting `emitKOTNew` when the reprint is
  triggered directly after a void (the `voidItem` flow already emits a `kot:modification`
  event — a second `kot:new` for the same `kotId` is redundant and misleading on the KDS).
- In `voidItem()` full-void path: when remaining items still exist on the KOT, only emit the
  modification event; do not also trigger `reprintKOT` unless explicitly requested by the user.
- In `processCheckout()`: ensure the bill's itemised list is always recomputed from
  `activeItems` (already filtered), and that the invoice creation stores a correct snapshot.
  Additionally, the `getInvoice()` helper already returns filtered `activeItems`; no change
  needed there, but it should be verified as correct.

---

## Glossary

- **Bug_Condition (C)**: An order flow where (a) one or more items on a fired KOT are voided,
  and (b) `reprintKOT()` is subsequently called for that KOT.
- **Property (P)**: The expected correct behaviour — the reprinted KOT and the KDS display
  must only show non-voided items; the bill must not list or charge for voided items.
- **Preservation**: All behaviours unrelated to the reprint-after-void path must remain
  unchanged: normal KOT firing, status bumps (PENDING → IN_PROGRESS → READY → SERVED),
  cancellation of an entire KOT, modification slips for other change types, checkout for
  orders with no voided items.
- **reprintKOT**: Function in `apps/pos-local-server/src/services/kot.service.ts` that
  re-emits an existing KOT to the kitchen display and reprints the physical ticket.
- **voidItem**: Function in `apps/pos-local-server/src/services/order.service.ts` that marks
  an `orderItem` as `VOIDED`, optionally cancels the parent KOT if all items are now voided,
  or sends a modification slip if some items remain.
- **generateModificationKOT**: Produces a correction slip KOT (`kotType: 'MODIFICATION'`)
  that tells the kitchen what changed — does not replace the original KOT on the KDS.
- **kotItems**: Snapshot rows in `schema.kotItems`; created when the KOT is fired and not
  updated when `orderItems` are voided.
- **orderItems**: Live rows in `schema.orderItems`; `status` field reflects current state
  including `VOIDED`.
- **emitKOTNew**: Socket.IO broadcast that causes every connected KDS to either add a new card
  (`ADD_KOT` reducer) or, if the `kotId` already exists, silently deduplicate. However, the
  items in the payload are still shown — if they contain voided items, the kitchen sees them.

---

## Bug Details

### Bug Condition

The bug manifests when:

1. An order has at least one item that was sent to the kitchen (has a `kotId`).
2. That item is voided (`removeItem` → `voidItem` flow, or direct `voidItem`).
3. `reprintKOT()` is called for that KOT (user taps "refire" / "reprint" on the POS UI).

The `reprintKOT` function fetches `kotItems` directly from the snapshot table, without
cross-checking `orderItems.status`, so voided items remain in the payload.

**Formal Specification:**

```
FUNCTION isBugCondition(kotId, orderItems, kotItems)
  INPUT:
    kotId      — ID of the KOT being reprinted
    orderItems — all orderItems linked to this kotId
    kotItems   — snapshot rows for this kotId
  OUTPUT: boolean

  voidedItemIds := { oi.id | oi IN orderItems
                             AND oi.kotId = kotId
                             AND oi.status = "VOIDED" }

  RETURN |voidedItemIds| > 0
END FUNCTION
```

### Examples

- **Item voided, KOT refired**: Order has "Margherita Pizza × 2" and "Penne Arrabbiata × 1"
  fired on KOT-042. Waiter voids "Penne Arrabbiata". Cashier taps Refire on POS.
  - **Actual (buggy)**: KDS receives `kot:new` with both "Margherita Pizza × 2" AND
    "Penne Arrabbiata × 1". Kitchen sees the removed item. Bill lists "Penne Arrabbiata"
    under the receipt items column.
  - **Expected**: KDS receives `kot:new` (or no event, since `voidItem` already sent
    `kot:modification`) with only "Margherita Pizza × 2". Bill does not list
    "Penne Arrabbiata".

- **All items voided, KOT refired**: Order has "Tiramisu × 1". Waiter voids it; `voidItem`
  cancels the entire KOT. Cashier taps Refire.
  - **Actual (buggy)**: `reprintKOT` on a CANCELLED KOT emits the original item list with no
    items filter, re-adding the cancelled KOT to the KDS.
  - **Expected**: `reprintKOT` on a CANCELLED KOT should either throw an error or produce an
    empty reprint with no items, not resurface the KOT on the KDS.

- **No void, normal reprint**: KOT-020 with "Garlic Bread × 2" is in progress; chef loses
  the paper slip and requests a reprint.
  - **Expected (preserved)**: Reprint shows "Garlic Bread × 2" exactly as before. No change
    to this path.

- **Quantity partial void, refire**: "Mojito × 3" voided down to "Mojito × 2" via partial
  void. KOT refired.
  - **Actual (buggy)**: Reprint uses `kotItems` quantity = 3 (original snapshot).
  - **Expected**: Reprint uses `orderItems` quantity = 2 (live value).

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Normal KOT generation (`generateKOT`) for new orders must continue to work exactly as before.
- KOT status bumps on the KDS (PENDING → IN_PROGRESS → READY → SERVED) must remain unaffected.
- Cancellation of an entire KOT via `cancelKOT()` (standalone, not via `voidItem`) must be
  unchanged.
- Modification KOT generation (`generateModificationKOT`) for MODIFIER_CHANGE and NOTE_CHANGE
  must remain unchanged.
- Checkout and invoice generation for orders with no voided items must remain unchanged.
- The `getInvoice()` helper already correctly returns `activeItems` (non-VOIDED) — this must
  not regress.
- Hydration of KDS on reconnect (REST `GET /api/kots`) must continue to filter voided items
  (already done in `listKOTs` via the `orderItem.status === 'VOIDED'` null-filter).

**Scope:**

All inputs where `isBugCondition` returns `false` — that is, KOTs with no voided items —
must produce exactly the same behaviour as before this fix. This includes:

- All standard KOT fire, reprint, and cancel operations with no voided items.
- Modification slips triggered by modifier/note changes (not quantity void).
- Any order that reaches checkout without having had any items voided post-KOT.

---

## Hypothesized Root Cause

Based on code inspection, the root causes are:

1. **`reprintKOT` reads stale `kotItems` snapshot without live status filter**
   - `kotItems` rows are written at KOT fire time and never updated when items are voided.
   - `reprintKOT` at line 352 of `kot.service.ts` fetches all `kotItems` for the KOT and
     maps them directly into the payload — no join to `orderItems` to check `status`.
   - Compare: `listKOTs` (line 196) does the join and returns `null` for voided items, then
     filters them out. `reprintKOT` does not.

2. **`reprintKOT` emits `emitKOTNew` even when `voidItem` already emitted `kot:modification`**
   - When the user calls reprint after a void, two kitchen notifications are sent:
     the modification event (correct) and a full `kot:new` with stale items (incorrect).
   - The KDS deduplicates by `kotId` in `ADD_KOT`, so a second `kot:new` for the same
     `kotId` will not add a new card — but the items in the payload of the `kot:new` event
     may overwrite what the KDS displayed after the modification event if the client
     processes events out of order or on reconnect.
   - More concretely, on reconnect `fetchActiveKOTs` is called (filtered correctly), but
     a `kot:new` that arrives after reconnect and before or during hydration will create a
     stale card if the KDS processes it before the hydrate deduplication.

3. **`reprintKOT` uses `kotItems.quantity` (snapshot) instead of `orderItems.quantity` (live)**
   - Partial voids reduce `orderItems.quantity` but do not update `kotItems.quantity`.
   - The reprint therefore shows the pre-void quantity on the physical ticket and in the KDS.

4. **No guard against reprinting a CANCELLED KOT**
   - `reprintKOT` has no status check. A fully-voided (hence CANCELLED) KOT can be reprinted,
     resurface on the KDS, and appear on a receipt with its cancelled items.

---

## Correctness Properties

Property 1: Bug Condition — Reprint Excludes Voided Items

_For any_ KOT reprint where `isBugCondition` is true (at least one linked `orderItem` is
VOIDED), the fixed `reprintKOT` function SHALL:

- build the item list by joining `kotItems` with `orderItems` and excluding rows where
  `orderItem.status = 'VOIDED'`,
- use `orderItem.quantity` (live value) rather than `kotItem.quantity` (snapshot) for each
  included item,
- not emit `emitKOTNew` if all items are voided (the KOT was fully cancelled),
- for partial voids, emit `emitKOTNew` with only the non-voided items and their current
  quantities.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Non-Voided Reprint Unchanged

_For any_ KOT reprint where `isBugCondition` is false (no linked `orderItem` is VOIDED),
the fixed `reprintKOT` function SHALL produce exactly the same result as the original
function — same items, same quantities, same socket event, same print template.

**Validates: Requirements 3.1, 3.2, 3.3**

---

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, all changes are confined to one function:

**File**: `apps/pos-local-server/src/services/kot.service.ts`

**Function**: `reprintKOT`

**Specific Changes:**

1. **Guard: reject reprint of a CANCELLED KOT**
   - After fetching the KOT record, check `if (kot.status === 'CANCELLED') throw new Error(...)`.
   - Prevents voided KOTs from resurface on the KDS.

2. **Replace `kotItems` lookup with a live-filtered join**
   - Instead of mapping `kotItems` directly, join each `kotItem` with its linked `orderItem`:
     ```ts
     const orderItemForKotItem = db
       .select()
       .from(schema.orderItems)
       .where(eq(schema.orderItems.id, kotItem.orderItemId))
       .get();
     if (!orderItemForKotItem || orderItemForKotItem.status === 'VOIDED') return null;
     ```
   - Collect non-null items only.

3. **Use live quantity from `orderItems`**
   - Replace `quantity: item.quantity` (from `kotItems`) with
     `quantity: orderItemForKotItem.quantity` in both the print template and the socket
     payload.

4. **Skip `emitKOTNew` when no active items remain**
   - After filtering, if `activeReprintItems.length === 0`, skip the socket emit and return
     early (or throw, depending on UX preference). The kitchen does not need a reprint card
     for a fully-voided KOT.

5. **Update print template item source**
   - `kotData.items` must use the filtered, live-quantity list to ensure the physical receipt
     is also correct.

No changes are needed in `voidItem`, `generateModificationKOT`, `checkout.service.ts`, or
the KDS-side code — those paths are already correct.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first surface counterexamples that
demonstrate the bug on the unfixed code, then verify the fix works correctly and preserves
all existing behaviour.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.
Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Call `reprintKOT` on a KOT that has at least one voided `orderItem` and
assert that the resulting socket payload and print template do NOT contain the voided item.
Run these tests on the UNFIXED code first to observe the failure.

**Test Cases:**

1. **Full Void Reprint**: Fire a KOT with one item, void that item (triggering KOT
   cancellation), then call `reprintKOT`. Assert that an error is thrown or the event is not
   emitted. (Will fail on unfixed code — the reprint goes through unchecked.)

2. **Partial Void Reprint — item exclusion**: Fire a KOT with items [A, B], void item B.
   Call `reprintKOT`. Assert the socket payload contains only item A. (Will fail on unfixed
   code — B appears in payload.)

3. **Partial Void Reprint — live quantity**: Fire a KOT with "Mojito × 3", partially void
   2 units (quantity reduced to 1). Call `reprintKOT`. Assert payload shows quantity = 1.
   (Will fail on unfixed code — shows quantity = 3.)

4. **Cancelled KOT Reprint Guard**: Set a KOT status to CANCELLED directly and call
   `reprintKOT`. Assert an error is thrown. (Will fail on unfixed code — no guard exists.)

**Expected Counterexamples:**

- The socket payload from `emitKOTNew` contains voided item names.
- The print template contains voided item names with original quantities.
- `reprintKOT` on a CANCELLED KOT does not throw.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function
produces the expected behaviour.

**Pseudocode:**

```
FOR ALL (kotId, orderItems, kotItems) WHERE isBugCondition(kotId, orderItems, kotItems) DO
  result := reprintKOT_fixed(kotId)
  ASSERT result.activeItems == filterNonVoided(orderItems, kotItems)
  ASSERT result.activeItems.every(i => i.quantity == liveOrderItemQuantity(i))
  ASSERT emittedPayload.items == result.activeItems
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (no voided items),
the fixed `reprintKOT` produces the same result as the original function.

**Pseudocode:**

```
FOR ALL (kotId, orderItems, kotItems) WHERE NOT isBugCondition(kotId, orderItems, kotItems) DO
  ASSERT reprintKOT_original(kotId).payload == reprintKOT_fixed(kotId).payload
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across different item counts and quantities.
- It catches edge cases like KOTs with a single item, KOTs with modifiers, or KOTs
  with notes that manual tests might miss.
- It provides strong guarantees that behaviour is unchanged for all non-buggy inputs.

**Test Plan**: Observe that normal reprints work correctly on unfixed code, then write
property-based tests asserting the same output post-fix.

**Test Cases:**

1. **No-Void Reprint Preservation**: Fire a KOT, do not void any items, call `reprintKOT`.
   Assert that the payload and print template are identical before and after the fix.
2. **Multi-Item No-Void Preservation**: Fire a KOT with 5 items, no voids.
   Assert all 5 items appear in the reprint with correct quantities.
3. **Modifier/Note Preservation**: Fire a KOT where items have modifiers and notes.
   Assert that modifiers and notes survive the new join-based lookup.

### Unit Tests

- Test `reprintKOT` with a KOT where one of two items is voided: assert only the live item
  appears in the emitted payload.
- Test `reprintKOT` with a CANCELLED KOT: assert an error is thrown.
- Test `reprintKOT` with partial void (quantity reduced): assert the emitted quantity matches
  the live `orderItem.quantity`, not the `kotItem.quantity` snapshot.
- Test `reprintKOT` with no voided items: assert output is identical to pre-fix behaviour
  (regression guard).

### Property-Based Tests

- Generate random sets of [kotItems, orderItems] where some order items are VOIDED.
  Assert that `reprintKOT` emits only non-voided items with live quantities.
- Generate random sets where no order items are VOIDED.
  Assert that `reprintKOT` output matches the original snapshot behaviour exactly.
- Generate KOTs across varied item counts (1–10 items) with random void ratios.
  Assert the fix is consistent regardless of how many items are voided.

### Integration Tests

- Full flow: create order → fire KOT → void one item (voidItem path) → refire (reprintKOT)
  → assert KDS receives only the non-voided item.
- Full flow: create order → fire KOT → void all items → refire → assert error is thrown and
  KDS does not receive a duplicate card.
- Full flow: checkout after partial void → assert invoice `items` list and `totalAmount` do
  not include the voided item.
