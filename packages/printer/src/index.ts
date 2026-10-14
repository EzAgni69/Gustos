/**
 * @gusto/printer — ESC/POS Thermal Printer Utilities
 *
 * Generates ESC/POS command buffers for thermal printers.
 * Used by pos-local-server for printing KOTs, bills, and receipts.
 *
 * NOTE: Actual printer communication (USB/LAN) is handled in pos-local-server
 * using node-thermal-printer. This package only builds the content/templates.
 *
 * Receipt layout is structured into 5 zones matching the Gusto's 80mm
 * thermal paper format:
 *   Zone A: Header (Brand & Identification)
 *   Zone B: Order Metadata (Transaction Details)
 *   Zone C: Line Items (The Core Order)
 *   Zone D: Billing Summary (Calculations)
 *   Zone E: Footer (Payment & Compliance)
 */

export { renderToEscPos, escPosToBuffer, generateCashDrawerKick } from "./renderer.js";
export { renderToConsole } from "./console-renderer.js";

// ─── Receipt Template Types ───

export interface ReceiptLine {
  type: "text" | "divider" | "blank" | "qr" | "image";
  content?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: "normal" | "double";
  columns?: { text: string; width: number; align?: "left" | "right" }[];
  /** For image type: path to image file on local filesystem */
  imagePath?: string;
}

// ─── Receipt Item with Variant, Add-On & Notes Support ───

export interface ReceiptAddOn {
  /** Add-on name, e.g., "Habanero Sauce" */
  name: string;
  /** Quantity of this add-on */
  quantity: number;
  /** Unit price (0 for free add-ons) */
  unitPrice: number;
  /** Total amount (qty × unitPrice) */
  amount: number;
}

export interface ReceiptItem {
  /** Dish name, e.g., "Pesto Cheese Garlic Tasca" */
  name: string;
  /** Variant description, e.g., "(Large [12 Inch] Serves 2)" */
  variantName?: string;
  /** Order quantity */
  quantity: number;
  /** Price per unit */
  unitPrice: number;
  /** Line total (qty × unitPrice) */
  amount: number;
  /** Modifiers, e.g., ["Extra Cheese", "Less Spicy"] */
  modifiers?: string[];
  /** Special notes, e.g., "Soda" — printed as [Note] Soda */
  notes?: string;
  /** Add-ons (free or paid), printed below item */
  addOns?: ReceiptAddOn[];
}

// ─── Payment Split Line (for receipt display) ───

export interface PaymentSplitLine {
  /** Display label, e.g., "Cash", "UPI [PhonePe]", "Card" */
  label: string;
  /** Amount paid via this method */
  amount: number;
}

// ─── Tax Line (Flexible per-tax-type display) ───

export interface TaxLine {
  /** Display label, e.g., "SGST 2.5%" */
  label: string;
  /** Tax rate percentage, e.g., 2.5 */
  rate: number;
  /** Calculated tax amount */
  amount: number;
}

// ─── 5-Zone Receipt Data Structure ───

export interface ReceiptData {
  // ─── Zone A: Header (Brand & Identification) ───
  /** Path to logo bitmap on local filesystem (optional, leave undefined to skip) */
  logoImagePath?: string;
  /** Receipt status badge: ORIGINAL, DUPLICATE, TRIPLICATE */
  receiptStatus: "ORIGINAL" | "DUPLICATE" | "TRIPLICATE";
  /** Optional top status label, e.g. "BILL" for unpaid bills */
  statusLabel?: string;
  /** Restaurant/outlet name */
  outletName: string;
  /** Full physical address */
  outletAddress: string;
  /** Contact phone (optional) */
  outletPhone?: string;

  // ─── Zone B: Order Metadata ───
  /** Customer name (optional) */
  customerName?: string;
  /** Order date & time */
  date: Date;
  /** Order type: Dine In, Takeaway, Delivery, Online */
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
  /** Table identifier, e.g., "T2" — only relevant for Dine In */
  tableIdentifier?: string;
  /** Cashier/staff who processed the bill */
  cashierName: string;
  /** Bill/invoice number, e.g., "4735" */
  billNumber: string;
  /** KOT token numbers for kitchen/pickup tracking, e.g., [21, 24] */
  tokenNumbers: number[];

  // ─── Zone C: Line Items ───
  /** All ordered items with variants, modifiers, notes, and add-ons */
  items: ReceiptItem[];

