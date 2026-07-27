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
  type CreateOrderInput,
  type AddItemInput,
} from "../services/order.service.js";

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
  const { status, tableId, waiterId, limit } = req.query;
  const orders = listOrders({
    status: status as string | undefined,
    tableId: tableId as string | undefined,
    waiterId: waiterId as string | undefined,
    limit: limit ? Number(limit) : undefined,
  });
  res.json({ success: true, data: orders });
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
 * PATCH /api/orders/:id/discount
 * Apply or remove discount.
 */
router.patch("/:id/discount", (req, res) => {
  try {
    const discount = req.body.discount as { type: "PERCENTAGE" | "FLAT"; value: number } | null;
    const order = applyDiscount(req.params.id!, discount, req.currentUser?.id);
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
    const order = cancelOrder(req.params.id!, req.currentUser?.id);
    res.json({ success: true, data: order, message: "Order cancelled" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel order";
    res.status(400).json({ success: false, message });
  }
});

export { router as orderRoutes };
