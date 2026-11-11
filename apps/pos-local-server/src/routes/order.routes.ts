/**
 * Gusto POS Local Server — Order Routes
 *
 * Full order lifecycle: create, add items, modify, discount, hold, cancel.
 */

import { Router } from "express";
import {
  createOrder,
  getOrderById,
  listOrders,
  addItemsToOrder,
  updateItemQuantity,
  removeItem,
  applyDiscount,
  attachCustomer,
  holdOrder,
  cancelOrder,
  voidItem,
  mergeOrders,
  moveItemsToOrder,
  reorderFromPast,
  changeOrderMode,
  reassignWaiter,
  applyItemDiscount,
  markAsComplimentary,
  splitOrderItemQuantity,
  acceptOnlineOrder,
  rejectOnlineOrder,
  type CreateOrderInput,
  type AddItemInput,
} from "../services/order.service.js";
import { generateKOT } from "../services/kot.service.js";
import { atomic } from "../db/tx.js";
import { undoLastAction, canUndo } from "../services/undo.service.js";
import { getDayHistory } from "../services/history.service.js";
import {
  correctPaymentMode,
  voidSettledOrder,
  type PaymentCorrectionInput,
  type SettledVoidInput,
} from "../services/settlement.service.js";
import { requireRole, CASHIER_ROLES, MANAGER_ROLES } from "../middleware/auth.js";

/** Post-settlement edits are cashier/manager operations — never waiters/captains. */
function canEditSettledBill(role?: string): boolean {
  return !!role && (CASHIER_ROLES as readonly string[]).includes(role);
}

const router = Router();

/**
 * POST /api/orders
 * Create a new order.
 */
