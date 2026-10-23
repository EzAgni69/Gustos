/**
 * KDS-TV Type Definitions
 *
 * Local types for the Kitchen Display System, extending
 * the shared api-contracts KOT types with display-specific fields.
 */

// ─── Timer Status ───

export type TimerStatus = "green" | "yellow" | "red";

// ─── Connection Status ───

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

// ─── Hold & Fire Status ───

export type HoldStatus = "HOLD" | "FIRE" | null;

// ─── KOT Item (as received from Socket.IO / REST) ───

export interface KDSKotItem {
  name: string;
  quantity: number;
  modifiers: string[];
  notes?: string | null;
  categoryId?: string | null;
  variantName?: string | null;
}

// ─── Station Configuration ───

export interface StationConfig {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  categories: string[];
}

export const KDS_STATIONS: StationConfig[] = [
  {
    id: "pizza-oven",
    name: "Pizza Oven",
    shortName: "PIZZA OVEN",
    icon: "🍕",
    categories: [
      "cat-pizza-reg", "cat-pizza-prem", "cat-calzones", "cat-combos",
      "5aa53373-e5f5-48bb-a71c-88da6587157b", // Regular Pizzas
      "fb728bde-fe2f-4535-a093-2d012bfbd63d", // Premium Pizzas
      "1b1a2bd0-f2c7-4c3d-9eeb-83ace0eeb567", // Calzones
      "49c3f4ca-65ca-45ac-9352-589216caeddd", // Combos & Specials
    ],
  },
  {
    id: "pasta-starters",
    name: "Pasta & Starters",
    shortName: "PASTA & STARTERS",
    icon: "🍝",
    categories: [
      "cat-pasta", "cat-starters", "cat-sandwiches", "cat-bruschetta",
      "4cd3a8d0-c68b-4072-afa3-063df179504d", // Starters
      "3f7f530a-d03b-4ec7-82a8-b92ab9dea728", // Bruschetta
      "a0c63bc4-cf92-42cb-a9e3-011766c35b96", // Sandwiches
      "a62f1fd8-cf22-49d0-ae15-dd65f5ea59a3", // Pastas
      "383a8545-3442-4c5e-b977-7af87e9a1d65", // Add-ons
    ],
  },
  {
    id: "beverages-pantry",
    name: "Beverages & Pantry",
    shortName: "PANTRY & DRINKS",
    icon: "🍹",
    categories: [
      "cat-refreshments", "cat-salads", "cat-desserts",
      "833f4bfb-902e-4837-aa97-9b4814496fcf", // Salads
      "17cb63b9-dbf5-4fcf-9f2b-8dfc1664d604", // Refreshments
      "fc524c1b-f441-46de-a2ac-d184ae06b16e", // Desserts
    ],
  },
];

/**
 * Determine which KDS station handles a given item.
 */
export function getItemStationId(item: KDSKotItem): string {
  if (item.categoryId) {
    for (const st of KDS_STATIONS) {
      if (st.categories.includes(item.categoryId)) {
        return st.id;
      }
    }
  }
  // Fallback by name heuristics if categoryId is missing
  const name = item.name.toLowerCase();
  if (
    name.includes("pizza") ||
    name.includes("calzone") ||
    name.includes("8\"") ||
    name.includes("12\"") ||
    name.includes("margherita") ||
    name.includes("marinara") ||
    name.includes("burrata")
  ) {
    return "pizza-oven";
  }
  if (
    name.includes("pasta") ||
    name.includes("spaghetti") ||
    name.includes("penne") ||
    name.includes("fettuccine") ||
    name.includes("tasca") ||
    name.includes("sandwich") ||
    name.includes("bruschetta") ||
    name.includes("starter") ||
    name.includes("garlic bread") ||
    name.includes("crostini") ||
    name.includes("fries")
  ) {
    return "pasta-starters";
  }
  if (
    name.includes("mojito") ||
    name.includes("water") ||
    name.includes("soda") ||
    name.includes("beverage") ||
    name.includes("tea") ||
    name.includes("coffee") ||
    name.includes("coke") ||
    name.includes("sprite") ||
    name.includes("fanta") ||
    name.includes("salad") ||
    name.includes("dessert") ||
    name.includes("tiramisu") ||
    name.includes("pana cotta") ||
    name.includes("brownie")
  ) {
    return "beverages-pantry";
  }
  return "pasta-starters";
}

// ─── KOT (as displayed on the KDS) ───