  // ─── Zone D: Billing Summary ───
  /** Sum of all item quantities */
  totalQuantity: number;
  /** Amount before taxes and discounts */
  subtotal: number;
  /** Individual tax lines (SGST, CGST, etc.) */
  taxes: TaxLine[];
  /** Discount label, e.g., "10% Off", "Happy Hour" (optional) */
  discountLabel?: string;
  /** Discount amount (0 if no discount) */
  discountAmount: number;
  /** Final payable amount (before tip) */
  grandTotal: number;
  /** Optional tip/gratuity amount (shown separately for GST compliance) */
  tipAmount?: number;

  // ─── Zone E: Footer ───
  /**
   * Payment breakdown lines. For a single payment use one entry.
   * For split payments, provide one entry per payment leg.
   * e.g., [{ label: "UPI [PhonePe]", amount: 3000 }, { label: "Cash", amount: 4310 }]
   */
  paymentLines: PaymentSplitLine[];
  /** FSSAI food safety license number (optional) */
  fssaiLicenseNo?: string;
  /** GST identification number (optional) */
  gstNumber?: string;
  /** Greeting message, e.g., "Thank you, visit again!" (optional) */
  greetingMessage?: string;
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
    variantName?: string;
    modifiers?: string[];
    notes?: string;
  }[];
  createdAt: Date;
}

// ─── Constants ───

/** 80mm thermal paper ≈ 42 characters at standard font width */
const PAPER_WIDTH = 42;

// ─── Template Builders ───

/**
 * Build a bill receipt template as an array of ReceiptLines.
 * Follows the 5-zone layout matching the actual Gusto's receipt format.
 * The pos-local-server will consume this and send it to the printer.
 */
