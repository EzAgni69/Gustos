/**
 * Gusto Captain — App Constants
 *
 * Central configuration for API routes, socket events, and enums.
 */

// ─── API Endpoints (relative to server base URL) ───

export const API = {
  HEALTH: "/health",
  AUTH: {
    PIN_LOGIN: "/api/auth/pin-login",
    USERS: "/api/auth/users",
  },
  MENU: {
    CATEGORIES: "/api/menu/categories",
    ITEMS: "/api/menu/items",
  },
  TABLES: {
    LIST: "/api/tables",
    STATUS: (id: string) => `/api/tables/${id}/status`,
    TRANSFER: "/api/tables/transfer",
  },
  ORDERS: {
    LIST: "/api/orders",
    CREATE: "/api/orders",
    GET: (id: string) => `/api/orders/${id}`,
    ADD_ITEMS: (id: string) => `/api/orders/${id}/items`,
    UPDATE_ITEM: (orderId: string, itemId: string) =>
      `/api/orders/${orderId}/items/${itemId}`,
    DELETE_ITEM: (orderId: string, itemId: string) =>
      `/api/orders/${orderId}/items/${itemId}`,
    HOLD: (id: string) => `/api/orders/${id}/hold`,
    CANCEL: (id: string) => `/api/orders/${id}/cancel`,
  },
  KOT: {
    FIRE: (orderId: string) => `/api/orders/${orderId}/kot`,
    LIST: "/api/kots",
    UPDATE_STATUS: (id: string) => `/api/kots/${id}/status`,
  },
} as const;

// ─── Socket Events ───

export const SOCKET_EVENTS = {
  JOIN_CAPTAIN: "join:captain",
  TABLE_STATUS_CHANGED: "table:status-changed",
  ORDER_UPDATED: "order:updated",
  KOT_NEW: "kot:new",
  KOT_STATUS_UPDATE: "kot:status-update",
} as const;

// ─── Common Modifiers (hardcoded for now — will come from server later) ───

export const COMMON_MODIFIERS = [
  "Less spicy",
  "Extra spicy",
  "No onion",
  "No garlic",
  "Extra cheese",
  "Extra gravy",
  "Half portion",
  "Jain",
  "Sugar-free",
  "Less oil",
  "Well done",
  "No ice",
] as const;

// ─── Default Server Port ───

export const DEFAULT_PORT = "8080";
