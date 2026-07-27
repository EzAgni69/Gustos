/**
 * Gusto POS Local Server — Print Routes
 *
 * Simulated printing — logs formatted receipt/KOT output to console.
 * Real hardware integration (USB/LAN thermal printer) is Phase 3+.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { buildBillReceipt, buildKOTReceipt, type ReceiptData, type KOTData } from "@gusto/printer";
import { calculateCartTotals, type CartItem, type DiscountConfig, type GSTRate } from "@gusto/core-logic";

const router = Router();

/**
 * POST /api/print/reprint/:orderId
 * Reprint receipt for a completed order.
 */
router.post("/reprint/:orderId", (req, res) => {
  const { orderId } = req.params;

  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId!))
    .get();

  if (!order) {
    res.status(404).json({ success: false, message: "Order not found" });
    return;
  }

  const invoice = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.orderId, orderId!))
    .get();

  if (!invoice) {
    res.status(404).json({ success: false, message: "Invoice not found — order may not be completed" });
    return;
  }

  const items = db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId!))
    .all();

  let tableName: string | undefined;
  if (order.tableId) {
    const table = db
      .select()
      .from(schema.diningTables)
      .where(eq(schema.diningTables.id, order.tableId))
      .get();
    tableName = table?.name;
  }

  const receiptData: ReceiptData = {
    outletName: "Gusto Restaurant",
    outletAddress: "Shop 12, Versova Road, Andheri West, Mumbai 400058",
    outletPhone: "+91 22 2634 5678",
    gstNumber: "27AADCG1234A1Z5",
    invoiceNumber: invoice.invoiceNumber,
    orderNumber: order.orderNumber,
    tableName,
    waiterName: order.waiterName ?? undefined,
    items: items.map((i) => ({
      name: i.menuItemName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.unitPrice * i.quantity,
      modifiers: i.modifiers ? JSON.parse(i.modifiers) : undefined,
    })),
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    cgst: invoice.cgstAmount,
    sgst: invoice.sgstAmount,
    grandTotal: invoice.totalAmount,
    paymentMode: invoice.paymentMode,
    customerName: order.customerName ?? undefined,
    customerPhone: order.customerPhone ?? undefined,
    createdAt: new Date(order.createdAt),
  };

  const printTemplate = buildBillReceipt(receiptData);

  // Log receipt to console (simulated reprint)
  console.log(`\n🔄 REPRINT — ${invoice.invoiceNumber} (Order: ${order.orderNumber})`);
  for (const line of printTemplate) {
    if (line.type === "divider") console.log("─".repeat(40));
    else if (line.type === "blank") console.log("");
    else if (line.columns) {
      const cols = line.columns.map((c: any) => c.text.padEnd(c.width)).join("");
      console.log(cols);
    } else if (line.content) {
      console.log(line.content);
    }
  }
  console.log("");

  res.json({
    success: true,
    data: { printTemplate },
    message: `Receipt reprinted for ${order.orderNumber}`,
  });
});

export { router as printRoutes };
