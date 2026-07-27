/**
 * Gusto Captain — API Client
 *
 * HTTP client for communicating with pos-local-server over LAN.
 * Automatically attaches X-User-Id header from auth store.
 */

import { API } from "../config/constants";

let baseUrl = "";
let currentUserId: string | null = null;

// ─── Configuration ───

export function setBaseUrl(serverIp: string): void {
  // Ensure no trailing slash
  baseUrl = serverIp.startsWith("http")
    ? serverIp.replace(/\/$/, "")
    : `http://${serverIp}`;
}

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getBaseUrl(): string {
  return baseUrl;
}

// ─── Core Request ───

interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
}

async function request<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  if (!baseUrl) {
    throw new Error("Server not configured. Set baseUrl first.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (currentUserId) {
    headers["X-User-Id"] = currentUserId;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.message || `Request failed: ${response.status}`);
  }

  return json as ApiResponse<T>;
}

// ─── Health Check ───

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${baseUrl}${API.HEALTH}`);
  return res.json();
}

// ─── Auth ───

interface AuthUser {
  id: string;
  name: string;
  role: string;
}

export async function getUsers(): Promise<AuthUser[]> {
  const res = await request<AuthUser[]>(API.AUTH.USERS);
  return res.data;
}

export async function pinLogin(
  pin: string
): Promise<{ id: string; name: string; role: string }> {
  const res = await request<{ id: string; name: string; role: string }>(
    API.AUTH.PIN_LOGIN,
    {
      method: "POST",
      body: JSON.stringify({ pin }),
    }
  );
  return res.data;
}

// ─── Menu ───

export interface MenuCategoryResponse {
  id: string;
  outletId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuItemResponse {
  id: string;
  categoryId: string;
  outletId: string;
  name: string;
  description: string | null;
  price: number;
  gstRate: string;
  isVeg: boolean;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function getCategories(): Promise<MenuCategoryResponse[]> {
  const res = await request<MenuCategoryResponse[]>(API.MENU.CATEGORIES);
  return res.data;
}

export async function getMenuItems(
  categoryId?: string
): Promise<MenuItemResponse[]> {
  const query = categoryId ? `?categoryId=${categoryId}&available=true` : "?available=true";
  const res = await request<MenuItemResponse[]>(
    `${API.MENU.ITEMS}${query}`
  );
  return res.data;
}

// ─── Tables ───

export interface TableResponse {
  id: string;
  outletId: string;
  name: string;
  capacity: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "CLEANING";
  section: string | null;
  sortOrder: number;
  currentOrderId: string | null;
  currentOrder: {
    id: string;
    orderNumber: string;
    totalAmount: number;
    waiterName: string | null;
    paxCount: number;
    createdAt: string;
  } | null;
}

export async function getTables(): Promise<TableResponse[]> {
  const res = await request<TableResponse[]>(API.TABLES.LIST);
  return res.data;
}

export async function updateTableStatus(
  tableId: string,
  status: string
): Promise<void> {
  await request(API.TABLES.STATUS(tableId), {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// ─── Orders ───

export interface OrderItemResponse {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: string;
  modifiers: string[];
  notes: string | null;
  status: string;
  kotId: string | null;
}

export interface KOTResponse {
  id: string;
  orderId: string;
  kotNumber: string;
  station: string | null;
  status: string;
  createdAt: string;
}

export interface OrderResponse {
  id: string;
  outletId: string;
  organizationId: string;
  tableId: string | null;
  orderNumber: string;
  orderMode: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMode: string | null;
  waiterId: string | null;
  waiterName: string | null;
  paxCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemResponse[];
  kots: KOTResponse[];
}

export interface CreateOrderInput {
  orderMode: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "QUICK_BILL";
  tableId?: string;
  waiterId?: string;
  waiterName?: string;
  paxCount?: number;
  notes?: string;
}

export interface AddItemInput {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: string;
  modifiers?: string[];
  notes?: string;
}

export async function createOrder(
  input: CreateOrderInput
): Promise<OrderResponse> {
  const res = await request<OrderResponse>(API.ORDERS.CREATE, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function getOrder(id: string): Promise<OrderResponse> {
  const res = await request<OrderResponse>(API.ORDERS.GET(id));
  return res.data;
}

export async function listOrders(filters?: {
  status?: string;
  tableId?: string;
  waiterId?: string;
  limit?: number;
}): Promise<OrderResponse[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tableId) params.set("tableId", filters.tableId);
  if (filters?.waiterId) params.set("waiterId", filters.waiterId);
  if (filters?.limit) params.set("limit", filters.limit.toString());
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await request<OrderResponse[]>(`${API.ORDERS.LIST}${query}`);
  return res.data;
}

export async function addItemsToOrder(
  orderId: string,
  items: AddItemInput[]
): Promise<OrderResponse> {
  const res = await request<OrderResponse>(API.ORDERS.ADD_ITEMS(orderId), {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  return res.data;
}

export async function updateItemQuantity(
  orderId: string,
  itemId: string,
  quantity: number
): Promise<OrderResponse> {
  const res = await request<OrderResponse>(
    API.ORDERS.UPDATE_ITEM(orderId, itemId),
    {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    }
  );
  return res.data;
}

export async function removeOrderItem(
  orderId: string,
  itemId: string
): Promise<OrderResponse> {
  const res = await request<OrderResponse>(
    API.ORDERS.DELETE_ITEM(orderId, itemId),
    { method: "DELETE" }
  );
  return res.data;
}

export async function holdOrder(orderId: string): Promise<OrderResponse> {
  const res = await request<OrderResponse>(API.ORDERS.HOLD(orderId), {
    method: "POST",
  });
  return res.data;
}

export async function cancelOrder(orderId: string): Promise<OrderResponse> {
  const res = await request<OrderResponse>(API.ORDERS.CANCEL(orderId), {
    method: "POST",
  });
  return res.data;
}

// ─── KOT ───

export interface FireKOTResponse {
  kotId: string;
  kotNumber: string;
  orderId: string;
  station: string | null;
  itemCount: number;
}

export async function fireKOT(
  orderId: string,
  itemIds?: string[],
  station?: string
): Promise<FireKOTResponse> {
  const res = await request<FireKOTResponse>(API.KOT.FIRE(orderId), {
    method: "POST",
    body: JSON.stringify({ itemIds, station }),
  });
  return res.data;
}