router.post("/", (req, res) => {
  try {
    const input = req.body as CreateOrderInput;
    const order = createOrder(input, req.currentUser?.id);
    res.status(201).json({ success: true, data: order, message: "Order created" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create order";
    res.status(400).json({ success: false, message });
  }
});

/**
 * GET /api/orders
 * List orders with optional filters.
 */
router.get("/", (req, res) => {
  const { status, tableId, waiterId, orderMode, customerPhone, isComplimentary, limit, active } = req.query;
  const orders = listOrders({
    status: status as string | undefined,
    tableId: tableId as string | undefined,
    waiterId: waiterId as string | undefined,
    orderMode: orderMode as string | undefined,
    customerPhone: customerPhone as string | undefined,
    isComplimentary: isComplimentary !== undefined ? isComplimentary === "true" : undefined,
    limit: limit ? Math.min(Math.max(Number(limit) || 0, 0), 1000) || undefined : undefined,
    activeOnly: active === "true",
  });
  res.json({ success: true, data: orders });
});

/**
 * GET /api/orders/history?date=YYYY-MM-DD
 * Full history of one business day (defaults to today): orders with items,
 * KOTs, invoices and event trail, plus a sales summary and activity feed.
 * Must be registered before GET /:id.
 */
router.get("/history", (req, res) => {
  try {
    const data = getDayHistory(req.query.date as string | undefined);
    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load day history";
    res.status(500).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/correct-payment
 * Fix the tender on a settled bill (e.g. CASH → UPI). Amounts are unchanged.
 * Body: { paymentMode, paymentSubMethod?, paymentSplits?, reason, approvedBy }
 */
router.post("/:id/correct-payment", (req, res) => {
  if (!canEditSettledBill(req.currentUser?.role)) {
    res.status(403).json({ success: false, message: "Insufficient permissions to correct settled bills" });
    return;
  }
  try {
    const data = correctPaymentMode(req.params.id!, req.body as PaymentCorrectionInput, req.currentUser?.id);
    res.json({ success: true, data, message: `Payment mode for ${data.orderNumber} corrected to ${data.paymentMode}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to correct payment mode";
    res.status(message === "Order not found" ? 404 : 400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/void-settled
 * Reverse a settled bill (post-settlement void). Body: { reason, approvedBy }
 */
router.post("/:id/void-settled", (req, res) => {
  if (!canEditSettledBill(req.currentUser?.role)) {
    res.status(403).json({ success: false, message: "Insufficient permissions to void settled bills" });
    return;
  }
  try {
    const data = voidSettledOrder(req.params.id!, req.body as SettledVoidInput, req.currentUser?.id);
    res.json({ success: true, data, message: `Bill ${data.invoiceNumber} voided` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to void settled bill";
    res.status(message === "Order not found" ? 404 : 400).json({ success: false, message });
  }
});

/**
 * GET /api/orders/:id
 * Get a single order with items and KOTs.
 */
router.get("/:id", (req, res) => {
  const order = getOrderById(req.params.id!);
  if (!order) {
    res.status(404).json({ success: false, message: "Order not found" });
    return;
  }
  res.json({ success: true, data: order });
});

/**
 * POST /api/orders/:id/items
 * Add items to an existing order.
 */
router.post("/:id/items", (req, res) => {
  try {
    const items = req.body.items as AddItemInput[];
    const order = addItemsToOrder(req.params.id!, items, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Items added" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add items";
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/orders/:id/items/:itemId
 * Update an item's quantity.
 */
router.patch("/:id/items/:itemId", (req, res) => {
  try {
    const { quantity } = req.body as { quantity: number };
    const order = updateItemQuantity(
      req.params.id!,
      req.params.itemId!,
      quantity,
      req.currentUser?.id
    );
    res.json({ success: true, data: order, message: "Item updated" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update item";
    res.status(400).json({ success: false, message });
  }
});

/**
 * DELETE /api/orders/:id/items/:itemId
 * Remove an item from an order.
 */
router.delete("/:id/items/:itemId", (req, res) => {
  try {
    const order = removeItem(req.params.id!, req.params.itemId!, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Item removed" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove item";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/items/:itemId/split
 * Split an item's quantity into two separate items.
 */
router.post("/:id/items/:itemId/split", (req, res) => {
  try {
    const { splitQuantity } = req.body as { splitQuantity: number };
    if (!splitQuantity || splitQuantity <= 0) {
      res.status(400).json({ success: false, message: "splitQuantity must be a positive number" });
      return;
    }
    const order = splitOrderItemQuantity(req.params.id!, req.params.itemId!, splitQuantity, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Item quantity split" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to split item quantity";
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/orders/:id/discount
 * Apply or remove discount.
 */
router.patch("/:id/discount", requireRole(...CASHIER_ROLES), (req, res) => {
  try {
    const discount = (req.body.discount ?? null) as { type: "PERCENTAGE" | "FLAT"; value: number; label?: string } | null;
    const order = applyDiscount(String(req.params.id), discount, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Discount updated" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to apply discount";
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/orders/:id/customer
 * Attach customer to order.
 */
router.patch("/:id/customer", (req, res) => {
  try {
    const customer = req.body as { id?: string; name: string; phone: string };
    const order = attachCustomer(req.params.id!, customer, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Customer attached" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to attach customer";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/hold
 * Put order on hold.
 */
router.post("/:id/hold", (req, res) => {
  try {
    const order = holdOrder(req.params.id!, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Order held" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to hold order";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/cancel
 * Cancel order (within 48-hour edit window).
 */
router.post("/:id/cancel", (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const order = cancelOrder(req.params.id!, req.currentUser?.id, { reason });
    res.json({ success: true, data: order, message: "Order cancelled" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel order";
    res.status(400).json({ success: false, message });
  }
});

// ─── Edge Case Routes ───

/**
 * POST /api/orders/:id/items/:itemId/void
 * Void / NCR an item (after KOT, requires reason + manager approval).
 */
router.post("/:id/items/:itemId/void", (req, res) => {
  try {
    const { reason, approvedBy, voidQuantity } = req.body as {
      reason: string;
      approvedBy: string;
      voidQuantity?: number;
    };
    if (!reason || !approvedBy) {
      res.status(400).json({ success: false, message: "reason and approvedBy are required" });
      return;
    }
    const order = voidItem(
      req.params.id!,
      req.params.itemId!,
      reason,
      approvedBy,
      req.currentUser?.id,
      voidQuantity
    );
    res.json({ success: true, data: order, message: "Item voided (NCR)" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to void item";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/move-items
 * Move selected items to another order (or create new one).
 */
router.post("/:id/move-items", (req, res) => {
  try {
    const { itemIds, targetOrderId, targetTableId } = req.body as {
      itemIds: string[];
      targetOrderId?: string;
      targetTableId?: string;
    };
    if (!itemIds || itemIds.length === 0) {
      res.status(400).json({ success: false, message: "itemIds array is required" });
      return;
    }
    const result = moveItemsToOrder(
      req.params.id!,
      itemIds,
      targetOrderId,
      targetTableId,
      req.currentUser?.id
    );
    res.json({ success: true, data: result, message: `${itemIds.length} item(s) moved` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to move items";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/reorder
 * Repeat a past order — create new order with same items.
 */
router.post("/:id/reorder", (req, res) => {
  try {
    const { tableId, orderMode } = req.body as {
      tableId?: string;
      orderMode?: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
    };
    const order = reorderFromPast(req.params.id!, tableId, orderMode, req.currentUser?.id);
    res.status(201).json({ success: true, data: order, message: "Order repeated" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reorder";
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/orders/:id/mode
 * Change order mode mid-order (e.g., DINE_IN → TAKEAWAY).
 */
router.patch("/:id/mode", (req, res) => {
  try {
    const { mode, tableId } = req.body as {
      mode: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
      tableId?: string;
    };
    if (!mode) {
      res.status(400).json({ success: false, message: "mode is required" });
      return;
    }
    const order = changeOrderMode(req.params.id!, mode, tableId, req.currentUser?.id);
    res.json({ success: true, data: order, message: `Mode changed to ${mode}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to change order mode";
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/orders/:id/waiter
 * Reassign waiter for an active order.
 */
router.patch("/:id/waiter", (req, res) => {
  try {
    const { waiterId, waiterName } = req.body as { waiterId: string; waiterName: string };
    if (!waiterId || !waiterName) {
      res.status(400).json({ success: false, message: "waiterId and waiterName are required" });
      return;
    }
    const order = reassignWaiter(req.params.id!, waiterId, waiterName, req.currentUser?.id);
    res.json({ success: true, data: order, message: `Waiter reassigned to ${waiterName}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reassign waiter";
    res.status(400).json({ success: false, message });
  }
});

/**
 * PATCH /api/orders/:id/items/:itemId/discount
 * Apply or remove item-level discount.
 */
router.patch("/:id/items/:itemId/discount", requireRole(...CASHIER_ROLES), (req, res) => {
  try {
    const { discount } = req.body as {
      discount: { type: "PERCENTAGE" | "FLAT"; value: number; reason?: string } | null;
    };
    const order = applyItemDiscount(
      String(req.params.id),
      String(req.params.itemId),
      discount ?? null,
      req.currentUser?.id
    );
    res.json({ success: true, data: order, message: "Item discount updated" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to apply item discount";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/complimentary
 * Mark order as complimentary (NC — No Charge).
 */
router.post("/:id/complimentary", requireRole(...MANAGER_ROLES), (req, res) => {
  try {
    const { reason, approvedBy } = req.body as { reason: string; approvedBy: string };
    if (!reason || !approvedBy) {
      res.status(400).json({ success: false, message: "reason and approvedBy are required" });
      return;
    }
    const order = markAsComplimentary(String(req.params.id), reason, approvedBy, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Order marked as complimentary" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to mark as complimentary";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/undo
 * Undo the last action on an order (30-second window).
 */
router.post("/:id/undo", (req, res) => {
  try {
    const result = undoLastAction(req.params.id!, req.currentUser?.id);
    if (!result) {
      res.status(400).json({ success: false, message: "No undo available (expired or empty)" });
      return;
    }
    res.json({ success: true, data: result, message: `Undone: ${result.undoneAction}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to undo";
    res.status(400).json({ success: false, message });
  }
});

/**
 * GET /api/orders/:id/undo-status
 * Check if undo is available for an order.
 */
router.get("/:id/undo-status", (req, res) => {
  const status = canUndo(req.params.id!);
  res.json({ success: true, data: status });
});

/**
 * POST /api/orders/:id/accept-online
 * Accept an online order and fire KOT
 */
router.post("/:id/accept-online", (req, res) => {
  try {
    // Accepting and firing must succeed or fail together
    const { order, kot } = atomic(() => {
      const accepted = acceptOnlineOrder(req.params.id!, req.currentUser?.id);
      const fired = generateKOT(accepted!.id, undefined, undefined, req.currentUser?.id);
      return { order: getOrderById(accepted!.id), kot: { kotId: fired.kotId, kotNumber: fired.kotNumber } };
    });
    res.json({ success: true, data: { order, kot }, message: "Online order accepted & KOT fired" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to accept online order";
    res.status(400).json({ success: false, message });
  }
});

/**
 * POST /api/orders/:id/reject-online
 * Reject an online order
 */
router.post("/:id/reject-online", (req, res) => {
  try {
    const { reason } = req.body as { reason: string };
    const order = rejectOnlineOrder(req.params.id!, reason || "Rejected by outlet", req.currentUser?.id);
    res.json({ success: true, data: order, message: "Online order rejected" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reject online order";
    res.status(400).json({ success: false, message });
  }
});

export { router as orderRoutes };