export interface KDSKot {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  tableName?: string;
  waiterName?: string | null;
  station?: string | null;
  items: KDSKotItem[];
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  createdAt: string; // ISO timestamp
}

// ─── Completed KOT (for history / recall) ───

export interface CompletedKot extends KDSKot {
  completedAt: string; // ISO timestamp when the KOT was bumped
}

// ─── Socket.IO Event Payloads ───

/** Payload from `kot:new` socket event */
export interface KotNewPayload {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  tableName?: string;
  waiterName?: string | null;
  station?: string | null;
  items: KDSKotItem[];
  createdAt: string;
}

/** Payload from `kot:status-update` socket event */
export interface KotStatusUpdatePayload {
  kotId: string;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  orderNumber: string;
}

/** Payload from `kot:cancelled` socket event */
export interface KotCancelledPayload {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  reason: string;
}

/** Payload from `kot:modification` socket event */
export interface KotModificationPayload {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  tableName?: string;
  modifications: Array<{
    itemName: string;
    changeType: "MODIFIER_CHANGE" | "QUANTITY_CHANGE" | "NOTE_CHANGE";
    oldValue?: string;
    newValue?: string;
  }>;
}

/** Payload from REST `GET /api/kots` — enriched KOT from server */
export interface KotListItem {
  id: string;
  orderId: string;
  kotNumber: string;
  station: string | null;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  createdAt: string;
  orderNumber?: string;
  tableName?: string;
  items: Array<{
    id: string;
    kotId: string;
    orderItemId: string;
    menuItemName: string;
    quantity: number;
    modifiers: string[];
    notes: string | null;
    categoryId?: string | null;
    variantName?: string | null;
  }>;
}

// ─── Timer Thresholds (in seconds) ───

export const TIMER_YELLOW_THRESHOLD = 10 * 60; // 10 minutes
export const TIMER_RED_THRESHOLD = 15 * 60;    // 15 minutes

// ─── Helper: Compute timer status from elapsed seconds ───

export function getTimerStatus(elapsedSeconds: number): TimerStatus {
  if (elapsedSeconds >= TIMER_RED_THRESHOLD) return "red";
  if (elapsedSeconds >= TIMER_YELLOW_THRESHOLD) return "yellow";
  return "green";
}

// ─── Helper: Format elapsed seconds to MM:SS ───

export function formatElapsed(elapsedSeconds: number): string {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// ─── Course Ordering (for Hold & Fire) ───

/**
 * Station → course precedence. Lower number = earlier course.
 * KOTs with higher-numbered courses will show "HOLD" until all
 * lower-numbered courses for the same order are READY/SERVED.
 *
 * This can be overridden via VITE_COURSE_ORDER env var as JSON,
 * e.g.: {"Starters": 1, "Soup": 1, "Salad": 1, "Main Course": 2, "Grill": 2, "Desserts": 3}
 */
const DEFAULT_COURSE_ORDER: Record<string, number> = {
  "Starters": 1,
  "Appetizers": 1,
  "Soup": 1,
  "Salad": 1,
  "Beverages": 1,
  "Main Course": 2,
  "Mains": 2,
  "Grill": 2,
  "Tandoor": 2,
  "Wok": 2,
  "Pasta": 2,
  "Rice": 2,
  "Breads": 2,
  "Desserts": 3,
  "Sweets": 3,
};

function loadCourseOrder(): Record<string, number> {
  try {
    const envVal =
      typeof import.meta !== "undefined" &&
      (import.meta as unknown as Record<string, Record<string, string>>).env
        ?.VITE_COURSE_ORDER;
    if (envVal) return JSON.parse(envVal);
  } catch {
    // Fall back to defaults
  }
  return DEFAULT_COURSE_ORDER;
}

export const COURSE_ORDER = loadCourseOrder();

/**
 * Get the course number for a station name.
 * Returns 0 (highest priority / no hold) if station is unknown or null.
 */
export function getCourseNumber(station: string | null | undefined): number {
  if (!station) return 0;
  // Case-insensitive lookup
  const key = Object.keys(COURSE_ORDER).find(
    (k) => k.toLowerCase() === station.toLowerCase()
  );
  return key ? COURSE_ORDER[key]! : 0;
}

// ─── Bump Queue Item (for offline persistence) ───

export interface BumpQueueItem {
  kotId: string;
  targetStatus: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  timestamp: string;
  retryCount: number;
}
