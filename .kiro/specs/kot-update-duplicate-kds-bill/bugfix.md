# Bugfix Requirements Document

## Introduction

When a KOT (Kitchen Order Ticket) item is removed from an in-progress order — for example due to an accidental punch — and the KOT is updated or refired, two distinct problems occur:

1. **KDS Duplication**: The KDS (Kitchen Display System) shows duplicate KOT cards for the same order. The original KOT (with the removed item still present) remains on the KDS display, and the updated/refired KOT appears as an additional new card alongside it, causing kitchen staff to prepare items twice.

2. **Bill Discrepancy**: The bill or invoice generated at checkout still references the original order state (before item removal), meaning the customer is billed for items that were already removed from the KOT.

Both bugs share the same trigger: removing an item from an order after a KOT has already been fired to the kitchen.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an item is removed from an order whose KOT has already been fired to the kitchen AND a new KOT is generated for the updated order THEN the KDS continues to display the original KOT card (with the removed item) alongside the new KOT card, showing duplicate kitchen tickets for the same order

1.2 WHEN an item is removed from an order whose KOT has already been fired AND the KDS reconnects or hydrates from the server THEN the original KOT (with the removed item) reappears on the KDS because it remains in PENDING or IN_PROGRESS status on the server without being updated to reflect the item removal

1.3 WHEN an item is removed from an order after a KOT has been fired AND checkout is initiated THEN the bill is generated using all order items including VOIDED items, causing the customer to be charged for items that were removed

### Expected Behavior (Correct)

2.1 WHEN an item is removed from an order whose KOT has already been fired AND a new KOT is generated for the updated order THEN the system SHALL emit a cancellation or update event for the original KOT to the KDS so the original KOT card is removed or updated and only the revised KOT is displayed

2.2 WHEN an item is removed from an order whose KOT has already been fired AND the KDS reconnects or hydrates from the server THEN the system SHALL return only KOTs that reflect the current state of the order, ensuring voided items are not shown as active KOT items on the KDS

2.3 WHEN an item is removed from an order after a KOT has been fired AND checkout is initiated THEN the system SHALL generate the bill using only active (non-voided) order items, excluding any items with status VOIDED from the invoice totals and line items

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a new order item is added and a KOT is fired for the first time THEN the system SHALL CONTINUE TO display the new KOT correctly on the KDS with all ordered items

3.2 WHEN a KOT is refired for genuinely new items added to an existing order (no removals involved) THEN the system SHALL CONTINUE TO display both the original KOT and the new KOT on the KDS as separate cards

3.3 WHEN a KOT item has its quantity reduced via void but is not fully removed THEN the system SHALL CONTINUE TO send a modification KOT to the KDS reflecting the reduced quantity

3.4 WHEN checkout is processed for an order where no items were voided THEN the system SHALL CONTINUE TO calculate and generate the bill correctly using all order items

3.5 WHEN a KOT is cancelled via the explicit cancel flow (with manager approval and reason) THEN the system SHALL CONTINUE TO emit the kot:cancelled event and remove the KOT from the KDS display
