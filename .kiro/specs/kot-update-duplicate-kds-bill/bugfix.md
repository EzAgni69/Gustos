# Bugfix: KOT Update — Duplicate KDS Items & Stale Bill

## Introduction

When a KOT (Kitchen Order Ticket) item is removed due to an accidental punch and the order is updated or refired, two problems occur simultaneously:

1. **KDS Duplication** — The updated KOT causes duplicated items on the Kitchen Display System; the kitchen sees the same order items more than once on separate KOT cards.
2. **Stale Bill** — The bill/invoice still reflects the original order (before the item removal), so the customer is charged for items that were removed.

Both bugs share the same triggering scenario: a POS operator voids an item from a fired KOT and then either resets or updates the KOT. They are independent defects in two different service files.

---

## Bug Analysis

### Current Behavior (Defect)

**Bug 1 — KDS Duplication**

`generateKOT` in `kot.service.ts` accepts an optional `itemIds` parameter. When the POS UI's "Update KOT" or refire action calls `generateKOT(orderId, allVisibleItemIds)`, it explicitly passes the IDs of all currently visible order items — including items that already have a `kotId` (already sent to kitchen). The current guard only excludes already-fired items in the no-`itemIds` path:

```typescript
// Current (buggy)
const itemsToSend = itemIds
  ? allItems.filter((item) => itemIds.includes(item.id))   // no kotId check
  : allItems.filter((item) => !item.kotId);                // correctly excludes fired
```

This creates a brand-new KOT record with a new `kotId` containing the already-fired items, and emits a `kot:new` event to all KDS displays. Since the KDS `useKOTStore` deduplicates only by `kotId`, the new KOT card appears alongside the original one — the kitchen sees the same items twice.

**Bug 2 — Stale Bill**

`processCheckout` in `checkout.service.ts` correctly computes totals from `activeItems` (items where `status != "VOIDED"`). However, two downstream calls still reference the unfiltered `items` variable:

- `queueSyncEvent("ORDER_COMPLETED", { items: items.map(...) })` — sends voided items to cloud sync.
- `buildReceiptFromOrder({ ..., items })` — renders voided items on the printed receipt/bill.

This means the customer's bill and the cloud record include items that were voided before checkout.

### Expected Behavior (Correct)

**Fix 1 — KDS Duplication**

When `generateKOT` is called with explicit `itemIds`, items that already have a `kotId` must be excluded, identical to the no-`itemIds` path:

```typescript
// Fixed
const itemsToSend = itemIds
  ? allItems.filter((item) => itemIds.includes(item.id) && !item.kotId)
  : allItems.filter((item) => !item.kotId);
```

- If all specified items are already fired, the existing `"No items to send to kitchen"` error is thrown.
- If a mix of fired and un-fired items is specified, only the un-fired ones are included in the new KOT.
- The `voidItem` → `generateModificationKOT` → `emitKOTModification` flow already correctly notifies the kitchen of removed items; no additional kitchen notification is needed.

**Fix 2 — Stale Bill**

Replace `items` with `activeItems` in both the sync event and the receipt builder calls inside `processCheckout`:

```typescript
// Fixed
queueSyncEvent("ORDER_COMPLETED", {
  items: activeItems.map(...)   // was: items.map(...)
})

buildReceiptFromOrder({ ..., items: activeItems })   // was: items
```

The `activeItems` variable is already correctly defined in the function — only the two downstream usages need to be corrected.

### Unchanged Behavior (Regression Prevention)

The following behaviors must not change as a result of this fix:

1. **Normal KOT generation** — `generateKOT(orderId)` with no `itemIds` sends only un-fired items (`kotId IS NULL`). Already correct; must remain unchanged.
2. **Explicit KOT with all-new items** — `generateKOT(orderId, itemIds)` where all `itemIds` have `kotId IS NULL` must include all specified items without false exclusions.
3. **Reprint** — `reprintKOT(kotId)` re-emits the existing KOT with `isReprint: true`. KDS deduplication by `kotId` prevents duplicates. Unchanged.
4. **Cancellation KOT** — `cancelKOT` marks items VOIDED and emits `kot:cancelled`. KDS removes the card. Unchanged.
5. **Modification KOT** — `voidItem` → `generateModificationKOT` notifies the kitchen of per-item changes. Unchanged.
6. **Checkout totals** — Totals are already computed from `activeItems`. The fix does not touch the calculation logic.
7. **Invoice record** — The `schema.invoices` insert uses `totals` from `activeItems`. Unchanged.
8. **`getInvoice` function** — Already filters voided items when returning invoice data. Unchanged.

---

## Acceptance Criteria

### 1. KDS Duplication — Bug Condition

- **1.1** When `generateKOT` is called with explicit `itemIds` that includes an item already having a `kotId`, those already-fired items are silently excluded from the new KOT.
- **1.2** When all items in `itemIds` already have a `kotId`, `generateKOT` throws `"No items to send to kitchen"`.
- **1.3** When `generateKOT` is called with explicit `itemIds` containing a mix of fired and un-fired items, only the un-fired items are included in the new KOT.

### 2. KDS Duplication — Preservation

- **2.1** When `generateKOT` is called with no `itemIds`, only items with `kotId IS NULL` are included (existing behavior preserved).
- **2.2** When `generateKOT` is called with explicit `itemIds` where all items have `kotId IS NULL`, all specified items are included in the KOT.

### 3. Stale Bill — Bug Condition

- **3.1** After `processCheckout`, the `queueSyncEvent("ORDER_COMPLETED")` payload's `items` array must not contain any item with `status = "VOIDED"`.
- **3.2** After `processCheckout`, the data passed to `buildReceiptFromOrder` must not contain any item with `status = "VOIDED"`.

### 4. Stale Bill — Preservation

- **4.1** Totals (`subtotal`, `taxAmount`, `grandTotal`) are still calculated from `activeItems` — no change to the calculation logic.
- **4.2** The invoice record inserted into `schema.invoices` uses `totals` computed from `activeItems` — unchanged.
- **4.3** The `getInvoice` function already filters voided items — this remains unchanged.
