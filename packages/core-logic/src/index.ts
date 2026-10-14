/**
 * Gusto Core Logic — Tax, Cart, Payment & Receipt Calculations
 *
 * This module contains all shared business logic that must remain
 * consistent across POS (local), Cloud API, and Admin Dashboard.
 * NEVER duplicate this logic — import from @gusto/core-logic.
 */

import type {
  ReceiptData,
  ReceiptItem,
  ReceiptAddOn,
  TaxLine,
  PaymentSplitLine,
} from "@gusto/printer";

// ─── GST Tax Engine ───

export type GSTRate = "0" | "5" | "12" | "18" | "28";

export interface TaxBreakdown {
  cgst: number;
  sgst: number;
  totalTax: number;
  taxRate: GSTRate;
}

/**
 * Calculate GST tax split (CGST + SGST) for a given amount.
 * Indian GST is split equally between Central GST and State GST.
 */
export function calculateGST(amount: number, rate: GSTRate): TaxBreakdown {
  const rateNum = Number(rate);
  const halfRate = rateNum / 2;
  const cgst = roundCurrency((amount * halfRate) / 100);
  const sgst = roundCurrency((amount * halfRate) / 100);

  return {
    cgst,
    sgst,
    totalTax: roundCurrency(cgst + sgst),
    taxRate: rate,
  };
}

// ─── Cart Calculation Engine ───

export interface CartItemAddOn {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CartItem {
  menuItemId: string;
  menuItemName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  gstRate: GSTRate;
  modifiers?: string[];
  notes?: string;
  addOns?: CartItemAddOn[];
}

export interface DiscountConfig {
  type: "PERCENTAGE" | "FLAT";
  value: number;
  /** Max discount cap for percentage discounts */
  maxDiscount?: number;
  /** Display label, e.g., "Happy Hour", "10% Off" */
  label?: string;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxBreakdown: TaxBreakdown[];
  totalCgst: number;
  totalSgst: number;
  totalTax: number;
  grandTotal: number;
  itemCount: number;
  totalQuantity: number;
}

/**
 * Calculate complete cart totals including tax and optional discount.
 * Tax is calculated on the discounted subtotal (post-discount).
 */
export function calculateCartTotals(
  items: CartItem[],
  discount?: DiscountConfig
): CartTotals {
  // Include add-on amounts in subtotal
  const subtotal = items.reduce((sum, item) => {
    let itemTotal = roundCurrency(item.unitPrice * item.quantity);
    if (item.addOns) {
      for (const addOn of item.addOns) {
        itemTotal += roundCurrency(addOn.unitPrice * addOn.quantity);
      }
    }
    return sum + itemTotal;
  }, 0);

  // Discount
  let discountAmount = 0;
  if (discount) {
    if (discount.type === "PERCENTAGE") {
      discountAmount = roundCurrency((subtotal * discount.value) / 100);
      if (discount.maxDiscount) {
        discountAmount = Math.min(discountAmount, discount.maxDiscount);
      }
    } else {
      discountAmount = Math.min(discount.value, subtotal);
    }
  }

  const discountedSubtotal = roundCurrency(subtotal - discountAmount);

  // Apply proportional discount to each item's amount for accurate per-rate tax
  const discountRatio = subtotal > 0 ? discountedSubtotal / subtotal : 0;

  // Group items by GST rate and calculate tax
  const taxByRate = new Map<GSTRate, number>();
  for (const item of items) {
    let itemTotal = roundCurrency(item.unitPrice * item.quantity * discountRatio);
    if (item.addOns) {
      for (const addOn of item.addOns) {
        itemTotal += roundCurrency(addOn.unitPrice * addOn.quantity * discountRatio);
      }
    }
    const existing = taxByRate.get(item.gstRate) ?? 0;
    taxByRate.set(item.gstRate, existing + itemTotal);
  }

  const taxBreakdown: TaxBreakdown[] = [];
  let totalTax = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  for (const [rate, amount] of taxByRate) {
    const breakdown = calculateGST(amount, rate);
    taxBreakdown.push(breakdown);
    totalTax += breakdown.totalTax;
    totalCgst += breakdown.cgst;
    totalSgst += breakdown.sgst;
  }

  totalTax = roundCurrency(totalTax);
  totalCgst = roundCurrency(totalCgst);
  totalSgst = roundCurrency(totalSgst);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    subtotal: roundCurrency(subtotal),
    discountAmount: roundCurrency(discountAmount),
    taxBreakdown,
    totalCgst,
    totalSgst,
    totalTax,
    grandTotal: roundCurrency(discountedSubtotal + totalTax),
    itemCount: items.length,
    totalQuantity,
  };
}

// ─── Split Payment Validation ───

export interface PaymentSplitInput {
  mode: string;
  subMethod?: string;
  amount: number;
  reference?: string;
}

/**
 * Validate that split payment legs sum to the grand total.
 * Returns { valid: true } or { valid: false, error: "..." }
 */
