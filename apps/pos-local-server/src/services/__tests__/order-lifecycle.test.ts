/**
 * Order lifecycle — end-to-end service tests against a real (in-memory) SQLite
 * database built from the production migrations.
 *
 * Covers the money path and its edge cases: totals, discounts, checkout,
 * complimentary bills, split payments, cancellation, voids, moving items,
 * shift cash reconciliation, undo, and transactional rollback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { createTestDb } from "./test-db.js";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../db/index.js", () => ({
  get db() {
    return holder.db;
  },
}));

const emitted = vi.hoisted(() => ({ events: [] as Array<{ name: string; data: unknown }> }));
vi.mock("../../socket/events.js", () => {
  const record = (name: string) => (data: unknown) => {
    emitted.events.push({ name, data });
  };
  return {
    emitKOTNew: record("kot:new"),
    emitKOTStatusUpdate: record("kot:status-update"),
    emitOrderUpdated: record("order:updated"),
    emitKOTCancelled: record("kot:cancelled"),
    emitKOTRush: record("kot:rush"),
    emitKOTModification: record("kot:modification"),
    emitTableStatusChanged: record("table:status-changed"),
    emitOrderModeChanged: record("order:mode-changed"),
    emitOrderItemsMoved: record("order:items-moved"),
    emitOnlineOrderReceived: record("online-order:received"),
    emitKOTStationStatus: record("kot:station-status"),
    emitExpoOrderReady: record("expo:order-ready"),
    emitExpoOrderRecalled: record("expo:order-recalled"),
  };
});

vi.mock("../print.service.js", () => ({
  queuePrint: vi.fn().mockResolvedValue(undefined),
  isKotPrintingEnabled: () => false,
}));

vi.mock("../realtime-uplink.service.js", () => ({
  notifyCloudTableStatus: vi.fn(),
  flushOutbox: vi.fn().mockResolvedValue(undefined),
}));

const orders = await import("../order.service.js");
const { processCheckout } = await import("../checkout.service.js");
const { generateKOT, updateKOTStatus } = await import("../kot.service.js");
const shifts = await import("../shift.service.js");
const { undoLastAction, canUndo } = await import("../undo.service.js");
const { voidSettledOrder } = await import("../settlement.service.js");
const { atomic, afterCommit } = await import("../../db/tx.js");
const session = await import("../session.service.js");

type TestDb = ReturnType<typeof createTestDb>;
let db: TestDb;

const TABLE_1 = "table-1";
const TABLE_2 = "table-2";

function seed() {
  db.insert(schema.diningTables)
    .values([
      { id: TABLE_1, outletId: "outlet", name: "T1", capacity: 4, status: "AVAILABLE", sortOrder: 1 },
      { id: TABLE_2, outletId: "outlet", name: "T2", capacity: 4, status: "AVAILABLE", sortOrder: 2 },
    ])
    .run();
  db.insert(schema.menuCategories).values({ id: "cat-pizza", outletId: "outlet", name: "Pizza" }).run();
  const now = new Date().toISOString();
  db.insert(schema.menuItems)
    .values([
      { id: "pizza", categoryId: "cat-pizza", outletId: "outlet", name: "Margherita", price: 200, gstRate: "5", createdAt: now, updatedAt: now },
      { id: "sold-out", categoryId: "cat-pizza", outletId: "outlet", name: "Truffle", price: 900, gstRate: "5", isAvailable: false, createdAt: now, updatedAt: now },
    ])
    .run();
}

const pizza = (quantity = 1, extra: Record<string, unknown> = {}) => ({
  menuItemId: "pizza",
  menuItemName: "Margherita",
  quantity,
  unitPrice: 200,
  gstRate: "5" as const,
  ...extra,
});

const beer = (quantity = 1) => ({
  menuItemId: "beer",
  menuItemName: "Craft Beer",
  quantity,
  unitPrice: 100,
  gstRate: "18" as const,
});

function dineIn(tableId = TABLE_1) {
  return orders.createOrder({ orderMode: "DINE_IN", tableId })!;
}

function table(id: string) {
  return db.select().from(schema.diningTables).where(eq(schema.diningTables.id, id)).get()!;
}

function orderRow(id: string) {
  return db.select().from(schema.orders).where(eq(schema.orders.id, id)).get()!;
}

beforeEach(() => {
  db = createTestDb();
  holder.db = db;
  emitted.events = [];
  seed();
});

describe("order creation & items", () => {
  it("occupies the table and reuses the table's open order instead of duplicating it", () => {
    const first = dineIn();
    expect(table(TABLE_1).status).toBe("OCCUPIED");
    expect(table(TABLE_1).currentOrderId).toBe(first.id);

    const second = dineIn();
    expect(second.id).toBe(first.id);
    expect(db.select().from(schema.orders).all()).toHaveLength(1);
  });

  it("rejects an unknown order mode and an unknown table", () => {
    expect(() => orders.createOrder({ orderMode: "BUFFET" as never })).toThrow(/orderMode/);
    expect(() => orders.createOrder({ orderMode: "DINE_IN", tableId: "nope" })).toThrow(/Table not found/);
  });

  it("computes totals with GST per slab", () => {
    const order = dineIn();
    const updated = orders.addItemsToOrder(order.id, [pizza(2), beer(1)])!;
    // 400 @5% = 20, 100 @18% = 18
    expect(updated.subtotal).toBe(500);
    expect(updated.taxAmount).toBe(38);
    expect(updated.totalAmount).toBe(538);
    expect(updated.status).toBe("PLACED");
  });

  it("ignores a repeated save of the same client line (offline replay)", () => {
    const order = dineIn();
    const clientItemId = "11111111-1111-4111-8111-111111111111";
    orders.addItemsToOrder(order.id, [pizza(1, { clientItemId })]);
    const again = orders.addItemsToOrder(order.id, [pizza(1, { clientItemId })])!;
    expect(again.items).toHaveLength(1);
    expect(again.subtotal).toBe(200);
  });

  it.each([
    ["zero quantity", pizza(0)],
    ["fractional quantity", pizza(1.5)],
    ["negative price", pizza(1, { unitPrice: -5 })],
    ["NaN price", pizza(1, { unitPrice: Number.NaN })],
    ["bad GST slab", pizza(1, { gstRate: "7" })],
  ])("rejects %s without writing anything", (_label, item) => {
    const order = dineIn();
    expect(() => orders.addItemsToOrder(order.id, [pizza(1), item as never])).toThrow();
    expect(db.select().from(schema.orderItems).all()).toHaveLength(0);
  });

  it("refuses an item that was 86'd", () => {
    const order = dineIn();
    expect(() =>
      orders.addItemsToOrder(order.id, [{ menuItemId: "sold-out", menuItemName: "Truffle", quantity: 1, unitPrice: 900, gstRate: "5" }])
    ).toThrow(/unavailable/);
  });

  it("does not let an item id from another order be edited through this order", () => {
    const a = dineIn(TABLE_1);
    const b = dineIn(TABLE_2);
    const bItem = orders.addItemsToOrder(b.id, [pizza(1)])!.items[0]!;
    expect(() => orders.updateItemQuantity(a.id, bItem.id, 5)).toThrow(/not found on this order/);
    expect(() => orders.voidItem(a.id, bItem.id, "oops", "Manager")).toThrow(/not found on this order/);
  });
});

describe("discounts", () => {
  it("applies an order discount before tax and stores a label", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(2)]);
    const updated = orders.applyDiscount(order.id, { type: "PERCENTAGE", value: 10 })!;
    expect(updated.discountAmount).toBe(40);
    expect(updated.taxAmount).toBe(18); // 5% of 360
    expect(updated.totalAmount).toBe(378);
    expect(updated.discountLabel).toBe("10% Off");
  });

  it("rejects discounts that would produce a negative bill", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1)]);
    expect(() => orders.applyDiscount(order.id, { type: "PERCENTAGE", value: 150 })).toThrow(/100/);
    expect(() => orders.applyDiscount(order.id, { type: "FLAT", value: -1 })).toThrow();
    // A flat discount larger than the bill is capped at the bill
    const capped = orders.applyDiscount(order.id, { type: "FLAT", value: 5000 })!;
    expect(capped.totalAmount).toBe(0);
  });

  it("counts item-level discounts in the bill", () => {
    const order = dineIn();
    const withItems = orders.addItemsToOrder(order.id, [pizza(2), beer(1)])!;
    const pizzaLine = withItems.items.find((i) => i.menuItemId === "pizza")!;
    const updated = orders.applyItemDiscount(order.id, pizzaLine.id, { type: "PERCENTAGE", value: 50 })!;
    // pizza 400 → 200 (+5% = 10), beer 100 (+18% = 18)
    expect(updated.subtotal).toBe(500);
    expect(updated.discountAmount).toBe(200);
    expect(updated.taxAmount).toBe(28);
    expect(updated.totalAmount).toBe(328);
  });
});

describe("checkout", () => {
  it("settles cash, computes change itself, frees the table and fires unfired items", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(2)]); // 420 incl. GST

    const result = processCheckout(order.id, {
      paymentMode: "CASH",
      tenderedAmount: 500,
      changeDue: 9999, // a lying client must not be trusted
    });

    expect(result.totals.grandTotal).toBe(420);
    expect(result.changeDue).toBe(80);
    expect(orderRow(order.id).status).toBe("COMPLETED");
    expect(table(TABLE_1).status).toBe("AVAILABLE");
    expect(table(TABLE_1).currentOrderId).toBeNull();

    const invoice = db.select().from(schema.invoices).where(eq(schema.invoices.orderId, order.id)).get()!;
    expect(invoice.isPaid).toBe(true);
    expect(invoice.changeDue).toBe(80);
    expect(invoice.cgstRate).toBe(2.5);

    // Unfired items were sent to the kitchen as part of settling
    expect(db.select().from(schema.kitchenOrderTickets).all()).toHaveLength(1);
  });

  it("cannot be paid twice", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1)]);
    processCheckout(order.id, { paymentMode: "UPI" });
    expect(() => processCheckout(order.id, { paymentMode: "UPI" })).toThrow(/already completed/);
    expect(db.select().from(schema.invoices).all()).toHaveLength(1);
  });

  it("rejects short cash, bad modes and empty orders, leaving the order open", () => {
    const order = dineIn();
    expect(() => processCheckout(order.id, { paymentMode: "CASH" })).toThrow(/empty/);
    orders.addItemsToOrder(order.id, [pizza(1)]); // 210
    expect(() => processCheckout(order.id, { paymentMode: "CASH", tenderedAmount: 100 })).toThrow(/less than/);
    expect(() => processCheckout(order.id, { paymentMode: "BITCOIN" as never })).toThrow(/paymentMode/);
    expect(() => processCheckout(order.id, { paymentMode: "CARD", tipAmount: -10 })).toThrow(/tipAmount/);
    expect(orderRow(order.id).status).not.toBe("COMPLETED");
    expect(db.select().from(schema.invoices).all()).toHaveLength(0);
  });

  it("validates split legs against the payable total including tip", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1)]); // 210
    expect(() =>
      processCheckout(order.id, {
        paymentMode: "SPLIT",
        tipAmount: 10,
        paymentSplits: [
          { mode: "CASH", amount: 100 },
          { mode: "UPI", amount: 110 },
        ],
      })
    ).toThrow(/do not match/);

    const ok = processCheckout(order.id, {
      paymentMode: "SPLIT",
      tipAmount: 10,
      paymentSplits: [
        { mode: "CASH", amount: 100 },
        { mode: "UPI", amount: 120 },
      ],
    });
    expect(ok.payableTotal).toBe(220);
  });

  it("bills a complimentary order at zero", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(2)]);
    orders.markAsComplimentary(order.id, "Owner's guest", "Dave");
    const result = processCheckout(order.id, { paymentMode: "CASH", tenderedAmount: 0 });

    expect(result.totals.grandTotal).toBe(0);
    expect(result.paymentSubMethod).toBe("COMPLIMENTARY");
    const row = orderRow(order.id);
    expect(row.totalAmount).toBe(0);
    expect(row.taxAmount).toBe(0);
    expect(row.discountLabel).toBe("Complimentary");
  });

  it("prints mixed GST slabs without a single misleading rate", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1), beer(1)]);
    processCheckout(order.id, { paymentMode: "CARD" });
    const invoice = db.select().from(schema.invoices).where(eq(schema.invoices.orderId, order.id)).get()!;
    expect(invoice.cgstRate).toBe(0);
  });
});

describe("cancel / void / move", () => {
  it("cancelling an order stops the kitchen and frees the table", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1)]);
    const kot = generateKOT(order.id);

    orders.cancelOrder(order.id, "user-1", { reason: "Guest left" });

    expect(orderRow(order.id).status).toBe("CANCELLED");
    expect(table(TABLE_1).status).toBe("AVAILABLE");
    const kotRow = db.select().from(schema.kitchenOrderTickets).where(eq(schema.kitchenOrderTickets.id, kot.kotId)).get()!;
    expect(kotRow.status).toBe("CANCELLED");
    expect(emitted.events.some((e) => e.name === "kot:cancelled")).toBe(true);
  });

  it("a paid order cannot be cancelled, only voided as a settled bill", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1)]);
    processCheckout(order.id, { paymentMode: "CARD" });
    expect(() => orders.cancelOrder(order.id)).toThrow(/void the settled bill/);
    expect(() => orders.addItemsToOrder(order.id, [pizza(1)])).toThrow(/completed/);
    expect(() => orders.applyDiscount(order.id, { type: "FLAT", value: 10 })).toThrow(/completed/);
  });

  it("does not free a table that has since been given to another order", () => {
    const first = dineIn();
    orders.addItemsToOrder(first.id, [pizza(1)]);
    // Move the first order's table pointer to simulate a transfer + reseat
    const second = orders.createOrder({ orderMode: "TAKEAWAY" })!;
    db.update(schema.diningTables).set({ currentOrderId: second.id }).where(eq(schema.diningTables.id, TABLE_1)).run();
    orders.addItemsToOrder(second.id, [pizza(1)]);

    orders.cancelOrder(first.id);
    expect(table(TABLE_1).status).toBe("OCCUPIED");
    expect(table(TABLE_1).currentOrderId).toBe(second.id);
  });

  it("partially voids a fired item and recalculates the bill", () => {
    const order = dineIn();
    const item = orders.addItemsToOrder(order.id, [pizza(3)])!.items[0]!;
    generateKOT(order.id);

    const updated = orders.voidItem(order.id, item.id, "Dropped", "Priya", "user-1", 1)!;
    expect(updated.items[0]!.quantity).toBe(2);
    expect(updated.subtotal).toBe(400);

    expect(() => orders.voidItem(order.id, item.id, "x", "y", undefined, 9)).toThrow(/voidQuantity/);
    expect(() => orders.voidItem(order.id, item.id, "", "y")).toThrow(/reason/);
  });

  it("cancelling a KOT removes its items from the bill", async () => {
    const { cancelKOT } = await import("../kot.service.js");
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(2)]);
    const kot = generateKOT(order.id);
    orders.addItemsToOrder(order.id, [beer(1)]);

    cancelKOT(kot.kotId, "Wrong table", "Priya");
    const row = orderRow(order.id);
    expect(row.subtotal).toBe(100);
    expect(row.totalAmount).toBe(118);
  });

  it("moving every item of a fired ticket carries the ticket to the new order", () => {
    const source = dineIn(TABLE_1);
    const items = orders.addItemsToOrder(source.id, [pizza(1), beer(1)])!.items;
    const kot = generateKOT(source.id);

    const result = orders.moveItemsToOrder(source.id, items.map((i) => i.id), undefined, TABLE_2);

    expect(result.targetOrder!.items).toHaveLength(2);
    expect(result.targetOrder!.status).toBe("IN_PROGRESS");
    expect(result.targetOrder!.totalAmount).toBe(328);
    const kotRow = db.select().from(schema.kitchenOrderTickets).where(eq(schema.kitchenOrderTickets.id, kot.kotId)).get()!;
    expect(kotRow.orderId).toBe(result.targetOrder!.id);
    // Source emptied → cancelled and its table released
    expect(orderRow(source.id).status).toBe("CANCELLED");
    expect(table(TABLE_1).status).toBe("AVAILABLE");
    expect(table(TABLE_2).status).toBe("OCCUPIED");
  });

  it("refuses to merge an order into itself or into a closed order", () => {
    const a = dineIn(TABLE_1);
    const b = dineIn(TABLE_2);
    orders.addItemsToOrder(a.id, [pizza(1)]);
    orders.addItemsToOrder(b.id, [pizza(1)]);
    expect(() => orders.mergeOrders(a.id, a.id)).toThrow(/itself/);
    processCheckout(b.id, { paymentMode: "CARD" });
    expect(() => orders.mergeOrders(a.id, b.id)).toThrow(/cannot merge into it/);
  });

  it("recalling a ready ticket takes the order back out of READY", () => {
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(1)]);
    const kot = generateKOT(order.id);
    updateKOTStatus(kot.kotId, "READY");
    expect(orderRow(order.id).status).toBe("READY");
    updateKOTStatus(kot.kotId, "IN_PROGRESS");
    expect(orderRow(order.id).status).toBe("IN_PROGRESS");
  });
});

describe("online orders", () => {
  const payload = {
    onlineOrderId: "cloud-123",
    order_id: "ZOM-9",
    provider: "ZOMATO",
    customer: { name: "Asha" },
    items: [
      { item_name: "Margherita", quantity: 2, unit_price: 220 },
      { item_name: "Broken line", quantity: 0, unit_price: 10 },
    ],
  };

  it("is idempotent on the cloud order id and stays DRAFT until accepted", () => {
    const first = orders.createOnlineOrderFromWebhook(payload);
    const second = orders.createOnlineOrderFromWebhook(payload);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.order!.id).toBe(first.order!.id);
    expect(db.select().from(schema.orders).all()).toHaveLength(1);

    expect(first.order!.status).toBe("DRAFT");
    expect(first.order!.items).toHaveLength(1); // unusable line skipped
    expect(first.order!.items[0]!.menuItemId).toBe("pizza");

    expect(() => generateKOT(first.order!.id)).toThrow(/Accept the online order/);
    const accepted = orders.acceptOnlineOrder(first.order!.id)!;
    expect(accepted.status).toBe("PLACED");
    expect(orders.getOnlineOrderId(accepted.notes)).toBe("cloud-123");
  });
});

describe("shift cash reconciliation", () => {
  it("counts a bill in the shift where it was paid and reconciles the drawer", () => {
    // Order opened BEFORE the shift starts
    const order = dineIn();
    orders.addItemsToOrder(order.id, [pizza(2)]); // 420
    db.update(schema.orders).set({ createdAt: "2020-01-01T00:00:00.000Z" }).where(eq(schema.orders.id, order.id)).run();

    const shift = shifts.openShift({ cashierId: "u1", cashierName: "Rahul", openingFloat: 1000 });
    processCheckout(order.id, { paymentMode: "CASH", tenderedAmount: 500, tipAmount: 20 }); // keeps 440, returns 60

    const card = orders.createOrder({ orderMode: "TAKEAWAY" })!;
    orders.addItemsToOrder(card.id, [pizza(1)]); // 210
    processCheckout(card.id, { paymentMode: "CARD" });

    const split = orders.createOrder({ orderMode: "TAKEAWAY" })!;
    orders.addItemsToOrder(split.id, [pizza(1)]); // 210
    processCheckout(split.id, {
      paymentMode: "SPLIT",
      paymentSplits: [
        { mode: "CASH", amount: 110 },
        { mode: "UPI", amount: 100 },
      ],
    });

    const x = shifts.generateXReport(shift.id);
    expect(x.totalOrders).toBe(3);
    expect(x.totalCashSales).toBe(420);
    expect(x.totalCardSales).toBe(210);
    expect(x.totalSplitSales).toBe(210);
    expect(x.totalTips).toBe(20);
    // float 1000 + cash bill 420 + cash tip 20 + cash leg 110
    expect(x.expectedCashInDrawer).toBe(1550);

    const z = shifts.closeShift(shift.id, { actualCashInDrawer: 1540 });
    expect(z.cashVariance).toBe(-10);
    expect(z.status).toBe("CLOSED");
    expect(() => shifts.closeShift(shift.id, { actualCashInDrawer: 1 })).toThrow(/already closed/);
  });

  it("drops a voided bill from the open shift and locks bills of a closed one", () => {
    const shift = shifts.openShift({ cashierId: "u1", cashierName: "Rahul", openingFloat: 0 });
    const order = orders.createOrder({ orderMode: "TAKEAWAY" })!;
    orders.addItemsToOrder(order.id, [pizza(1)]);
    processCheckout(order.id, { paymentMode: "CASH", tenderedAmount: 210 });
    expect(shifts.generateXReport(shift.id).expectedCashInDrawer).toBe(210);

    voidSettledOrder(order.id, { reason: "Wrong bill", approvedBy: "Priya" });
    expect(shifts.generateXReport(shift.id).expectedCashInDrawer).toBe(0);

    const second = orders.createOrder({ orderMode: "TAKEAWAY" })!;
    orders.addItemsToOrder(second.id, [pizza(1)]);
    processCheckout(second.id, { paymentMode: "CASH", tenderedAmount: 210 });
    shifts.closeShift(shift.id, { actualCashInDrawer: 210 });
    expect(() => voidSettledOrder(second.id, { reason: "Late", approvedBy: "Priya" })).toThrow(/already closed/);
  });

  it("allows only one open shift and returns history newest first", () => {
    const first = shifts.openShift({ cashierId: "u1", cashierName: "Rahul", openingFloat: 0 });
    expect(() => shifts.openShift({ cashierId: "u2", cashierName: "Priya", openingFloat: 0 })).toThrow(/already open/);
    expect(() => shifts.openShift({ cashierId: "u2", cashierName: "Priya", openingFloat: -5 })).toThrow();
    shifts.closeShift(first.id, { actualCashInDrawer: 0 });
    db.update(schema.cashierShifts).set({ openedAt: "2020-01-01T00:00:00.000Z" }).where(eq(schema.cashierShifts.id, first.id)).run();
    const second = shifts.openShift({ cashierId: "u2", cashierName: "Priya", openingFloat: 0 });
    expect(shifts.getShiftHistory(1)[0]!.id).toBe(second.id);
  });
});

describe("undo", () => {
  it("restores a removed unfired item without touching fired ones", () => {
    const order = dineIn();
    const fired = orders.addItemsToOrder(order.id, [pizza(1)])!.items[0]!;
    generateKOT(order.id);
    const unfired = orders.addItemsToOrder(order.id, [beer(2)])!.items.find((i) => i.menuItemId === "beer")!;

    orders.removeItem(order.id, unfired.id);
    expect(orders.getOrderById(order.id)!.items).toHaveLength(1);
    expect(canUndo(order.id).available).toBe(true);

    const restored = undoLastAction(order.id)!;
    expect(restored.items).toHaveLength(2);
    expect(restored.totalAmount).toBe(210 + 236);
    expect(restored.items.find((i) => i.id === fired.id)!.kotId).toBeTruthy();
    expect(canUndo(order.id).available).toBe(false);
  });
});

describe("transactions", () => {
  it("rolls back every write and drops queued side effects when a step fails", () => {
    const effect = vi.fn();
    expect(() =>
      atomic(() => {
        const order = orders.createOrder({ orderMode: "DINE_IN", tableId: TABLE_1 })!;
        orders.addItemsToOrder(order.id, [pizza(1)]);
        afterCommit(effect);
        throw new Error("boom");
      })
    ).toThrow("boom");

    expect(db.select().from(schema.orders).all()).toHaveLength(0);
    expect(db.select().from(schema.orderItems).all()).toHaveLength(0);
    expect(db.select().from(schema.syncOutbox).all()).toHaveLength(0);
    expect(table(TABLE_1).status).toBe("AVAILABLE");
    expect(effect).not.toHaveBeenCalled();
  });

  it("runs side effects only after the outermost commit", () => {
    const calls: string[] = [];
    atomic(() => {
      atomic(() => afterCommit(() => calls.push("inner")));
      calls.push("body");
    });
    expect(calls).toEqual(["body", "inner"]);
  });
});

describe("session tokens", () => {
  it("round-trips, and rejects tampered or expired tokens", () => {
    const { token } = session.issueSessionToken("user-1");
    expect(session.verifySessionToken(token)).toBe("user-1");

    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "owner", exp: Date.now() + 1e9 })).toString("base64url");
    expect(session.verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(session.verifySessionToken(`${body}.AAAA`)).toBeNull();
    expect(session.verifySessionToken("garbage")).toBeNull();
    expect(session.verifySessionToken(undefined)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000 * 3600 * 24 * 30);
    expect(session.verifySessionToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it("locks out after repeated wrong PINs and clears on success", () => {
    const key = "ip:test";
    for (let i = 0; i < 8; i++) session.recordFailedAttempt(key);
    expect(session.getLockoutSeconds(key)).toBeGreaterThan(0);
    session.clearAttempts(key);
    expect(session.getLockoutSeconds(key)).toBe(0);
  });
});
