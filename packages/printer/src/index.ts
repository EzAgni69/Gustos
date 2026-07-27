/**
 * @gusto/printer — ESC/POS Thermal Printer Utilities
 *
 * Generates ESC/POS command buffers for thermal printers.
 * Used by pos-local-server for printing KOTs, bills, and receipts.
 *
 * NOTE: Actual printer communication (USB/LAN) is handled in pos-local-server
 * using node-thermal-printer. This package only builds the content/templates.
 */

// ─── Receipt Template Types ───

export interface ReceiptLine {
  type: "text" | "divider" | "blank" | "qr";
  content?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: "normal" | "double";
  columns?: { text: string; width: number; align?: "left" | "right" }[];
}

export interface ReceiptData {
  outletName: string;
  outletAddress: string;
  outletPhone?: string;
  gstNumber?: string;
  invoiceNumber: string;
  orderNumber: string;
  tableName?: string;
  waiterName?: string;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    modifiers?: string[];
  }[];
  subtotal: number;
  discountAmount: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  paymentMode: string;
  customerName?: string;
  customerPhone?: string;
  createdAt: Date;
}

export interface KOTData {
  kotNumber: string;
  orderNumber: string;
  tableName?: string;
  waiterName?: string;
  station?: string;
  items: {
    name: string;
    quantity: number;
    modifiers?: string[];
    notes?: string;
  }[];
  createdAt: Date;
}

// ─── Template Builders ───

/**
 * Build a bill receipt template as an array of ReceiptLines.
 * The pos-local-server will consume this and send it to the printer.
 */
export function buildBillReceipt(data: ReceiptData): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  // Header
  lines.push({ type: "text", content: data.outletName, align: "center", bold: true, size: "double" });
  lines.push({ type: "text", content: data.outletAddress, align: "center" });
  if (data.outletPhone) {
    lines.push({ type: "text", content: `Tel: ${data.outletPhone}`, align: "center" });
  }
  if (data.gstNumber) {
    lines.push({ type: "text", content: `GSTIN: ${data.gstNumber}`, align: "center" });
  }
  lines.push({ type: "divider" });

  // Order info
  lines.push({ type: "text", content: `Invoice: ${data.invoiceNumber}`, align: "left" });
  lines.push({ type: "text", content: `Order: ${data.orderNumber}`, align: "left" });
  if (data.tableName) {
    lines.push({ type: "text", content: `Table: ${data.tableName}`, align: "left" });
  }
  lines.push({ type: "text", content: `Date: ${formatDate(data.createdAt)}`, align: "left" });
  if (data.waiterName) {
    lines.push({ type: "text", content: `Waiter: ${data.waiterName}`, align: "left" });
  }
  lines.push({ type: "divider" });

  // Items header
  lines.push({
    type: "text",
    columns: [
      { text: "Item", width: 20, align: "left" },
      { text: "Qty", width: 4, align: "right" },
      { text: "Rate", width: 8, align: "right" },
      { text: "Amt", width: 8, align: "right" },
    ],
    bold: true,
  });
  lines.push({ type: "divider" });

  // Items
  for (const item of data.items) {
    lines.push({
      type: "text",
      columns: [
        { text: item.name, width: 20, align: "left" },
        { text: item.quantity.toString(), width: 4, align: "right" },
        { text: item.unitPrice.toFixed(2), width: 8, align: "right" },
        { text: item.total.toFixed(2), width: 8, align: "right" },
      ],
    });
    if (item.modifiers && item.modifiers.length > 0) {
      lines.push({ type: "text", content: `  → ${item.modifiers.join(", ")}`, align: "left" });
    }
  }

  lines.push({ type: "divider" });

  // Totals
  lines.push({
    type: "text",
    columns: [
      { text: "Subtotal:", width: 24, align: "right" },
      { text: data.subtotal.toFixed(2), width: 16, align: "right" },
    ],
  });

  if (data.discountAmount > 0) {
    lines.push({
      type: "text",
      columns: [
        { text: "Discount:", width: 24, align: "right" },
        { text: `-${data.discountAmount.toFixed(2)}`, width: 16, align: "right" },
      ],
    });
  }

  lines.push({
    type: "text",
    columns: [
      { text: "CGST:", width: 24, align: "right" },
      { text: data.cgst.toFixed(2), width: 16, align: "right" },
    ],
  });

  lines.push({
    type: "text",
    columns: [
      { text: "SGST:", width: 24, align: "right" },
      { text: data.sgst.toFixed(2), width: 16, align: "right" },
    ],
  });

  lines.push({ type: "divider" });
  lines.push({
    type: "text",
    columns: [
      { text: "TOTAL:", width: 24, align: "right" },
      { text: data.grandTotal.toFixed(2), width: 16, align: "right" },
    ],
    bold: true,
    size: "double",
  });
  lines.push({ type: "divider" });

  // Payment
  lines.push({ type: "text", content: `Payment: ${data.paymentMode}`, align: "center" });
  lines.push({ type: "blank" });
  lines.push({ type: "text", content: "Thank you! Visit again.", align: "center" });
  lines.push({ type: "blank" });

  return lines;
}

/**
 * Build a KOT (Kitchen Order Ticket) template.
 */
export function buildKOTReceipt(data: KOTData): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  lines.push({ type: "text", content: "*** KOT ***", align: "center", bold: true, size: "double" });
  lines.push({ type: "divider" });
  lines.push({ type: "text", content: `KOT: ${data.kotNumber}`, align: "left", bold: true });
  lines.push({ type: "text", content: `Order: ${data.orderNumber}`, align: "left" });
  if (data.tableName) {
    lines.push({ type: "text", content: `Table: ${data.tableName}`, align: "left" });
  }
  if (data.station) {
    lines.push({ type: "text", content: `Station: ${data.station}`, align: "left", bold: true });
  }
  lines.push({ type: "text", content: `Time: ${formatTime(data.createdAt)}`, align: "left" });
  if (data.waiterName) {
    lines.push({ type: "text", content: `Waiter: ${data.waiterName}`, align: "left" });
  }
  lines.push({ type: "divider" });

  for (const item of data.items) {
    lines.push({
      type: "text",
      content: `${item.quantity}x ${item.name}`,
      bold: true,
      size: "double",
    });
    if (item.modifiers && item.modifiers.length > 0) {
      lines.push({ type: "text", content: `   → ${item.modifiers.join(", ")}` });
    }
    if (item.notes) {
      lines.push({ type: "text", content: `   Note: ${item.notes}` });
    }
  }

  lines.push({ type: "divider" });
  lines.push({ type: "blank" });

  return lines;
}

// ─── Helpers ───

function formatDate(date: Date): string {
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
