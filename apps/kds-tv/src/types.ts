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

// ─── KOT Item (as received from Socket.IO / REST) ───

export interface KDSKotItem {
  name: string;
  quantity: number;
  modifiers: string[];
  notes?: string | null;
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
