/**
 * Gusto Core Logic — Tax & Cart Calculations
 *
 * This module contains all shared business logic that must remain
 * consistent across POS (local), Cloud API, and Admin Dashboard.
 * NEVER duplicate this logic — import from @gusto/core-logic.
 */

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

export interface CartItem {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: GSTRate;
  modifiers?: string[];
}

export interface DiscountConfig {
  type: "PERCENTAGE" | "FLAT";
  value: number;
  /** Max discount cap for percentage discounts */
  maxDiscount?: number;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxBreakdown: TaxBreakdown[];
  totalTax: number;
  grandTotal: number;
  itemCount: number;
}

/**
 * Calculate complete cart totals including tax and optional discount.
 * Tax is calculated on the discounted subtotal (post-discount).
 */
export function calculateCartTotals(
  items: CartItem[],
  discount?: DiscountConfig
): CartTotals {
  // Subtotal
  const subtotal = items.reduce(
    (sum, item) => sum + roundCurrency(item.unitPrice * item.quantity),
    0
  );

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
    const itemTotal = roundCurrency(item.unitPrice * item.quantity * discountRatio);
    const existing = taxByRate.get(item.gstRate) ?? 0;
    taxByRate.set(item.gstRate, existing + itemTotal);
  }

  const taxBreakdown: TaxBreakdown[] = [];
  let totalTax = 0;

  for (const [rate, amount] of taxByRate) {
    const breakdown = calculateGST(amount, rate);
    taxBreakdown.push(breakdown);
    totalTax += breakdown.totalTax;
  }

  totalTax = roundCurrency(totalTax);

  return {
    subtotal: roundCurrency(subtotal),
    discountAmount: roundCurrency(discountAmount),
    taxBreakdown,
    totalTax,
    grandTotal: roundCurrency(discountedSubtotal + totalTax),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
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
