/**
 * Gusto POS Local Server — Print Routes
 *
 * Provides endpoints for printing KOTs and Bills (Receipts).
 * Supports returning raw ESC/POS byte sequences for real hardware,
 * or JSON/Preview output for development and UI display.
 */

import { Router } from "express";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "@gusto/db-schema/local";
import { db } from "../db/index.js";
import { buildBillReceipt, renderToConsole, renderToEscPos } from "@gusto/printer";
import {
  buildReceiptFromOrder,
  calculateCartTotals,
  type DiscountConfig,
  type GSTRate,
  type InvoiceRecord,
} from "@gusto/core-logic";
import { printBillTemplate, queuePrint, getPrintQueueStatus, triggerCashDrawer, type PrintSource } from "../services/print.service.js";
import { emitTableStatusChanged } from "../socket/events.js";

const router = Router();
const OUTLET_ID = process.env.OUTLET_ID || "local-outlet";

function parsePrintSource(value: unknown): PrintSource {
  return value === "captain" ? "captain" : "pos";
}

function canPrintBill(role?: string): boolean {
  if (!role) return true;
  return ["SUPER_ADMIN", "ADMIN", "POS_ADMIN", "OWNER", "MANAGER", "CASHIER", "WAITER"].includes(role);
}

function getOutletConfig() {
  const outlet = db.select().from(schema.outletConfig).where(eq(schema.outletConfig.outletId, OUTLET_ID)).get();
  if (outlet) {
    if (!outlet.logoImagePath) {
      outlet.logoImagePath = path.resolve(process.cwd(), "assets/logo.png");
    }
    return outlet;
  }

  return {
    id: "fallback",
    outletId: OUTLET_ID,
    outletName: "Gusto's Pizzeria",
    address: "",
    phone: null,
    gstNumber: null,
    fssaiLicenseNo: null,
    greetingMessage: "Thank you, visit again!",
    logoImagePath: path.resolve(process.cwd(), "assets/logo.png"),
    defaultGstRate: "5",
    currencySymbol: "₹",
    updatedAt: new Date().toISOString(),
  };
}

function getTableInfo(tableId?: string | null): { name: string } | undefined {
  if (!tableId) return undefined;
  const table = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, tableId)).get();
  return table ? { name: table.name } : undefined;
}

function buildOrderBill(orderId: string, duplicate = false) {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) {
    return { error: "Order not found" as const };
  }

  const invoice = db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId)).get() ?? null;
  const items = db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all();
  if (items.length === 0) {
    return { error: "Cannot print an empty order" as const };
  }

  let receiptInvoice: InvoiceRecord | null = invoice;
  if (!receiptInvoice) {
    const discount: DiscountConfig | undefined = order.discountType && order.discountValue
      ? {
          type: order.discountType as "PERCENTAGE" | "FLAT",
          value: order.discountValue,
          label: order.discountLabel ?? undefined,
        }
      : undefined;
    const totals = calculateCartTotals(
      items.map((item) => ({
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        variantName: item.variantName ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate as GSTRate,
        modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
        notes: item.notes ?? undefined,
        addOns: item.addOns ? JSON.parse(item.addOns) : undefined,
      })),
      discount
    );

    receiptInvoice = {
      invoiceNumber: `BILL-${order.orderNumber}`,
      receiptStatus: "ORIGINAL",
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstRate: 2.5,
      cgstAmount: totals.totalCgst,
      sgstRate: 2.5,
      sgstAmount: totals.totalSgst,
      totalQuantity: totals.totalQuantity,
      totalAmount: totals.grandTotal,
      paymentMode: "UNPAID",
      paymentSubMethod: null,
      paymentSplits: null,
    };
  }

  const receiptData = buildReceiptFromOrder({
    order,
    items,
    invoice: receiptInvoice,
    outlet: getOutletConfig(),
    table: getTableInfo(order.tableId),
    receiptStatusOverride: duplicate ? "DUPLICATE" : undefined,
  });

  if (!invoice) {
    receiptData.statusLabel = "BILL";
    receiptData.paymentLines = [];
  }

  return {
    order,
    invoice: receiptInvoice,
    printTemplate: buildBillReceipt(receiptData),
    isReprint: Boolean(invoice && duplicate),
    isPaid: Boolean(invoice),
  };
}

