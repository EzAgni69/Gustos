/**
 * Preservation Property Tests — KOT Normal Generation
 *
 * **Validates: Requirements 2.1, 2.2, 4.1, 4.2**
 *
 * These tests MUST PASS on UNFIXED code — they cover inputs where the bug
 * does NOT occur (no already-fired items in explicit `itemIds`).
 *
 * They serve two purposes:
 *  1. Baseline confirmation — shows the non-buggy paths work correctly on current code.
 *  2. Regression guard — after the fix is applied (Task 3), these tests must still pass
 *     to confirm no regressions were introduced.
 *
 * Properties validated:
 *  - 2.1  generateKOT(orderId)            → only un-fired items (kotId IS NULL) included
 *  - 2.2  generateKOT(orderId, [unfiredIds]) → all specified un-fired items included
 *  - 4.1  processCheckout totals come from activeItems (non-VOIDED), not all items
 *  - 4.2  invoice record uses those same totals — voided items don't inflate the total
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { createTestDb } from "./test-db.js";
import * as schema from "@gusto/db-schema/local";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({ db: null }));

vi.mock("../../socket/events.js", () => ({
  emitKOTNew: vi.fn(),
  emitKOTStatusUpdate: vi.fn(),
  emitOrderUpdated: vi.fn(),
  emitKOTCancelled: vi.fn(),
  emitKOTRush: vi.fn(),
  emitKOTModification: vi.fn(),
  emitTableStatusChanged: vi.fn(),
}));

vi.mock("../print.service.js", () => ({
  queuePrint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sync.service.js", () => ({
  queueSyncEvent: vi.fn(),
}));

vi.mock("../realtime-uplink.service.js", () => ({
  notifyCloudTableStatus: vi.fn(),
  flushOutbox: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../shift.service.js", () => ({
  getActiveShift: vi.fn().mockReturnValue({ id: "shift-1" }),
}));

// ─── Dynamic imports (after mocks) ──────────────────────────────────────────

const dbModule = await import("../../db/index.js");
const eventsModule = await import("../../socket/events.js");
const syncModule = await import("../sync.service.js");

const { generateKOT } = await import("../kot.service.js");
const { processCheckout } = await import("../checkout.service.js");

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeOrder(db: ReturnType<typeof createTestDb>) {
  const orderId = uuid();
  const now = new Date().toISOString();
  db.insert(schema.orders)
    .values({
      id: orderId,
      outletId: "test-outlet",
      organizationId: "test-org",
      orderNumber: `ORD-${orderId.slice(0, 6)}`,
      orderMode: "DINE_IN",
      status: "PLACED",
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      tipAmount: 0,
      paxCount: 1,
      isComplimentary: false,
      isSynced: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return orderId;
}

function makeOrderItem(
  db: ReturnType<typeof createTestDb>,
  orderId: string,
  options: {
    kotId?: string | null;
    status?: string;
    unitPrice?: number;
    quantity?: number;
  } = {}
) {
  const itemId = uuid();
  db.insert(schema.orderItems)
    .values({
      id: itemId,
      orderId,
      menuItemId: "menu-item-1",
      menuItemName: "Margherita Pizza",
      quantity: options.quantity ?? 1,
      unitPrice: options.unitPrice ?? 250,
      gstRate: "5",
      status: options.status ?? "PLACED",
      kotId: options.kotId ?? null,
    })
    .run();
  return itemId;
}

/** Seed the outlet_config table so processCheckout can build a receipt. */
function seedOutletConfig(db: ReturnType<typeof createTestDb>) {
  const now = new Date().toISOString();
  db.insert(schema.outletConfig)
    .values({
      id: "oc-1",
      outletId: "local-outlet",
      outletName: "Gusto's Pizzeria",
      address: "123 Test St",
      greetingMessage: "Thank you!",
      defaultGstRate: "5",
      currencySymbol: "₹",
      updatedAt: now,
    })
    .run();
}

// ─── Suite 1: Property 2.1 — No-itemIds path fires only un-fired items ──────