export function validatePaymentSplits(
  splits: PaymentSplitInput[],
  grandTotal: number
): { valid: boolean; error?: string } {
  if (splits.length < 2) {
    return { valid: false, error: "Split payment requires at least 2 payment legs" };
  }

  for (let i = 0; i < splits.length; i++) {
    const split = splits[i]!;
    if (split.amount <= 0) {
      return { valid: false, error: `Payment leg ${i + 1} has invalid amount: ${split.amount}` };
    }
    if (split.mode === "SPLIT") {
      return { valid: false, error: "Cannot nest SPLIT inside a split payment leg" };
    }
  }

  const totalSplitAmount = splits.reduce((sum, s) => sum + s.amount, 0);
  const diff = Math.abs(totalSplitAmount - grandTotal);

  // Allow ₹0.01 tolerance for floating point
  if (diff > 0.01) {
    return {
      valid: false,
      error: `Split amounts (₹${totalSplitAmount.toFixed(2)}) do not match grand total (₹${grandTotal.toFixed(2)}). Difference: ₹${diff.toFixed(2)}`,
    };
  }

  return { valid: true };
}

// ─── Payment Label Formatter ───

const PAYMENT_MODE_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  ONLINE: "Online",
  OTHER: "Other",
  SPLIT: "Split",
};

const PAYMENT_SUBMETHOD_LABELS: Record<string, string> = {
  PHONEPE: "PhonePe",
  GPAY: "GPay",
  PAYTM: "Paytm",
  RAZORPAY: "Razorpay",
  OTHER: "Other",
};

/**
 * Format payment mode + sub-method into a human-readable label.
 * e.g., "CASH" → "Cash", "UPI" + "PHONEPE" → "UPI [PhonePe]"
 */
export function formatPaymentLabel(mode: string, subMethod?: string): string {
  const modeLabel = PAYMENT_MODE_LABELS[mode] ?? mode;
  if (subMethod) {
    const subLabel = PAYMENT_SUBMETHOD_LABELS[subMethod] ?? subMethod;
    return `${modeLabel} [${subLabel}]`;
  }
  return modeLabel;
}

/**
 * Build PaymentSplitLine[] for the printer from payment data.
 * Handles both single and split payments.
 */
export function buildPaymentLines(
  paymentMode: string,
  paymentSubMethod?: string,
  splits?: PaymentSplitInput[],
  grandTotal?: number
): PaymentSplitLine[] {
  if (paymentMode === "SPLIT" && splits && splits.length > 0) {
    return splits.map((s) => ({
      label: formatPaymentLabel(s.mode, s.subMethod),
      amount: s.amount,
    }));
  }

  return [{
    label: formatPaymentLabel(paymentMode, paymentSubMethod),
    amount: grandTotal ?? 0,
  }];
}

// ─── Bill-to-Receipt Transformer ───

/** Minimal order record shape needed for receipt building */
export interface OrderRecord {
  orderNumber: string;
  orderMode: string;
  customerName?: string | null;
  cashierName?: string | null;
  tokenNumbers?: string | null; // JSON string
  paymentMode?: string | null;
  paymentSubMethod?: string | null;
  paymentSplits?: string | null; // JSON string
  tableId?: string | null;
  discountLabel?: string | null;
  createdAt: string;
}

/** Minimal order item record shape */
export interface OrderItemRecord {
  menuItemName: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
  modifiers?: string | null; // JSON string
  notes?: string | null;
  addOns?: string | null; // JSON string
}

/** Minimal invoice record shape */
export interface InvoiceRecord {
  invoiceNumber: string;
  receiptStatus?: string | null;
  subtotal: number;
  discountAmount: number;
  cgstRate?: number | null;
  cgstAmount: number;
  sgstRate?: number | null;
  sgstAmount: number;
  totalQuantity?: number | null;
  totalAmount: number;
  paymentMode: string;
  paymentSubMethod?: string | null;
  paymentSplits?: string | null; // JSON string
  tipAmount?: number | null;
  tenderedAmount?: number | null;
  changeDue?: number | null;
}

/** Outlet configuration for receipt */
export interface OutletConfig {
  outletName: string;
  address: string;
  phone?: string | null;
  gstNumber?: string | null;
  fssaiLicenseNo?: string | null;
  greetingMessage?: string | null;
  logoImagePath?: string | null;
}

/** Table name lookup result */
export interface TableInfo {
  name: string;
}

/**
 * Build a complete ReceiptData from order, items, invoice, and outlet config.
 * This is the single source of truth for receipt construction — eliminates
 * all manual ReceiptData assembly in checkout.service.ts and print.routes.ts.
 */
