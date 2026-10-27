/**
 * Bug Condition Exploration Test — KOT Duplication Bug
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * EXPECTED TO FAIL on UNFIXED code — failure confirms the bug exists.
 * DO NOT fix the code when this test fails.
 *
 * Bug: When `generateKOT` is called with explicit `itemIds` that includes
 * an item that already has a `kotId` (already sent to kitchen), those
 * already-fired items are incorrectly included in a new KOT, causing
 * KDS duplication. The fix path (`no-itemIds`) already excludes fired
 * items but the `itemIds` path does not.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { v4 as uuid } from "uuid";
import { createTestDb } from "./test-db.js";
import * as schema from "@gusto/db-schema/local";

// ─── Module mocks (must be declared before any import of the module under test) ───

// Mock the db module — replaced by our in-memory instance in beforeEach
vi.mock("../../db/index.js", () => ({ db: null }));

// Mock socket events — we don't need a real Socket.IO server for these unit tests
vi.mock("../../socket/events.js", () => ({
  emitKOTNew: vi.fn(),
  emitKOTStatusUpdate: vi.fn(),
  emitOrderUpdated: vi.fn(),
  emitKOTCancelled: vi.fn(),
  emitKOTRush: vi.fn(),
  emitKOTModification: vi.fn(),
}));

// Mock print service — no physical printer in tests
vi.mock("../print.service.js", () => ({
  queuePrint: vi.fn().mockResolvedValue(undefined),
}));

// Mock sync service — no cloud connection in tests
vi.mock("../sync.service.js", () => ({
  queueSyncEvent: vi.fn(),
}));

// Mock realtime uplink — no network in tests
vi.mock("../realtime-uplink.service.js", () => ({
  notifyCloudTableStatus: vi.fn(),
  flushOutbox: vi.fn().mockResolvedValue(undefined),
}));

// ─── Dynamic imports after mocks are set ───

// We import the db mock module so we can swap the `db` export dynamically
const dbModule = await import("../../db/index.js");
const eventsModule = await import("../../socket/events.js");

// Import the function under test AFTER mocks are in place
const { generateKOT } = await import("../kot.service.js");

// ─── Test helpers ───

function makeOrder(db: ReturnType<typeof createTestDb>) {
  const orderId = uuid();
  const now = new Date().toISOString();
  db.insert(schema.orders)
    .values({
      id: orderId,
      outletId: "test-outlet",
      organizationId: "test-org",
      orderNumber: `ORD-TEST-${orderId.slice(0, 6)}`,
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
  options: { kotId?: string | null; status?: string } = {}
) {
  const itemId = uuid();
  db.insert(schema.orderItems)
    .values({
      id: itemId,
      orderId,
      menuItemId: "menu-item-1",
      menuItemName: "Margherita Pizza",
      quantity: 1,
      unitPrice: 250,
      gstRate: "5",
      status: options.status ?? "PLACED",
      kotId: options.kotId ?? null,
    })
    .run();
  return itemId;
}

// ─── Tests ───

describe("Bug Condition Exploration — generateKOT re-sends already-fired items", () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    // Spin up a fresh in-memory DB for each test
    testDb = createTestDb();
    // Swap the singleton `db` export used inside kot.service.ts
    (dbModule as { db: unknown }).db = testDb;
    // Reset call history between tests
    vi.clearAllMocks();
  });

  /**
   * Bug Condition 1.2: When all items in `itemIds` already have a `kotId`,
   * `generateKOT` must throw "No items to send to kitchen".
   *
   * On UNFIXED code: `generateKOT` does NOT throw — it creates a new KOT
   * with the already-fired item, proving the duplication bug.
   */
  it(
    "EXPECTED FAIL (unfixed): calling generateKOT with an already-fired item ID throws 'No items to send to kitchen'",
    () => {
      // Arrange: an order with one item that was already sent to the kitchen
      const orderId = makeOrder(testDb);
      const existingKotId = uuid();
      const alreadyFiredItemId = makeOrderItem(testDb, orderId, {
        kotId: existingKotId, // item is already linked to a KOT — "fired"
        status: "PLACED",
      });

      // Act + Assert: calling generateKOT with the already-fired item's ID explicitly
      // should throw "No items to send to kitchen" because there are no NEW items to fire.
      //
      // On UNFIXED code this assertion FAILS — the function returns normally,
      // creating a second KOT that contains the already-fired item.
      expect(
        () => generateKOT(orderId, [alreadyFiredItemId]),
        "generateKOT should throw when all specified items are already linked to a KOT"
      ).toThrowError(/no items to send to kitchen/i);
    }
  );

  /**
   * Bug Condition 1.1: When `itemIds` includes a mix of fired and un-fired items,
   * only the un-fired items should appear in the new KOT.
   *
   * On UNFIXED code: the emitted `kot:new` payload contains BOTH items,
   * including the one already fired on a previous KOT.
   */
  it(
    "EXPECTED FAIL (unfixed): calling generateKOT with mixed fired/unfired items emits only the unfired item",
    () => {
      const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;

      // Arrange: one already-fired item, one new item
      const orderId = makeOrder(testDb);
      const existingKotId = uuid();
      const alreadyFiredItemId = makeOrderItem(testDb, orderId, {
        kotId: existingKotId,
        status: "PLACED",
      });
      const newItemId = makeOrderItem(testDb, orderId, {
        kotId: null, // un-fired
        status: "PLACED",
      });

      // Act: call generateKOT with both IDs in the explicit list
      generateKOT(orderId, [alreadyFiredItemId, newItemId]);

      // Assert: only the NEW (un-fired) item should appear in the emitted payload
      expect(emitKOTNew).toHaveBeenCalledOnce();
      const emittedPayload = emitKOTNew.mock.calls[0]![0] as {
        items: { name: string }[];
      };

      // On UNFIXED code this assertion FAILS:
      // The payload contains BOTH items (2 items) instead of just the 1 new item.
      expect(
        emittedPayload.items,
        "emitted KOT payload must contain only the un-fired item, not the already-fired one"
      ).toHaveLength(1);

      // Verify it's the right item that made it through (the new un-fired one)
      expect(emittedPayload.items[0]!.name).toBe("Margherita Pizza");
    }
  );

  /**
   * Complementary check: when called with no itemIds (normal path),
   * only un-fired items are included — this already works correctly on unfixed code.
   * Included here as a baseline to confirm test infrastructure works.
   */
  it("baseline: calling generateKOT with no itemIds only fires un-fired items (should pass on unfixed code)", () => {
    const emitKOTNew = eventsModule.emitKOTNew as ReturnType<typeof vi.fn>;

    const orderId = makeOrder(testDb);
    const existingKotId = uuid();

    // One already-fired item
    makeOrderItem(testDb, orderId, { kotId: existingKotId, status: "PLACED" });
    // One new item
    makeOrderItem(testDb, orderId, { kotId: null, status: "PLACED" });

    // No explicit itemIds — uses the correct branch
    generateKOT(orderId);

    expect(emitKOTNew).toHaveBeenCalledOnce();
    const payload = emitKOTNew.mock.calls[0]![0] as { items: unknown[] };
    expect(payload.items).toHaveLength(1);
  });
});