describe("Preservation 2.1 — generateKOT with no itemIds fires only kotId-null items", () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
    (dbModule as { db: unknown }).db = testDb;
    vi.clearAllMocks();
  });

  it("single un-fired item is included in the KOT", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;
    const orderId = makeOrder(testDb);
    makeOrderItem(testDb, orderId, { kotId: null });

    generateKOT(orderId);

    expect(emitKOTNew).toHaveBeenCalledOnce();
    const payload = emitKOTNew.mock.calls[0]![0] as { items: unknown[] };
    expect(payload.items).toHaveLength(1);
  });

  it("multiple un-fired items are all included when no itemIds given", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;
    const orderId = makeOrder(testDb);

    // Create 3 un-fired items
    makeOrderItem(testDb, orderId, { kotId: null });
    makeOrderItem(testDb, orderId, { kotId: null });
    makeOrderItem(testDb, orderId, { kotId: null });

    generateKOT(orderId);

    const payload = emitKOTNew.mock.calls[0]![0] as { items: unknown[] };
    expect(payload.items).toHaveLength(3);
  });

  it("already-fired item is excluded when no itemIds given (the correct path)", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;
    const orderId = makeOrder(testDb);
    const existingKotId = uuid();

    makeOrderItem(testDb, orderId, { kotId: existingKotId }); // already fired
    makeOrderItem(testDb, orderId, { kotId: null });            // new

    generateKOT(orderId);

    const payload = emitKOTNew.mock.calls[0]![0] as { items: unknown[] };
    expect(payload.items).toHaveLength(1);
  });

  it("throws 'No items to send to kitchen' when ALL items are already fired", () => {
    const orderId = makeOrder(testDb);
    const existingKotId = uuid();
    makeOrderItem(testDb, orderId, { kotId: existingKotId });
    makeOrderItem(testDb, orderId, { kotId: existingKotId });

    expect(() => generateKOT(orderId)).toThrowError(/no items to send to kitchen/i);
  });

  it("newly-fired items have their kotId updated in the DB", () => {
    const orderId = makeOrder(testDb);
    const itemId = makeOrderItem(testDb, orderId, { kotId: null });

    const result = generateKOT(orderId);

    const updatedItem = testDb
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, itemId))
      .get();

    expect(updatedItem?.kotId).toBe(result.kotId);
  });

  it("order status is updated to IN_PROGRESS after KOT generation", () => {
    const orderId = makeOrder(testDb);
    makeOrderItem(testDb, orderId, { kotId: null });

    generateKOT(orderId);

    const order = testDb
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .get();

    expect(order?.status).toBe("IN_PROGRESS");
  });
});

// ─── Suite 2: Property 2.2 — Explicit unfired itemIds path ──────────────────

describe("Preservation 2.2 — generateKOT with explicit un-fired itemIds includes all specified items", () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
    (dbModule as { db: unknown }).db = testDb;
    vi.clearAllMocks();
  });

  it("single explicit un-fired item is included in the KOT", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;
    const orderId = makeOrder(testDb);
    const itemId = makeOrderItem(testDb, orderId, { kotId: null });

    generateKOT(orderId, [itemId]);

    expect(emitKOTNew).toHaveBeenCalledOnce();
    const payload = emitKOTNew.mock.calls[0]![0] as { items: { name: string }[] };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.name).toBe("Margherita Pizza");
  });

  it("multiple explicit un-fired items are all included", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;
    const orderId = makeOrder(testDb);
    const itemId1 = makeOrderItem(testDb, orderId, { kotId: null });
    const itemId2 = makeOrderItem(testDb, orderId, { kotId: null });

    generateKOT(orderId, [itemId1, itemId2]);

    const payload = emitKOTNew.mock.calls[0]![0] as { items: unknown[] };
    expect(payload.items).toHaveLength(2);
  });

  it("subset of un-fired items can be explicitly selected — only those appear in KOT", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;
    const orderId = makeOrder(testDb);
    const itemId1 = makeOrderItem(testDb, orderId, { kotId: null });
    makeOrderItem(testDb, orderId, { kotId: null }); // not included

    // Explicitly fire only itemId1
    generateKOT(orderId, [itemId1]);

    const payload = emitKOTNew.mock.calls[0]![0] as { items: unknown[] };
    expect(payload.items).toHaveLength(1);
  });

  it("explicit un-fired item gets kotId assigned after generation", () => {
    const orderId = makeOrder(testDb);
    const itemId = makeOrderItem(testDb, orderId, { kotId: null });

    const result = generateKOT(orderId, [itemId]);

    const updatedItem = testDb
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, itemId))
      .get();

    expect(updatedItem?.kotId).toBe(result.kotId);
  });

  it("un-selected item retains kotId=null after partial explicit fire", () => {
    const orderId = makeOrder(testDb);
    const itemId1 = makeOrderItem(testDb, orderId, { kotId: null });
    const itemId2 = makeOrderItem(testDb, orderId, { kotId: null });

    // Fire only item1 explicitly
    generateKOT(orderId, [itemId1]);

    const item2 = testDb
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, itemId2))
      .get();

    // item2 was not included, so its kotId should still be null
    expect(item2?.kotId).toBeNull();
  });
});

