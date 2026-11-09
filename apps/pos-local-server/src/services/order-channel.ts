/**
 * Gusto POS Local Server — Order channel (mode + aggregator platform)
 *
 * The kitchen needs to know how an order leaves the pass: plated (dine-in),
 * bagged (takeaway) or sealed for a rider (delivery / aggregator).
 */

export type OrderMode = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
export type OrderPlatform = "ZOMATO" | "SWIGGY";

export interface OrderChannel {
  orderMode: OrderMode;
  /** Aggregator for ONLINE orders, when known */
  platform: OrderPlatform | null;
}

const PLATFORM_MARKER = /\b(zomato|swiggy)\s*:/i;

/**
 * Online orders carry their aggregator in the notes marker written by
 * createOnlineOrderFromWebhook (e.g. "onlineOrderId:… | Zomato: 12345").
 */
export function getOrderChannel(order: { orderMode: string; notes?: string | null } | null | undefined): OrderChannel {
  const mode = (order?.orderMode ?? "DINE_IN") as OrderMode;
  let platform: OrderPlatform | null = null;
  if (mode === "ONLINE") {
    const match = order?.notes?.match(PLATFORM_MARKER);
    if (match) platform = match[1]!.toUpperCase() as OrderPlatform;
  }
  return { orderMode: mode, platform };
}

/** Display label for the aggregator marker in order notes. */
export function platformMarkerLabel(provider: unknown): string {
  return String(provider ?? "").toUpperCase() === "SWIGGY" ? "Swiggy" : "Zomato";
}
