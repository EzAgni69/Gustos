import type { Order } from "@gusto/api-contracts";

// ─── Order Filter ───

/**
 * Filters an orders list by a free-text query.
 *
 * Matching rules (case-insensitive):
 * - `order.orderNumber` starts with the query, OR
 * - `order.customerName` contains the query (falls back to "" when absent)
 *
 * @param orders - The full array of orders to filter.
 * @param query  - The search string; an empty/blank string returns the full list.
 * @returns A new array containing only the orders that match the query.
 */
export function filterOrders(orders: Order[], query: string): Order[] {
  const q = query.trim().toLowerCase();
  if (!q) return orders;

  return orders.filter(
    (order) =>
      order.orderNumber.toLowerCase().startsWith(q) ||
      (order.customerName ?? "").toLowerCase().includes(q),
  );
}