export function buildBillReceipt(data: ReceiptData): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  // ═══════════════════════════════════════════
  // Zone A: Header (Brand & Identification)
  // ═══════════════════════════════════════════

  // Logo (optional — leave blank if no image path provided)
  if (data.logoImagePath) {
    lines.push({ type: "image", imagePath: data.logoImagePath, align: "center" });
    lines.push({ type: "blank" });
  }

  // Receipt status (PAID / Duplicate / Original)
  if (data.statusLabel) {
    lines.push({
      type: "text",
      content: data.statusLabel,
      align: "center",
      bold: true,
    });
  } else if (data.receiptStatus !== "ORIGINAL") {
    lines.push({
      type: "text",
      content: data.receiptStatus === "DUPLICATE" ? "PAID" : "",
      align: "center",
      bold: true,
    });
    lines.push({
      type: "text",
      content: data.receiptStatus,
      align: "center",
      bold: true,
    });
  } else {
    lines.push({
      type: "text",
      content: "PAID",
      align: "center",
      bold: true,
    });
    lines.push({
      type: "text",
      content: "Original",
      align: "center",
    });
  }

  // Restaurant name (prominent, double-size)
  lines.push({
    type: "text",
    content: data.outletName,
    align: "center",
    bold: true,
    size: "double",
  });

  // Address & contact
  lines.push({ type: "text", content: data.outletAddress, align: "center" });
  if (data.outletPhone) {
    lines.push({ type: "text", content: `Tel: ${data.outletPhone}`, align: "center" });
  }

  lines.push({ type: "divider" });

  // ═══════════════════════════════════════════
  // Zone B: Order Metadata (Transaction Details)
  // ═══════════════════════════════════════════

  // Customer name (optional)
  if (data.customerName) {
    lines.push({ type: "text", content: `Name: ${data.customerName}`, align: "left" });
  }

  // Date & Time (DD/MM/YY HH:MM format)
  lines.push({
    type: "text",
    content: `Date: ${formatDateDDMMYY(data.date)}`,
    align: "left",
  });

  // Order type + table location
  const orderTypeLabel = formatOrderType(data.orderType);
  const locationStr = data.tableIdentifier
    ? `${orderTypeLabel}: ${data.tableIdentifier}`
    : orderTypeLabel;
  lines.push({
    type: "text",
    columns: [
      { text: locationStr, width: 24, align: "left" },
    ],
  });

  // Cashier name
  lines.push({
    type: "text",
    content: `Cashier: ${data.cashierName}`,
    align: "left",
  });

  // Bill number
  lines.push({
    type: "text",
    content: `Bill No.: ${data.billNumber}`,
    align: "left",
  });

  // Token numbers (can be multiple)
  if (data.tokenNumbers.length > 0) {
    lines.push({
      type: "text",
      content: `Token No.: ${data.tokenNumbers.join(", ")}`,
      align: "left",
      bold: true,
    });
  }

  lines.push({ type: "divider" });

  // ═══════════════════════════════════════════
  // Zone C: Line Items (The Core Order)
  // ═══════════════════════════════════════════

  // Table column headers: Item | Qty. | Price | Amount
  lines.push({
    type: "text",
    columns: [
      { text: "Item", width: 18, align: "left" },
      { text: "Qty.", width: 4, align: "right" },
      { text: "Price", width: 10, align: "right" },
      { text: "Amount", width: 10, align: "right" },
    ],
    bold: true,
  });
  lines.push({ type: "divider" });

  // Items
  for (const item of data.items) {
    // Main item row: Name | Qty | Price | Amount
    lines.push({
      type: "text",
      columns: [
        { text: truncate(item.name, 18), width: 18, align: "left" },
        { text: item.quantity.toString(), width: 4, align: "right" },
        { text: formatCurrency(item.unitPrice), width: 10, align: "right" },
        { text: formatCurrency(item.amount), width: 10, align: "right" },
      ],
    });

    // If item name is longer than 18 chars, print continuation on next line
    if (item.name.length > 18) {
      lines.push({
        type: "text",
        content: `  ${item.name.substring(18)}`,
        align: "left",
      });
    }

    // Variant (printed below item, indented)
    if (item.variantName) {
      lines.push({
        type: "text",
        content: `  ${item.variantName}`,
        align: "left",
      });
    }

    // Modifiers (printed below variant, indented)
    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        lines.push({
          type: "text",
          content: `  (${mod})`,
          align: "left",
        });
      }
    }

    // Notes (printed as [Note] ...)
    if (item.notes) {
      lines.push({
        type: "text",
        content: `  [Note] ${item.notes}`,
        align: "left",
      });
    }

    // Add-ons (free or paid, printed below item)
    if (item.addOns && item.addOns.length > 0) {
      for (const addOn of item.addOns) {
        if (addOn.unitPrice === 0) {
          // Free add-on: "Free Add On: Name - QtyxPrice = Amount"
          lines.push({
            type: "text",
            content: `  Free Add On: ${addOn.name} - ${addOn.quantity}x${formatCurrency(addOn.unitPrice)} = ${formatCurrency(addOn.amount)}`,
            align: "left",
          });
        } else {
          // Paid add-on
          lines.push({
            type: "text",
            columns: [
              { text: `  + ${addOn.name}`, width: 18, align: "left" },
              { text: addOn.quantity.toString(), width: 4, align: "right" },
              { text: formatCurrency(addOn.unitPrice), width: 10, align: "right" },
              { text: formatCurrency(addOn.amount), width: 10, align: "right" },
            ],
          });
        }
      }
    }
  }

  lines.push({ type: "divider" });

  // ═══════════════════════════════════════════
  // Zone D: Billing Summary (Calculations)
  // ═══════════════════════════════════════════

  // Total quantity
  lines.push({
    type: "text",
    columns: [
      { text: `Total Qty: ${data.totalQuantity}`, width: 24, align: "left" },
      { text: "Sub", width: 18, align: "right" },
    ],
  });

  // Sub total
  lines.push({
    type: "text",
    columns: [
      { text: "", width: 24, align: "left" },
      { text: `Total: ${formatCurrency(data.subtotal)}`, width: 18, align: "right" },
    ],
  });

  // Tax lines (SGST, CGST, etc.)
  for (const tax of data.taxes) {
    lines.push({
      type: "text",
      columns: [
        { text: "", width: 24, align: "left" },
        { text: `${tax.label}: ${formatCurrency(tax.amount)}`, width: 18, align: "right" },
      ],
    });
  }

  // Discount (if applicable)
  if (data.discountAmount > 0) {
    const discLabel = data.discountLabel || "Discount";
    lines.push({
      type: "text",
      columns: [
        { text: "", width: 24, align: "left" },
        { text: `${discLabel}: -${formatCurrency(data.discountAmount)}`, width: 18, align: "right" },
      ],
    });
  }

  lines.push({ type: "divider" });

  // Grand total (bold, prominent, with ₹ symbol)
  lines.push({
    type: "text",
    content: `Grand Total ₹${formatCurrency(data.grandTotal)}`,
    align: "center",
    bold: true,
    size: "double",
  });

  // Tip / Gratuity line (if applicable)
  if (data.tipAmount && data.tipAmount > 0) {
    lines.push({
      type: "text",
      columns: [
        { text: "Tip / Gratuity", width: 24, align: "left" },
        { text: `₹${formatCurrency(data.tipAmount)}`, width: 18, align: "right" },
      ],
    });
    lines.push({
      type: "text",
      content: `Total with Tip ₹${formatCurrency(data.grandTotal + data.tipAmount)}`,
      align: "center",
      bold: true,
    });
  }

  lines.push({ type: "divider" });

  // ═══════════════════════════════════════════
  // Zone E: Footer (Payment & Compliance)
  // ═══════════════════════════════════════════

  // Payment line(s)
  if (data.paymentLines.length === 1) {
    // Single payment method
    const singlePayment = data.paymentLines[0]!;
    lines.push({
      type: "text",
      content: `Paid via ${singlePayment.label}`,
      align: "center",
    });
  } else if (data.paymentLines.length > 1) {
    // Split payment — show each leg with amount
    lines.push({
      type: "text",
      content: "Payment (Split)",
      align: "center",
      bold: true,
    });
    for (const line of data.paymentLines) {
      lines.push({
        type: "text",
        columns: [
          { text: `  ${line.label}`, width: 24, align: "left" },
          { text: `\u20B9${formatCurrency(line.amount)}`, width: 18, align: "right" },
        ],
      });
    }
  }

  lines.push({ type: "blank" });

  // FSSAI license number
  if (data.fssaiLicenseNo) {
    lines.push({
      type: "text",
      content: `FSSAI Lic No. ${data.fssaiLicenseNo}`,
      align: "center",
      bold: true,
    });
  }

  // GST number
  if (data.gstNumber) {
    lines.push({
      type: "text",
      content: `GST # : ${data.gstNumber}`,
      align: "center",
      bold: true,
    });
  }

  lines.push({ type: "blank" });

  // Greeting message
  if (data.greetingMessage) {
    lines.push({
      type: "text",
      content: data.greetingMessage,
      align: "center",
    });
  }

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
    if (item.variantName) {
      lines.push({ type: "text", content: `   ${item.variantName}` });
    }
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