/**
 * POST /api/print/bill/:orderId
 * Print a bill for POS or captain app.
 * Body: { source?: "pos" | "captain" }
 * Query ?format=escpos (binary) | preview | json (default)
 */
router.post("/bill/:orderId", async (req, res) => {
  if (!canPrintBill(req.currentUser?.role)) {
    res.status(403).json({ success: false, message: "Insufficient permissions to print bills" });
    return;
  }

  const { orderId } = req.params;
  const format = (req.query.format as string) || "json";
  const bill = buildOrderBill(orderId!);

  if ("error" in bill) {
    res.status(bill.error === "Order not found" ? 404 : 400).json({ success: false, message: bill.error });
    return;
  }

  if (format === "escpos") {
    const buffer = renderToEscPos(bill.printTemplate);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(Buffer.from(buffer));
    return;
  }

  if (format === "preview") {
    console.log(`\nBILL PRINT — ${bill.invoice.invoiceNumber} (Order: ${bill.order.orderNumber})`);
    console.log(renderToConsole(bill.printTemplate));
    console.log("");
    res.json({ success: true, message: "Printed to console preview" });
    return;
  }

  try {
    const source = parsePrintSource(req.body?.source);
    // Queue the print job for offline resilience
    await queuePrint(bill.printTemplate, "BILL", source);
    
    // If dine-in order and unpaid, mark table as BILLED
    if (!bill.isPaid && bill.order.tableId) {
      db.update(schema.diningTables)
        .set({ status: "BILLED" })
        .where(eq(schema.diningTables.id, bill.order.tableId))
        .run();
      emitTableStatusChanged({
        tableId: bill.order.tableId,
        status: "BILLED",
        orderId: bill.order.id,
        orderNumber: bill.order.orderNumber,
      });
    }

    res.json({
      success: true,
      data: { isPaid: bill.isPaid },
      message: `Bill queued for printing for ${bill.order.orderNumber}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to queue bill print";
    res.status(502).json({ success: false, message });
  }
});

/**
 * POST /api/print/reprint/:orderId
 * Reprint receipt for a completed order.
 * Query ?format=escpos (binary) | preview (console) | json (default)
 */
router.post("/reprint/:orderId", async (req, res) => {
  if (!canPrintBill(req.currentUser?.role)) {
    res.status(403).json({ success: false, message: "Insufficient permissions to print bills" });
    return;
  }

  const { orderId } = req.params;
  const format = (req.query.format as string) || "json";
  const bill = buildOrderBill(orderId!, true);

  if ("error" in bill) {
    res.status(bill.error === "Order not found" ? 404 : 400).json({ success: false, message: bill.error });
    return;
  }

  if (!bill.isPaid) {
    res.status(404).json({ success: false, message: "Invoice not found — order may not be completed" });
    return;
  }

  if (format === "escpos") {
    const buffer = renderToEscPos(bill.printTemplate);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(Buffer.from(buffer));
    return;
  }

  if (format === "preview") {
    console.log(`\nREPRINT — ${bill.invoice.invoiceNumber} (Order: ${bill.order.orderNumber})`);
    console.log(renderToConsole(bill.printTemplate));
    console.log("");
    res.json({ success: true, message: "Printed to console preview" });
    return;
  }

  try {
    const source = parsePrintSource(req.body?.source);
    // Queue the reprint job
    await queuePrint(bill.printTemplate, "BILL", source);
    
    res.json({
      success: true,
      data: { printTemplate: bill.printTemplate },
      message: `Receipt queued for reprinting for ${bill.order.orderNumber}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to queue receipt reprint";
    res.status(502).json({ success: false, message });
  }
});

/**
 * GET /api/print/queue-status
 * Get the current offline print queue statistics.
 */
router.get("/queue-status", async (req, res) => {
  if (!canPrintBill(req.currentUser?.role)) {
    res.status(403).json({ success: false, message: "Insufficient permissions" });
    return;
  }

  try {
    const status = getPrintQueueStatus();
    res.json({ success: true, data: status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get print queue status";
    res.status(500).json({ success: false, message });
  }
});

/**
 * POST /api/print/open-drawer
 * Triggers the hardware cash drawer via ESC/POS command.
 */
router.post("/open-drawer", async (req, res) => {
  if (!canPrintBill(req.currentUser?.role)) {
    res.status(403).json({ success: false, message: "Insufficient permissions" });
    return;
  }

  try {
    const source = parsePrintSource(req.body?.source);
    await triggerCashDrawer(source);
    res.json({ success: true, message: "Cash drawer opened" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to open cash drawer";
    res.status(500).json({ success: false, message });
  }
});

// ─── Edge Case Print Routes ───

/**
 * POST /api/print/pre-check/:orderId
 * Generate a running bill / pre-check receipt.
 * NOT an invoice — no invoice number, no GST finalization.
 * Marked clearly as "PRE-CHECK — NOT A TAX INVOICE".
 */
router.post("/pre-check/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId!;

    const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get();
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    const items = db.select().from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .all()
      .filter(i => i.status !== "VOIDED");

    if (items.length === 0) {
      res.status(400).json({ success: false, message: "No items in order" });
      return;
    }

    const cartItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      variantName: item.variantName ?? undefined,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      gstRate: item.gstRate as GSTRate,
      modifiers: item.modifiers ? JSON.parse(item.modifiers) : undefined,
      notes: item.notes ?? undefined,
    }));

    let discount: DiscountConfig | undefined;
    if (order.discountType && order.discountValue) {
      discount = {
        type: order.discountType as "PERCENTAGE" | "FLAT",
        value: order.discountValue,
      };
    }

    const totals = calculateCartTotals(cartItems, discount);
    const outlet = getOutletConfig();

    let tableName: string | undefined;
    if (order.tableId) {
      const t = db.select().from(schema.diningTables).where(eq(schema.diningTables.id, order.tableId)).get();
      tableName = t?.name;
    }

    // Build a receipt-like template marked as PRE-CHECK
    const preCheckInvoice: InvoiceRecord = {
      invoiceNumber: "--- PRE-CHECK ---",
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgstAmount: totals.totalCgst,
      sgstAmount: totals.totalSgst,
      totalQuantity: totals.totalQuantity,
      totalAmount: totals.grandTotal,
      paymentMode: "PENDING",
      paymentSubMethod: null,
      paymentSplits: null,
      tipAmount: 0,
      tenderedAmount: null,
      changeDue: null,
    };

    const receiptData = buildReceiptFromOrder({
      order,
      items,
      invoice: preCheckInvoice,
      outlet,
      table: tableName ? { name: tableName } : undefined,
    });

    const printTemplate = buildBillReceipt(receiptData);

    // Log to console
    console.log(`\n📋 PRE-CHECK — Order: ${order.orderNumber} (NOT A TAX INVOICE)`);
    console.log(renderToConsole(printTemplate));
    console.log("");

    // Optionally print
    const source = parsePrintSource(req.body?.source);
    try {
      await queuePrint(printTemplate, "BILL", source);
    } catch (e) {
      console.error("Pre-check print failed", e);
    }

    res.json({
      success: true,
      data: {
        orderId,
        orderNumber: order.orderNumber,
        totals,
        tableName,
        printTemplate,
        note: "PRE-CHECK — NOT A TAX INVOICE",
      },
      message: "Pre-check receipt generated",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate pre-check";
    res.status(500).json({ success: false, message });
  }
});

export { router as printRoutes };

