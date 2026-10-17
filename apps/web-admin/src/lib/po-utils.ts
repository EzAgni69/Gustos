/**
 * Calculates the total value of a purchase order from its line items.
 *
 * @param lineItems - Array of line items, each with a quantity and unit price.
 * @returns The total rounded to 2 decimal places, or 0 for an empty array.
 */
export function calculatePOTotal(
  lineItems: { quantity: number; unitPrice: number }[]
): number {
  if (lineItems.length === 0) return 0;

  const sum = lineItems.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0);
  return Math.round(sum * 100) / 100;
}