/**
 * Format date as DD/MM/YY HH:MM (matching Indian receipt convention).
 * e.g., "09/08/26 14:10"
 */
function formatDateDDMMYY(date: Date): string {
  const dd = date.getDate().toString().padStart(2, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const yy = (date.getFullYear() % 100).toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${dd}/${mm}/${yy}  ${hh}:${min}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Format order type enum to human-readable label.
 */
function formatOrderType(type: ReceiptData["orderType"]): string {
  const labels: Record<ReceiptData["orderType"], string> = {
    DINE_IN: "Dine In",
    TAKEAWAY: "Takeaway",
    DELIVERY: "Delivery",
    ONLINE: "Online",
  };
  return labels[type];
}

/**
 * Format number as currency with 2 decimal places.
 */
function formatCurrency(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Truncate a string to max length.
 */
function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.substring(0, maxLen);
}

// ─── Shift Report Template ───

export interface ShiftReportPrintData {
  reportType: "X" | "Z";
  outletName: string;
  outletAddress?: string;

  cashierName: string;
  openedAt: Date;
  closedAt?: Date;
  openingFloat: number;

  totalCashSales: number;
  totalCardSales: number;
  totalUpiSales: number;
  totalOnlineSales: number;
  totalSplitSales: number;
  totalOrders: number;
  totalDiscounts: number;
  totalTips: number;
  totalChangeDue: number;

  expectedCashInDrawer: number;
  actualCashInDrawer?: number;
  cashVariance?: number;
}

/**
 * Build a shift report (X-Report or Z-Report) as ReceiptLine[].
 */
export function buildShiftReport(data: ShiftReportPrintData): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const w = PAPER_WIDTH;

  // Header
  lines.push({ type: "text", content: data.outletName, align: "center", bold: true, size: "double" });
  if (data.outletAddress) {
    lines.push({ type: "text", content: data.outletAddress, align: "center" });
  }
  lines.push({ type: "blank" });

  // Report type banner
  const reportLabel = data.reportType === "Z" ? "═══ Z-REPORT (DAY CLOSE) ═══" : "═══ X-REPORT (MID-SHIFT) ═══";
  lines.push({ type: "text", content: reportLabel, align: "center", bold: true });
  lines.push({ type: "divider" });

  // Shift details
  lines.push({
    type: "text",
    columns: [
      { text: "Cashier:", width: 14, align: "left" },
      { text: data.cashierName, width: w - 14, align: "right" },
    ],
  });
  lines.push({
    type: "text",
    columns: [
      { text: "Shift Start:", width: 14, align: "left" },
      { text: formatDateTime(data.openedAt), width: w - 14, align: "right" },
    ],
  });
  if (data.closedAt) {
    lines.push({
      type: "text",
      columns: [
        { text: "Shift End:", width: 14, align: "left" },
        { text: formatDateTime(data.closedAt), width: w - 14, align: "right" },
      ],
    });
  }

  lines.push({ type: "divider" });

  // Sales Breakdown
  lines.push({ type: "text", content: "SALES BREAKDOWN", align: "center", bold: true });
  lines.push({ type: "divider" });

  const totalSales = data.totalCashSales + data.totalCardSales + data.totalUpiSales + data.totalOnlineSales + data.totalSplitSales;

  const salesRows: [string, number][] = [
    ["Cash Sales", data.totalCashSales],
    ["Card Sales", data.totalCardSales],
    ["UPI Sales", data.totalUpiSales],
    ["Online Sales", data.totalOnlineSales],
    ["Split Sales", data.totalSplitSales],
  ];

  for (const [label, amount] of salesRows) {
    if (amount > 0) {
      lines.push({
        type: "text",
        columns: [
          { text: label, width: w - 12, align: "left" },
          { text: formatCurrency(amount), width: 12, align: "right" },
        ],
      });
    }
  }

  lines.push({ type: "divider" });
  lines.push({
    type: "text",
    bold: true,
    columns: [
      { text: "TOTAL SALES", width: w - 12, align: "left" },
      { text: formatCurrency(totalSales), width: 12, align: "right" },
    ],
  });

  lines.push({ type: "blank" });

  // Order stats
  lines.push({
    type: "text",
    columns: [
      { text: "Total Orders:", width: w - 12, align: "left" },
      { text: String(data.totalOrders), width: 12, align: "right" },
    ],
  });
  if (data.totalDiscounts > 0) {
    lines.push({
      type: "text",
      columns: [
        { text: "Total Discounts:", width: w - 12, align: "left" },
        { text: `-${formatCurrency(data.totalDiscounts)}`, width: 12, align: "right" },
      ],
    });
  }
  if (data.totalTips > 0) {
    lines.push({
      type: "text",
      columns: [
        { text: "Total Tips:", width: w - 12, align: "left" },
        { text: formatCurrency(data.totalTips), width: 12, align: "right" },
      ],
    });
  }

  lines.push({ type: "divider" });

  // Cash Reconciliation
  lines.push({ type: "text", content: "CASH RECONCILIATION", align: "center", bold: true });
  lines.push({ type: "divider" });

  lines.push({
    type: "text",
    columns: [
      { text: "Opening Float:", width: w - 12, align: "left" },
      { text: formatCurrency(data.openingFloat), width: 12, align: "right" },
    ],
  });
  lines.push({
    type: "text",
    columns: [
      { text: "(+) Cash Sales:", width: w - 12, align: "left" },
      { text: formatCurrency(data.totalCashSales), width: 12, align: "right" },
    ],
  });
  if (data.totalChangeDue > 0) {
    lines.push({
      type: "text",
      columns: [
        { text: "(-) Change Given:", width: w - 12, align: "left" },
        { text: formatCurrency(data.totalChangeDue), width: 12, align: "right" },
      ],
    });
  }
  lines.push({ type: "divider" });
  lines.push({
    type: "text",
    bold: true,
    columns: [
      { text: "Expected Cash:", width: w - 12, align: "left" },
      { text: formatCurrency(data.expectedCashInDrawer), width: 12, align: "right" },
    ],
  });

  if (data.actualCashInDrawer !== undefined) {
    lines.push({
      type: "text",
      bold: true,
      columns: [
        { text: "Actual Cash:", width: w - 12, align: "left" },
        { text: formatCurrency(data.actualCashInDrawer), width: 12, align: "right" },
      ],
    });

    if (data.cashVariance !== undefined) {
      const varianceLabel = data.cashVariance >= 0 ? "OVER" : "SHORT";
      const varianceStr = `${varianceLabel} ${formatCurrency(Math.abs(data.cashVariance))}`;
      lines.push({
        type: "text",
        bold: true,
        columns: [
          { text: "Variance:", width: w - 18, align: "left" },
          { text: varianceStr, width: 18, align: "right" },
        ],
      });
    }
  }

  lines.push({ type: "divider" });
  lines.push({ type: "blank" });

  if (data.reportType === "Z") {
    lines.push({ type: "blank" });
    lines.push({ type: "text", content: "Cashier Signature: ___________", align: "left" });
    lines.push({ type: "blank" });
    lines.push({ type: "text", content: "Manager Signature: ___________", align: "left" });
  }

  lines.push({ type: "blank" });
  lines.push({
    type: "text",
    content: `Generated: ${formatDateTime(new Date())}`,
    align: "center",
  });

  return lines;
}

/**
 * Format a Date to "DD/MM/YYYY HH:MM" for receipt display.
 */
function formatDateTime(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  const h = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${d}/${m}/${y} ${h}:${min}`;
}

// ─── Renderers ───