export function buildReceiptFromOrder(params: {
  order: OrderRecord;
  items: OrderItemRecord[];
  invoice: InvoiceRecord;
  outlet: OutletConfig;
  table?: TableInfo | null;
  receiptStatusOverride?: "ORIGINAL" | "DUPLICATE" | "TRIPLICATE";
}): ReceiptData {
  const { order, items, invoice, outlet, table, receiptStatusOverride } = params;

  // Parse token numbers from JSON
  let tokenNumbers: number[] = [];
  if (order.tokenNumbers) {
    try {
      tokenNumbers = JSON.parse(order.tokenNumbers);
    } catch {
      tokenNumbers = [];
    }
  }

  // Build receipt items
  const receiptItems: ReceiptItem[] = items.map((item) => {
    // Parse modifiers
    let modifiers: string[] | undefined;
    if (item.modifiers) {
      try {
        modifiers = JSON.parse(item.modifiers);
      } catch {
        modifiers = undefined;
      }
    }

    // Parse add-ons
    let addOns: ReceiptAddOn[] | undefined;
    if (item.addOns) {
      try {
        addOns = JSON.parse(item.addOns);
      } catch {
        addOns = undefined;
      }
    }

    return {
      name: item.menuItemName,
      variantName: item.variantName ?? undefined,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: roundCurrency(item.unitPrice * item.quantity),
      modifiers,
      notes: item.notes ?? undefined,
      addOns,
    };
  });

  // Build tax lines
  const cgstRate = invoice.cgstRate ?? 2.5;
  const sgstRate = invoice.sgstRate ?? 2.5;
  const taxes: TaxLine[] = [];

  if (invoice.sgstAmount > 0) {
    taxes.push({
      label: `SGST ${sgstRate}%`,
      rate: sgstRate,
      amount: invoice.sgstAmount,
    });
  }
  if (invoice.cgstAmount > 0) {
    taxes.push({
      label: `CGST ${cgstRate}%`,
      rate: cgstRate,
      amount: invoice.cgstAmount,
    });
  }

  // Build payment lines
  const paymentMode = invoice.paymentMode || order.paymentMode || "CASH";
  const paymentSubMethod = invoice.paymentSubMethod || order.paymentSubMethod || undefined;
  let paymentSplits: PaymentSplitInput[] | undefined;
  const splitsJson = invoice.paymentSplits || order.paymentSplits;
  if (splitsJson) {
    try {
      paymentSplits = JSON.parse(splitsJson);
    } catch {
      paymentSplits = undefined;
    }
  }

  const paymentLines = buildPaymentLines(
    paymentMode,
    paymentSubMethod,
    paymentSplits,
    invoice.totalAmount
  );

  // Determine receipt status
  const receiptStatus = receiptStatusOverride
    ?? (invoice.receiptStatus as "ORIGINAL" | "DUPLICATE" | "TRIPLICATE" | undefined)
    ?? "ORIGINAL";

  // Map order mode to order type
  const orderTypeMap: Record<string, ReceiptData["orderType"]> = {
    DINE_IN: "DINE_IN",
    TAKEAWAY: "TAKEAWAY",
    DELIVERY: "DELIVERY",
    ONLINE: "ONLINE",
  };

  const totalQuantity = invoice.totalQuantity
    ?? items.reduce((sum, i) => sum + i.quantity, 0);

  return {
    // Zone A
    logoImagePath: outlet.logoImagePath ?? undefined,
    receiptStatus,
    outletName: outlet.outletName,
    outletAddress: outlet.address,
    outletPhone: outlet.phone ?? undefined,

    // Zone B
    customerName: order.customerName ?? undefined,
    date: new Date(order.createdAt),
    orderType: orderTypeMap[order.orderMode] ?? "DINE_IN",
    tableIdentifier: table?.name,
    cashierName: order.cashierName ?? "Admin",
    billNumber: invoice.invoiceNumber,
    tokenNumbers,

    // Zone C
    items: receiptItems,

    // Zone D
    totalQuantity,
    subtotal: invoice.subtotal,
    taxes,
    discountLabel: order.discountLabel ?? undefined,
    discountAmount: invoice.discountAmount,
    grandTotal: invoice.totalAmount,
    tipAmount: invoice.tipAmount ?? undefined,

    // Zone E
    paymentLines,
    fssaiLicenseNo: outlet.fssaiLicenseNo ?? undefined,
    gstNumber: outlet.gstNumber ?? undefined,
    greetingMessage: outlet.greetingMessage ?? undefined,
  };
}

// ─── Utility Functions ───

/**
 * Round to 2 decimal places (currency precision).
 * Uses banker's rounding to avoid floating point drift.
 */
export function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Generate a sequential order number for a given outlet.
 * Format: OUT-YYYYMMDD-XXXX (e.g., OUT-20260714-0042)
 */
export function generateOrderNumber(
  outletPrefix: string,
  sequenceNumber: number
): string {
  const date = new Date();
  const dateStr =
    date.getFullYear().toString() +
    (date.getMonth() + 1).toString().padStart(2, "0") +
    date.getDate().toString().padStart(2, "0");
  const seq = sequenceNumber.toString().padStart(4, "0");
  return `${outletPrefix}-${dateStr}-${seq}`;
}

/**
 * Generate a KOT number.
 * Format: KOT-XXXX
 */
export function generateKOTNumber(sequenceNumber: number): string {
  return `KOT-${sequenceNumber.toString().padStart(4, "0")}`;
}

/**
 * Check if an order is within the editable window (48 hours).
 */
export function isOrderEditable(orderCreatedAt: Date): boolean {
  const now = new Date();
  const diffMs = now.getTime() - orderCreatedAt.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours <= 48;
}
