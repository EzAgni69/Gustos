/**
 * KDS-TV — Order Mode Badge
 *
 * Full-width, colour-coded strip telling the line how the order leaves the
 * pass: plated (dine-in), bagged (takeaway) or sealed for a rider (delivery /
 * aggregator). Colour carries the meaning at a glance from across the kitchen;
 * the icon + text keep it readable for colour-blind staff.
 */

import type { KDSKot, OrderMode } from "../types";

interface BadgeSpec {
  variant: string;
  icon: string;
  label: string;
  instruction: string;
}

const MODE_LABEL: Record<OrderMode, string> = {
  DINE_IN: "Dine-In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  ONLINE: "Online",
};

export function getOrderModeBadge(kot: Pick<KDSKot, "orderMode" | "platform" | "tableName">): BadgeSpec | null {
  switch (kot.orderMode) {
    case "DINE_IN":
      return {
        variant: "dine-in",
        icon: "🍽️",
        label: kot.tableName ? `Dine-In · ${kot.tableName}` : "Dine-In",
        instruction: "Plate",
      };
    case "TAKEAWAY":
      return { variant: "takeaway", icon: "🛍️", label: "Takeaway", instruction: "Pack · Bag" };
    case "DELIVERY":
      return { variant: "delivery", icon: "🛵", label: "Delivery", instruction: "Pack · Seal" };
    case "ONLINE":
      if (kot.platform === "ZOMATO") {
        return { variant: "zomato", icon: "🛵", label: "Zomato", instruction: "Pack · Seal" };
      }
      if (kot.platform === "SWIGGY") {
        return { variant: "swiggy", icon: "🛵", label: "Swiggy", instruction: "Pack · Seal" };
      }
      return { variant: "delivery", icon: "🛵", label: "Online", instruction: "Pack · Seal" };
    default:
      return null; // older server without orderMode — header table chip is the fallback
  }
}

export function OrderModeBadge({ kot }: { kot: KDSKot }) {
  const badge = getOrderModeBadge(kot);
  if (!badge) return null;

  return (
    <div className={`kot-mode-badge kot-mode-${badge.variant}`} role="note" aria-label={`${badge.label}: ${badge.instruction}`}>
      <span className="kot-mode-icon" aria-hidden="true">{badge.icon}</span>
      <span className="kot-mode-label">{badge.label}</span>
      {kot.previousOrderMode && (
        <span className="kot-mode-changed">was {MODE_LABEL[kot.previousOrderMode]}</span>
      )}
      <span className="kot-mode-instruction">{badge.instruction}</span>
    </div>
  );
}
