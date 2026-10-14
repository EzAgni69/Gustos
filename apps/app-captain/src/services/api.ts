/**
 * Gusto Captain — API Client
 *
 * HTTP client for communicating with pos-local-server over LAN.
 * Automatically attaches X-User-Id header from auth store.
 */

import { API } from "../config/constants";
import { enqueueOfflineAction } from "../lib/offlineQueue";

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

/**
 * Check if an error is a network error (device offline / Wi-Fi dead zone).
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("network request failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("network error") ||
      msg.includes("load failed")
    );
  }
  return false;
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
  variants: string | null;
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

export interface ReservationResponse {
  id: string;
  tableId: string;
  tableName?: string;
  customerName: string | null;
  reservationTime: string;
  durationMins: number;
}

export async function getTableReservations(tableId: string): Promise<ReservationResponse[]> {
  const res = await request<ReservationResponse[]>(`/api/tables/${tableId}/reservations`);
  return res.data;
}

export async function getAllReservations(): Promise<ReservationResponse[]> {
  const res = await request<ReservationResponse[]>("/api/tables/reservations");
  return res.data;
}

export async function createTableReservation(
  tableId: string,
  customerName: string | null,
  reservationTime: string,
  durationMins: number
): Promise<{ id: string }> {
  const res = await request<{ id: string }>(`/api/tables/${tableId}/reservations`, {
    method: "POST",
    body: JSON.stringify({ customerName, reservationTime, durationMins }),
  });
  return res.data;
}

export async function transferOrder(
  fromTableId: string,
  toTableId: string
): Promise<void> {
  await request(API.TABLES.TRANSFER, {
    method: "POST",
    body: JSON.stringify({ fromTableId, toTableId }),
  });
}

export async function updateReservation(
  reservationId: string,
  updates: {
    customerName?: string;
    reservationTime?: string;
    durationMins?: number;
    status?: string;
  }
): Promise<void> {
  await request(`/api/tables/reservations/${reservationId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function cancelReservation(reservationId: string): Promise<void> {
  await request(`/api/tables/reservations/${reservationId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "CANCELLED" }),
  });
}


// ─── Orders ───

export interface OrderItemResponse {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
  gstRate: string;
  modifiers: string[] | string;
  addOns?: string | null;
  notes: string | null;
  status: string;
  kotId: string | null;
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

export interface AddItemAddOn {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface AddItemInput {
  menuItemId: string;
  menuItemName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  gstRate: string;
  modifiers?: string[];
  addOns?: AddItemAddOn[];
  notes?: string;
}

export async function createOrder(
  input: CreateOrderInput
): Promise<OrderResponse> {
  try {
    const res = await request<OrderResponse>(API.ORDERS.CREATE, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.data;
  } catch (err) {
    if (isNetworkError(err)) {
      const localId = await enqueueOfflineAction(
        "CREATE_ORDER",
        "POST",
        API.ORDERS.CREATE,
        input as unknown as Record<string, unknown>
      );
      // Return optimistic response
      return {
        id: localId,
        orderNumber: `OFFLINE-${localId.slice(-4)}`.toUpperCase(),
        orderMode: input.orderMode,
        status: "DRAFT",
        tableId: input.tableId || null,
        paxCount: input.paxCount || 1,
        waiterName: input.waiterName || null,
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
        outletId: "OFFLINE",
        organizationId: "OFFLINE",
        paymentMode: null,
        waiterId: input.waiterId || null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [],
        kots: [],
      };
    }
    throw err;
  }
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
  try {
    const res = await request<OrderResponse>(API.ORDERS.ADD_ITEMS(orderId), {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    return res.data;
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOfflineAction(
        "ADD_ITEMS",
        "POST",
        API.ORDERS.ADD_ITEMS(orderId),
        { items }
      );
      // Fallback to getting the current order locally if possible (we just return a dummy wrapper here, actual state comes from store)
      return {
        id: orderId,
        status: "IN_PROGRESS",
      } as any;
    }
    throw err;
  }
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
  try {
    const res = await request<FireKOTResponse>(API.KOT.FIRE(orderId), {
      method: "POST",
      body: JSON.stringify({ itemIds, station }),
    });
    return res.data;
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOfflineAction("FIRE_KOT", "POST", API.KOT.FIRE(orderId), { itemIds, station });
      return { kotId: "offline-kot", kotNumber: "OFF", orderId, station: station || null, itemCount: itemIds?.length || 0 };
    }
    throw err;
  }
}

export async function holdOrder(orderId: string): Promise<OrderResponse> {
  try {
    const res = await request<OrderResponse>(API.ORDERS.HOLD(orderId), {
      method: "POST",
    });
    return res.data;
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOfflineAction("HOLD_ORDER", "POST", API.ORDERS.HOLD(orderId), {});
      return { id: orderId, status: "DRAFT" } as any;
    }
    throw err;
  }
}

export async function cancelOrder(orderId: string): Promise<OrderResponse> {
  const res = await request<OrderResponse>(API.ORDERS.CANCEL(orderId), {
    method: "POST",
  });
  return res.data;
}

export async function printBill(orderId: string): Promise<void> {
  await request(API.PRINT.BILL(orderId), {
    method: "POST",
    body: JSON.stringify({ source: "captain" }),
  });
}

// ─── KOT ───

export interface KOTItemResponse {
  id: string;
  kotId: string;
  orderItemId: string;
  menuItemName: string;
  variantName?: string | null;
  categoryId?: string | null;
  quantity: number;
  modifiers: string[];
  notes: string | null;
}

export interface KOTResponse {
  id: string;
  orderId: string;
  kotNumber: string;
  station: string | null;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED";
  createdAt: string;
  items: KOTItemResponse[];
  orderNumber: string;
  tableName?: string;
}

export async function getKOTs(status?: string): Promise<KOTResponse[]> {
  const url = status ? `${API.KOT.LIST}?status=${status}` : API.KOT.LIST;
  const res = await request<KOTResponse[]>(url);
  return res.data;
}

export async function updateKOTStatus(
  kotId: string,
  status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED"
): Promise<void> {
  await request(API.KOT.UPDATE_STATUS(kotId), {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// ─── Checkout ───

export type PaymentMode = "CASH" | "CARD" | "UPI" | "ONLINE" | "SPLIT" | "OTHER";

export interface PaymentSplitInput {
  mode: string;
  subMethod?: string;
  amount: number;
  reference?: string;
}

export interface CheckoutInput {
  paymentMode: PaymentMode;
  paymentSubMethod?: string;
  paymentSplits?: PaymentSplitInput[];
  tipAmount?: number;
  tenderedAmount?: number;
  changeDue?: number;
}

export interface CheckoutResponse {
  orderId: string;
  orderNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: number;
  tipAmount: number;
  paymentMode: string;
}

export async function checkoutOrder(
  orderId: string,
  input: CheckoutInput
): Promise<CheckoutResponse> {
  try {
    const res = await request<CheckoutResponse>(API.ORDERS.CHECKOUT(orderId), {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.data;
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOfflineAction(
        "CHECKOUT",
        "POST",
        API.ORDERS.CHECKOUT(orderId),
        input as unknown as Record<string, unknown>
      );
      return { orderId, orderNumber: "OFFLINE", invoiceId: "OFFLINE", invoiceNumber: "OFFLINE-PENDING", totalAmount: input.tenderedAmount || 0, tipAmount: input.tipAmount || 0, paymentMode: input.paymentMode };
    }
    throw err;
  }
}

export interface InvoiceResponse {
  id: string;
  orderId: string;
  invoiceNumber: string;
  subtotal: number;
  discountAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
  paymentMode: string;
  paymentSubMethod: string | null;
  paymentSplits: string | null;
  tipAmount: number;
  tenderedAmount: number | null;
  changeDue: number | null;
  isPaid: boolean;
  createdAt: string;
  order: OrderResponse | null;
  items: OrderItemResponse[];
}

export async function getInvoice(orderId: string): Promise<InvoiceResponse | null> {
  try {
    const res = await request<InvoiceResponse>(API.ORDERS.INVOICE(orderId));
    return res.data;
  } catch {
    return null;
  }
}

