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

// ─── Station Configuration (shared with POS server) ───

export {
  KDS_STATIONS,
  EXPO_STATION_ID,
  getItemStationId,
  getRequiredStations,
  getStationConfig,
  type StationConfig,
} from "@gusto/api-contracts";

// ─── Order channel (how the dish leaves the pass) ───

export type OrderMode = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
export type OrderPlatform = "ZOMATO" | "SWIGGY";

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
  /** Marked urgent from the POS — shown first with a RUSH banner */
  isRush?: boolean;
  /** Dine-in / takeaway / delivery / online — drives the plating vs packing badge */
  orderMode?: OrderMode;
  /** Aggregator for ONLINE orders, when known */
  platform?: OrderPlatform | null;
  /** Set when the POS changed the order's mode after this KOT was fired */
  previousOrderMode?: OrderMode;
  /** Stations that already finished their part of this KOT (multi-station tickets) */
  readyStations?: string[];
}

// ─── Completed KOT (for history / recall) ───

export interface CompletedKot extends KDSKot {
  completedAt: string; // ISO timestamp when the KOT was bumped
  /** Set when only one station bumped its part (station-level recall) */
  stationId?: string;
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
  orderMode?: OrderMode;
  platform?: OrderPlatform | null;
  items: KDSKotItem[];
  createdAt: string;
}

/** Payload from `order:mode-changed` socket event */
export interface OrderModeChangedPayload {
  orderId: string;
  orderNumber: string;
  oldMode: OrderMode;
  newMode: OrderMode;
  tableId?: string | null;
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

/** Payload from `kot:rush` socket event */
export interface KotRushPayload {
  kotId: string;
  kotNumber: string;
  orderId: string;
  orderNumber: string;
  tableName?: string;
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
  readyStations?: string[];
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  createdAt: string;
  isRush?: boolean;
  orderNumber?: string;
  orderMode?: OrderMode;
  platform?: OrderPlatform | null;
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
  /** Station-scoped bump (POST /kots/:id/stations/:stationId/ready|recall) */
  stationId?: string;
  targetStatus: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  timestamp: string;
  retryCount: number;
}

// ─── Station readiness & Expo (pass) ───

/** Payload from `kot:station-status` socket event */
export interface KotStationStatusPayload {
  kotId: string;
  kotNumber: string;
  orderId: string;
  stationId: string;
  requiredStations: string[];
  readyStations: string[];
  kotReady: boolean;
}

export type ExpoStationState = "READY" | "COOKING" | "QUEUED";

/** One whole table order on the Expo screen (GET /api/expo/orders) */
export interface ExpoOrder {
  orderId: string;
  orderNumber: string;
  tableName: string | null;
  orderMode: OrderMode;
  platform: OrderPlatform | null;
  waiterId: string | null;
  waiterName: string | null;
  paxCount: number;
  isRush: boolean;
  kotIds: string[];
  kotNumbers: string[];
  firstFiredAt: string;
  readyStations: number;
  allReady: boolean;
  stations: Array<{
    stationId: string;
    name: string;
    icon: string;
    state: ExpoStationState;
    readyKots: number;
    totalKots: number;
    items: Array<{
      name: string;
      variantName: string | null;
      quantity: number;
      modifiers: string[];
      notes: string | null;
      kotNumber: string;
      ready: boolean;
    }>;
  }>;
}

/** Recently sent from the pass (GET /api/expo/recent) */
export interface ExpoRecentBump {
  orderId: string;
  orderNumber: string;
  tableName: string | null;
  orderMode: OrderMode;
  platform: OrderPlatform | null;
  waiterName: string | null;
  kotNumbers: string[];
  bumpedAt: string;
}