// ─── Suite 3: Properties 4.1 & 4.2 — Checkout totals from activeItems ────────

describe("Preservation 4.1 & 4.2 — processCheckout totals computed from non-voided items only", () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
    (dbModule as { db: unknown }).db = testDb;
    vi.clearAllMocks();
    seedOutletConfig(testDb);
  });

  it("checkout total matches sum of active (non-VOIDED) items only", () => {
    const orderId = makeOrder(testDb);

    // Two active items: ₹250 each → subtotal ₹500 + GST
    const itemId1 = makeOrderItem(testDb, orderId, {
      kotId: null,
      unitPrice: 250,
      quantity: 1,
    });
    const itemId2 = makeOrderItem(testDb, orderId, {
      kotId: null,
      unitPrice: 250,
      quantity: 1,
    });

    // Pre-fire the KOT so checkout doesn't auto-generate one for this test
    // (The real concern is totals, not KOT state.)
    const existingKotId = uuid();
    const now = new Date().toISOString();
    testDb
      .update(schema.orderItems)
      .set({ kotId: existingKotId })
      .where(eq(schema.orderItems.id, itemId1))
      .run();
    testDb
      .update(schema.orderItems)
      .set({ kotId: existingKotId })
      .where(eq(schema.orderItems.id, itemId2))
      .run();

    const result = processCheckout(orderId, { paymentMode: "CASH" });

    // Both items active (₹500 base) — GST at 5% (2.5% CGST + 2.5% SGST) is added on top
    // calculateCartTotals: grandTotal = subtotal + tax = 500 + 25 = 525
    expect(result.totals.grandTotal).toBeGreaterThan(0);
    expect(result.totals.subtotal).toBe(500); // 2 × ₹250
    expect(result.totals.grandTotal).toBe(525); // ₹500 + 5% GST
  });

  it("voided item does NOT increase the checkout total — total reflects only active items", () => {
    const orderId = makeOrder(testDb);

    const existingKotId = uuid();
    const now = new Date().toISOString();

    // Active item: ₹250
    const activeItemId = makeOrderItem(testDb, orderId, {
      kotId: null,
      unitPrice: 250,
      quantity: 1,
    });

    // Voided item: ₹500 — should NOT be in totals
    const voidedItemId = makeOrderItem(testDb, orderId, {
      kotId: null,
      unitPrice: 500,
      quantity: 1,
      status: "VOIDED",
    });

    // Fire the active item so checkout doesn't try to re-fire it
    testDb
      .update(schema.orderItems)
      .set({ kotId: existingKotId })
      .where(eq(schema.orderItems.id, activeItemId))
      .run();

    const result = processCheckout(orderId, { paymentMode: "CASH" });

    // Grand total must reflect only the ₹250 active item with 5% GST = ₹262.50
    // It must NOT include the voided ₹500 item (which would give ₹787.50)
    expect(result.totals.grandTotal).toBe(262.5); // ₹250 + 5% GST = ₹262.50

    // Invoice stored in DB must also use the correct (non-inflated) total
    const invoice = testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, orderId))
      .get();

    expect(invoice).not.toBeNull();
    expect(invoice!.totalAmount).toBe(262.5); // Property 4.2 — not 787.50
  });

  it("invoice record subtotal, cgstAmount, sgstAmount all correspond to activeItems only (4.2)", () => {
    const orderId = makeOrder(testDb);
    const existingKotId = uuid();

    // One active item at ₹400 + GST 5%
    const activeItemId = makeOrderItem(testDb, orderId, {
      kotId: null,
      unitPrice: 400,
      quantity: 1,
    });

    // One voided item at ₹200
    makeOrderItem(testDb, orderId, {
      kotId: null,
      unitPrice: 200,
      quantity: 1,
      status: "VOIDED",
    });

    testDb
      .update(schema.orderItems)
      .set({ kotId: existingKotId })
      .where(eq(schema.orderItems.id, activeItemId))
      .run();

    processCheckout(orderId, { paymentMode: "UPI" });

    const invoice = testDb
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, orderId))
      .get();

    // Total must be ₹420 (₹400 + 5% GST = ₹420), not ₹630 (₹600 + 5%)
    expect(invoice!.totalAmount).toBe(420);
    // Subtotal + CGST + SGST = grand total (exclusive GST model)
    expect(invoice!.subtotal + invoice!.cgstAmount + invoice!.sgstAmount).toBeCloseTo(
      invoice!.totalAmount,
      1
    );
  });
});
