/**
 * Gusto POS Local Server — Checkout Routes
 *
 * Payment processing and invoice generation.
 */

import { Router } from "express";
import { processCheckout, getInvoice, type CheckoutInput } from "../services/checkout.service.js";

const router = Router();

/**
 * POST /api/orders/:id/checkout
 * Process payment and complete order.
 */
router.post("/orders/:id/checkout", (req, res) => {
  try {
    const input = req.body as CheckoutInput;
    const result = processCheckout(req.params.id!, input, req.currentUser?.id);
    res.json({
      success: true,
      data: {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
        totalAmount: result.totals.grandTotal,
        tipAmount: result.tipAmount,
        paymentMode: result.paymentMode,
      },
      message: `Payment received — ${result.invoiceNumber}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    res.status(400).json({ success: false, message });
  }
});

/**
 * GET /api/orders/:id/invoice
 * Get invoice data for an order.
 */
router.get("/orders/:id/invoice", (req, res) => {
  const invoice = getInvoice(req.params.id!);
  if (!invoice) {
    res.status(404).json({ success: false, message: "Invoice not found" });
    return;
  }
  res.json({ success: true, data: invoice });
});

export { router as checkoutRoutes };
