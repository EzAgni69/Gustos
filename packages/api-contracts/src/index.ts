import { z } from "zod";

// ─── Tenant Hierarchy ───

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  gstNumber: z.string().optional(),
  timezone: z.string().default("Asia/Kolkata"),
  currency: z.string().default("INR"),
  notificationSettings: z.string().optional().nullable(),
  billingSettings: z.string().optional().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const franchiseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const outletSchema = z.object({
  id: z.string().uuid(),
  franchiseId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  address: z.string(),
  phone: z.string().optional(),
  gstNumber: z.string().optional(),
  fssaiLicenseNo: z.string().max(20).optional(),
  greetingMessage: z.string().max(255).optional(),
  logoImagePath: z.string().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Menu ───

export const menuCategorySchema = z.object({
  id: z.string().uuid(),
  outletId: z.string().uuid(),
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const menuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  outletId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  variants: z.string().nullable().optional(),
  price: z.number().positive(),
  gstRate: z.enum(["0", "5", "12", "18", "28"]),
  isVeg: z.boolean().default(true),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Orders ───

export const orderTypeEnum = z.enum([
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
  "ONLINE",
]);

export const orderStatusEnum = z.enum([
  "DRAFT",
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
]);

export const paymentModeEnum = z.enum([
  "CASH",
  "CARD",
  "UPI",
  "ONLINE",
  "SPLIT",
  "OTHER",
]);

export const paymentSubMethodEnum = z.enum([
  "PHONEPE",
  "GPAY",
  "PAYTM",
  "RAZORPAY",
  "OTHER",
]);

export const receiptStatusEnum = z.enum([
  "ORIGINAL",
  "DUPLICATE",
  "TRIPLICATE",
]);

// ─── Split Payment ───

/**
 * A single leg of a split payment.
 * e.g., ₹3000 via UPI (PhonePe) + ₹4310 via Cash = ₹7310 total
 */
export const paymentSplitEntrySchema = z.object({
  /** Payment mode for this leg */
  mode: paymentModeEnum.exclude(["SPLIT"]),
  /** Sub-method detail (e.g., PHONEPE under UPI) */
  subMethod: paymentSubMethodEnum.optional(),
  /** Amount paid via this leg */
  amount: z.number().positive("Split amount must be positive"),
  /** Optional reference/transaction ID */
  reference: z.string().optional(),
});

export const orderItemAddOnSchema = z.object({
  name: z.string(),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().default(0),
  amount: z.number().default(0),
});

export const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  menuItemName: z.string(),
  variantName: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  gstRate: z.string(),
  modifiers: z.array(z.string()).default([]),
  notes: z.string().optional(),
  addOns: z.array(orderItemAddOnSchema).default([]),
  status: orderStatusEnum.default("PLACED"),
});

export const orderSchema = z.object({
  id: z.string().uuid(),
  outletId: z.string().uuid(),
  tableId: z.string().uuid().optional(),
  orderNumber: z.string(),
  orderType: orderTypeEnum.default("DINE_IN"),
  status: orderStatusEnum.default("DRAFT"),
  items: z.array(orderItemSchema).default([]),
  subtotal: z.number().default(0),
  discountAmount: z.number().default(0),
  taxAmount: z.number().default(0),
  totalAmount: z.number().default(0),
  paymentMode: paymentModeEnum.optional(),
  paymentSubMethod: paymentSubMethodEnum.optional(),
  /** Split payment breakdown — required when paymentMode is SPLIT */
  paymentSplits: z.array(paymentSplitEntrySchema).default([]),
  customerId: z.string().uuid().optional(),
  customerName: z.string().optional(),
  waiterId: z.string().uuid().optional(),
  cashierId: z.string().uuid().optional(),
  cashierName: z.string().optional(),
  tokenNumbers: z.array(z.number().int()).default([]),
  notes: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── KOT ───

export const kotStatusEnum = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "READY",
  "SERVED",
]);

export const kotSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  kotNumber: z.string(),
  items: z.array(
    z.object({
      menuItemName: z.string(),
      quantity: z.number().int().positive(),
      modifiers: z.array(z.string()).default([]),
      notes: z.string().optional(),
    })
  ),
  station: z.string().optional(),
  status: kotStatusEnum.default("PENDING"),
  createdAt: z.coerce.date(),
});

// ─── Invoice ───

export const invoiceSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  outletId: z.string().uuid(),
  invoiceNumber: z.string(),
  receiptStatus: receiptStatusEnum.default("ORIGINAL"),
  subtotal: z.number(),
  discountAmount: z.number().default(0),
  cgstRate: z.number().default(2.5),
  cgstAmount: z.number().default(0),
  sgstRate: z.number().default(2.5),
  sgstAmount: z.number().default(0),
  totalQuantity: z.number().int().default(0),
  totalAmount: z.number(),
  paymentMode: paymentModeEnum,
  paymentSubMethod: paymentSubMethodEnum.optional(),
  /** Split payment breakdown — populated when paymentMode is SPLIT */
  paymentSplits: z.array(paymentSplitEntrySchema).default([]),
  isPaid: z.boolean().default(false),
  createdAt: z.coerce.date(),
});

// ─── Dining Table ───

export const tableStatusEnum = z.enum([
  "AVAILABLE",
  "OCCUPIED",
  "RESERVED",
  "CLEANING",
]);

export const diningTableSchema = z.object({
  id: z.string().uuid(),
  outletId: z.string().uuid(),
  name: z.string().min(1),
  capacity: z.number().int().positive(),
  status: tableStatusEnum.default("AVAILABLE"),
  section: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export const reservationStatusEnum = z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]);

export const tableReservationSchema = z.object({
  id: z.string().uuid(),
  outletId: z.string().uuid(),
  tableId: z.string().uuid(),
  customerName: z.string().optional().nullable(),
  reservationTime: z.coerce.date(),
  durationMins: z.number().int().positive().default(60),
  status: reservationStatusEnum.default("ACTIVE"),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Auth / User ───

export const userRoleEnum = z.enum([
  "SUPER_ADMIN",
  "OWNER",
  "MANAGER",
  "CASHIER",
  "WAITER",
  "CHEF",
]);

export const userSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  outletId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  pin: z.string().length(4).optional(),
  role: userRoleEnum,
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Customer ───

export const customerSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  phone: z.string(),
  email: z.string().email().optional(),
  notes: z.string().optional(),
  loyaltyPoints: z.number().int().default(0),
  totalVisits: z.number().int().default(0),
  totalSpend: z.number().default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ═══════════════════════════════════════════════
// ─── API Operation Schemas (Create / Update / Query) ───
// ═══════════════════════════════════════════════

// ─── Auth Schemas ───

export const loginRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerRequestSchema = z.object({
  // Organization details
  organizationName: z.string().min(1).max(255),
  organizationSlug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must be lowercase alphanumeric with hyphens only"
    ),
  gstNumber: z.string().max(20).optional(),
  // Owner user details
  name: z.string().min(1).max(255),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().max(20).optional(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: userSchema.omit({ pin: true }),
});

// ─── Pagination & Query ───

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// ─── Create Schemas ───

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens only"),
  gstNumber: z.string().max(20).optional(),
});

export const createFranchiseSchema = z.object({
  name: z.string().min(1).max(255),
});

export const createOutletSchema = z.object({
  franchiseId: z.string().uuid("Invalid franchise ID"),
  name: z.string().min(1).max(255),
  address: z.string().min(1, "Address is required"),
  phone: z.string().max(20).optional(),
  gstNumber: z.string().max(20).optional(),
  fssaiLicenseNo: z.string().max(20).optional(),
  greetingMessage: z.string().max(255).optional(),
  logoImagePath: z.string().optional(),
});

export const createUserSchema = z.object({
  outletId: z.string().uuid("Invalid outlet ID").optional(),
  name: z.string().min(1).max(255),
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().max(20).optional(),
  password: z.string().min(6).optional(),
  pin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be 4 digits")
    .optional(),
  role: userRoleEnum,
});

export const createMenuCategorySchema = z.object({
  outletId: z.string().uuid("Invalid outlet ID"),
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().default(0),
});

export const createMenuItemSchema = z.object({
  categoryId: z.string().uuid("Invalid category ID"),
  outletId: z.string().uuid("Invalid outlet ID"),
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  variants: z.string().nullable().optional(),
  price: z.number().positive("Price must be positive"),
  gstRate: z.enum(["0", "5", "12", "18", "28"]).default("5"),
  isVeg: z.boolean().default(true),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const createDiningTableSchema = z.object({
  outletId: z.string().uuid("Invalid outlet ID"),
  name: z.string().min(1).max(50),
  capacity: z.number().int().positive("Capacity must be positive"),
  section: z.string().max(100).optional(),
  sortOrder: z.number().int().default(0),
});

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(1).max(20),
  email: z.string().email().optional(),
  notes: z.string().optional(),
});

export const createTableReservationSchema = z.object({
  tableId: z.string().uuid("Invalid table ID"),
  customerName: z.string().optional().nullable(),
  reservationTime: z.coerce.date(),
  durationMins: z.number().int().positive().default(60),
});

// ─── Update Schemas ───

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  gstNumber: z.string().max(20).optional().nullable(),
  timezone: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
  notificationSettings: z.string().optional().nullable(),
  billingSettings: z.string().optional().nullable(),
});

export const updateFranchiseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export const updateOutletSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().optional(),
  phone: z.string().max(20).optional().nullable(),
  gstNumber: z.string().max(20).optional().nullable(),
  fssaiLicenseNo: z.string().max(20).optional().nullable(),
  greetingMessage: z.string().max(255).optional().nullable(),
  logoImagePath: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  outletId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  password: z.string().min(6).optional(),
  pin: z
    .string()
    .length(4)
    .regex(/^\d{4}$/)
    .optional()
    .nullable(),
  role: userRoleEnum.optional(),
  isActive: z.boolean().optional(),
});

export const updateMenuCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateMenuItemSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  variants: z.string().optional().nullable(),
  price: z.number().positive().optional(),
  gstRate: z.enum(["0", "5", "12", "18", "28"]).optional(),
  isVeg: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateDiningTableSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  capacity: z.number().int().positive().optional(),
  section: z.string().max(100).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export const updateTableStatusSchema = z.object({
  status: tableStatusEnum,
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateTableReservationSchema = z.object({
  customerName: z.string().optional().nullable(),
  reservationTime: z.coerce.date().optional(),
  durationMins: z.number().int().positive().optional(),
  status: reservationStatusEnum.optional(),
});


// ─── Query / Filter Schemas ───

export const listMenuItemsQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid("outletId is required"),
  categoryId: z.string().uuid().optional(),
  isVeg: z.coerce.boolean().optional(),
  isAvailable: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export const listMenuCategoriesQuerySchema = z.object({
  outletId: z.string().uuid("outletId is required"),
});

export const listTablesQuerySchema = z.object({
  outletId: z.string().uuid("outletId is required"),
  status: tableStatusEnum.optional(),
});

export const listUsersQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid().optional(),
  role: userRoleEnum.optional(),
  isActive: z.coerce.boolean().optional(),
});

export const listOutletsQuerySchema = paginationSchema.extend({
  franchiseId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const listCustomersQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
});

// ─── Standard API Response Wrappers ───

export function apiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: dataSchema,
    message: z.string().optional(),
  });
}

export function paginatedResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T
) {
  return z.object({
    success: z.boolean(),
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
    message: z.string().optional(),
  });
}

// ─── Type Exports ───

export type Organization = z.infer<typeof organizationSchema>;
export type Franchise = z.infer<typeof franchiseSchema>;
export type Outlet = z.infer<typeof outletSchema>;
export type MenuCategory = z.infer<typeof menuCategorySchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type OrderItemAddOn = z.infer<typeof orderItemAddOnSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type KOT = z.infer<typeof kotSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type DiningTable = z.infer<typeof diningTableSchema>;
export type User = z.infer<typeof userSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type TableReservation = z.infer<typeof tableReservationSchema>;
export type OrderType = z.infer<typeof orderTypeEnum>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
export type PaymentMode = z.infer<typeof paymentModeEnum>;
export type PaymentSubMethod = z.infer<typeof paymentSubMethodEnum>;
export type ReceiptStatus = z.infer<typeof receiptStatusEnum>;
export type PaymentSplitEntry = z.infer<typeof paymentSplitEntrySchema>;
export type KOTStatus = z.infer<typeof kotStatusEnum>;
export type TableStatus = z.infer<typeof tableStatusEnum>;
export type ReservationStatus = z.infer<typeof reservationStatusEnum>;
export type UserRole = z.infer<typeof userRoleEnum>;

// API Operation Types
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type CreateOrganization = z.infer<typeof createOrganizationSchema>;
export type CreateFranchise = z.infer<typeof createFranchiseSchema>;
export type CreateOutlet = z.infer<typeof createOutletSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type CreateMenuCategory = z.infer<typeof createMenuCategorySchema>;
export type CreateMenuItem = z.infer<typeof createMenuItemSchema>;
export type CreateDiningTable = z.infer<typeof createDiningTableSchema>;
export type CreateTableReservation = z.infer<typeof createTableReservationSchema>;
export type CreateCustomer = z.infer<typeof createCustomerSchema>;
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;
export type UpdateFranchise = z.infer<typeof updateFranchiseSchema>;
export type UpdateOutlet = z.infer<typeof updateOutletSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type UpdateMenuCategory = z.infer<typeof updateMenuCategorySchema>;
export type UpdateMenuItem = z.infer<typeof updateMenuItemSchema>;
export type UpdateDiningTable = z.infer<typeof updateDiningTableSchema>;
export type UpdateTableStatus = z.infer<typeof updateTableStatusSchema>;
export type UpdateTableReservation = z.infer<typeof updateTableReservationSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;

// ─── Inventory ───

export const inventoryItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  unit: z.string().max(50),
  currentStock: z.number().default(0),
  minimumStock: z.number().default(0),
  costPerUnit: z.number().default(0),
  expiryDate: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createInventoryItemSchema = z.object({
  name: z.string().min(1).max(255),
  unit: z.string().max(50),
  currentStock: z.number().default(0),
  minimumStock: z.number().default(0),
  costPerUnit: z.number().default(0),
  expiryDate: z.coerce.date().nullable().optional(),
});

export const updateInventoryItemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  unit: z.string().max(50).optional(),
  currentStock: z.number().optional(),
  minimumStock: z.number().optional(),
  costPerUnit: z.number().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
});

export const listInventoryQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
});

export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type CreateInventoryItem = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItem = z.infer<typeof updateInventoryItemSchema>;

// ─── Recipes ───

export const recipeIngredientSchema = z.object({
  id: z.string().uuid(),
  recipeId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  inventoryItemName: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string(),
});

export const recipeSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  menuItemName: z.string().optional(),
  createdAt: z.coerce.date(),
  ingredients: z.array(recipeIngredientSchema).default([]),
});

export const createRecipeSchema = z.object({
  menuItemId: z.string().uuid(),
  ingredients: z.array(
    z.object({
      inventoryItemId: z.string().uuid(),
      quantity: z.number().positive(),
      unit: z.string(),
    })
  ).min(1, "At least one ingredient is required"),
});

export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type CreateRecipe = z.infer<typeof createRecipeSchema>;

// ─── Stock Transactions ───

export const stockTransactionTypeEnum = z.enum([
  "ORDER_DEDUCTION",
  "MANUAL_ADD",
  "MANUAL_REMOVE",
  "PURCHASE_ORDER",
  "ADJUSTMENT",
]);

export const stockTransactionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  inventoryItemName: z.string().optional(),
  orderId: z.string().uuid().optional().nullable(),
  type: stockTransactionTypeEnum,
  quantityChange: z.number(),
  balanceAfter: z.number(),
  notes: z.string().optional().nullable(),
  createdAt: z.coerce.date(),
});

export const listStockTransactionsQuerySchema = paginationSchema.extend({
  inventoryItemId: z.string().uuid().optional(),
  type: stockTransactionTypeEnum.optional(),
});

export type StockTransaction = z.infer<typeof stockTransactionSchema>;
export type StockTransactionType = z.infer<typeof stockTransactionTypeEnum>;

// ─── Orders ───

export const createOrderSchema = z.object({
  outletId: z.string().uuid(),
  tableId: z.string().uuid().optional(),
  orderType: orderTypeEnum.default("DINE_IN"),
  status: orderStatusEnum.default("DRAFT"),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    variantName: z.string().optional(),
    notes: z.string().optional(),
    modifiers: z.array(z.string()).default([]),
    addOns: z.array(orderItemAddOnSchema).default([]),
  })).default([]),
  paymentMode: paymentModeEnum.optional(),
  paymentSubMethod: paymentSubMethodEnum.optional(),
  paymentSplits: z.array(paymentSplitEntrySchema).default([]),
  customerId: z.string().uuid().optional(),
  customerName: z.string().optional(),
  waiterId: z.string().uuid().optional(),
  cashierId: z.string().uuid().optional(),
  cashierName: z.string().optional(),
  tokenNumbers: z.array(z.number().int()).default([]),
  notes: z.string().optional(),
});

export const updateOrderSchema = z.object({
  tableId: z.string().uuid().optional().nullable(),
  orderType: orderTypeEnum.optional(),
  status: orderStatusEnum.optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    variantName: z.string().optional(),
    notes: z.string().optional(),
    modifiers: z.array(z.string()).default([]),
    addOns: z.array(orderItemAddOnSchema).default([]),
  })).optional(),
  paymentMode: paymentModeEnum.optional().nullable(),
  paymentSubMethod: paymentSubMethodEnum.optional().nullable(),
  paymentSplits: z.array(paymentSplitEntrySchema).optional(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().optional().nullable(),
  waiterId: z.string().uuid().optional().nullable(),
  cashierId: z.string().uuid().optional().nullable(),
  cashierName: z.string().optional().nullable(),
  tokenNumbers: z.array(z.number().int()).optional(),
  notes: z.string().optional().nullable(),
});

export const listOrdersQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid("outletId is required"),
  status: orderStatusEnum.optional(),
  search: z.string().optional(),
});

export type CreateOrder = z.infer<typeof createOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;

// ─── Integration (Zomato) ───

export const integrationProviderEnum = z.enum([
  "ZOMATO",
  "SWIGGY",
  "RAZORPAY",
]);

export const integrationConfigSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  outletId: z.string().uuid(),
  provider: integrationProviderEnum,
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  webhookSecret: z.string().optional(),
  restaurantId: z.string().optional(),
  isActive: z.boolean().default(false),
  config: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createIntegrationConfigSchema = z.object({
  outletId: z.string().uuid("Invalid outlet ID"),
  provider: integrationProviderEnum,
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  webhookSecret: z.string().optional(),
  restaurantId: z.string().max(100).optional(),
  isActive: z.boolean().default(false),
  config: z.string().optional(),
});

export const updateIntegrationConfigSchema = z.object({
  apiKey: z.string().optional().nullable(),
  apiSecret: z.string().optional().nullable(),
  webhookSecret: z.string().optional().nullable(),
  restaurantId: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
  config: z.string().optional().nullable(),
});

export const listIntegrationConfigsQuerySchema = z.object({
  outletId: z.string().uuid().optional(),
  provider: integrationProviderEnum.optional(),
});

// Zomato Webhook Payload — models a typical Zomato order push
export const zomatoWebhookOrderSchema = z.object({
  order_id: z.string(),
  restaurant_id: z.string(),
  status: z.string(),
  customer: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }).optional(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().int().positive(),
    price: z.number(),
    instructions: z.string().optional(),
  })),
  subtotal: z.number(),
  total: z.number(),
  commission: z.number().optional(),
});

export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;
export type CreateIntegrationConfig = z.infer<typeof createIntegrationConfigSchema>;
export type UpdateIntegrationConfig = z.infer<typeof updateIntegrationConfigSchema>;
export type IntegrationProvider = z.infer<typeof integrationProviderEnum>;
export type ZomatoWebhookOrder = z.infer<typeof zomatoWebhookOrderSchema>;

// ─── Online Orders ───

export const onlineOrderStatusEnum = z.enum([
  "RECEIVED",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "DELIVERED",
  "CANCELLED",
  "REJECTED",
]);

export const onlineOrderSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  outletId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  provider: integrationProviderEnum,
  externalOrderId: z.string(),
  status: onlineOrderStatusEnum.default("RECEIVED"),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  deliveryAddress: z.string().optional(),
  subtotal: z.number().default(0),
  totalAmount: z.number().default(0),
  commissionAmount: z.number().default(0),
  receivedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const listOnlineOrdersQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid("outletId is required"),
  provider: integrationProviderEnum.optional(),
  status: onlineOrderStatusEnum.optional(),
});

export const updateOnlineOrderStatusSchema = z.object({
  status: onlineOrderStatusEnum,
});

export type OnlineOrder = z.infer<typeof onlineOrderSchema>;
export type OnlineOrderStatus = z.infer<typeof onlineOrderStatusEnum>;

// ─── CRM: Feedback ───

export const feedbackSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  outletId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  source: z.string().default("IN_APP"),
  createdAt: z.coerce.date(),
});

export const createFeedbackSchema = z.object({
  customerId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  outletId: z.string().uuid().optional(),
  rating: z.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
  comment: z.string().optional(),
  source: z.enum(["IN_APP", "WHATSAPP", "SMS"]).default("IN_APP"),
});

export const listFeedbacksQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
});

export type Feedback = z.infer<typeof feedbackSchema>;
export type CreateFeedback = z.infer<typeof createFeedbackSchema>;

// ─── CRM: Coupons ───

export const couponTypeEnum = z.enum(["PERCENTAGE", "FLAT"]);

export const couponSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  code: z.string(),
  description: z.string().optional(),
  type: couponTypeEnum,
  value: z.number().positive(),
  minOrderAmount: z.number().optional(),
  maxDiscountAmount: z.number().optional(),
  usageLimit: z.number().int().optional(),
  usedCount: z.number().int().default(0),
  outletIds: z.string().optional(), // JSON
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createCouponSchema = z.object({
  code: z.string().min(1).max(50).transform(val => val.toUpperCase()),
  description: z.string().optional(),
  type: couponTypeEnum,
  value: z.number().positive("Value must be positive"),
  minOrderAmount: z.number().min(0).optional(),
  maxDiscountAmount: z.number().min(0).optional(),
  usageLimit: z.number().int().positive().optional(),
  outletIds: z.array(z.string().uuid()).optional(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  isActive: z.boolean().default(true),
});

export const updateCouponSchema = z.object({
  description: z.string().optional().nullable(),
  value: z.number().positive().optional(),
  minOrderAmount: z.number().min(0).optional().nullable(),
  maxDiscountAmount: z.number().min(0).optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  outletIds: z.array(z.string().uuid()).optional(),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});

export const validateCouponSchema = z.object({
  code: z.string().min(1).transform(val => val.toUpperCase()),
  outletId: z.string().uuid(),
  orderAmount: z.number().positive(),
});

export const listCouponsQuerySchema = paginationSchema.extend({
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export type Coupon = z.infer<typeof couponSchema>;
export type CreateCoupon = z.infer<typeof createCouponSchema>;
export type UpdateCoupon = z.infer<typeof updateCouponSchema>;
export type ValidateCoupon = z.infer<typeof validateCouponSchema>;
export type CouponType = z.infer<typeof couponTypeEnum>;

// ─── CRM: Loyalty ───

export const loyaltyTransactionTypeEnum = z.enum([
  "EARN",
  "REDEEM",
  "ADJUST",
  "EXPIRE",
]);

export const loyaltyTransactionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  customerId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  type: loyaltyTransactionTypeEnum,
  points: z.number().int(),
  balanceAfter: z.number().int(),
  description: z.string().optional(),
  createdAt: z.coerce.date(),
});

export const earnLoyaltySchema = z.object({
  customerId: z.string().uuid(),
  orderId: z.string().uuid(),
  orderAmount: z.number().positive(),
});

export const redeemLoyaltySchema = z.object({
  customerId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  points: z.number().int().positive("Points must be positive"),
});

export const adjustLoyaltySchema = z.object({
  customerId: z.string().uuid(),
  points: z.number().int(), // positive or negative
  description: z.string().min(1, "Adjustment reason is required"),
});

export const listLoyaltyTransactionsQuerySchema = paginationSchema.extend({
  customerId: z.string().uuid("customerId is required"),
  type: loyaltyTransactionTypeEnum.optional(),
});

export type LoyaltyTransaction = z.infer<typeof loyaltyTransactionSchema>;
export type EarnLoyalty = z.infer<typeof earnLoyaltySchema>;
export type RedeemLoyalty = z.infer<typeof redeemLoyaltySchema>;
export type AdjustLoyalty = z.infer<typeof adjustLoyaltySchema>;
export type LoyaltyTransactionType = z.infer<typeof loyaltyTransactionTypeEnum>;

// ─── HR: Shifts ───

export const shiftSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  outletId: z.string().uuid(),
  name: z.string(),
  startTime: z.string(), // HH:mm
  endTime: z.string(), // HH:mm
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createShiftSchema = z.object({
  outletId: z.string().uuid("Invalid outlet ID"),
  name: z.string().min(1).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
  isActive: z.boolean().default(true),
});

export const updateShiftSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  isActive: z.boolean().optional(),
});

export const listShiftsQuerySchema = z.object({
  outletId: z.string().uuid("outletId is required"),
});

export type Shift = z.infer<typeof shiftSchema>;
export type CreateShift = z.infer<typeof createShiftSchema>;
export type UpdateShift = z.infer<typeof updateShiftSchema>;

// ─── HR: Attendance ───

export const attendanceStatusEnum = z.enum([
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "LEAVE",
]);

export const attendanceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  outletId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  date: z.string(), // YYYY-MM-DD
  status: attendanceStatusEnum.default("PRESENT"),
  clockIn: z.coerce.date().optional(),
  clockOut: z.coerce.date().optional(),
  hoursWorked: z.number().optional(),
  overtimeHours: z.number().default(0),
  notes: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createAttendanceSchema = z.object({
  userId: z.string().uuid(),
  outletId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  status: attendanceStatusEnum.default("PRESENT"),
  clockIn: z.coerce.date().optional(),
  clockOut: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const updateAttendanceSchema = z.object({
  status: attendanceStatusEnum.optional(),
  clockIn: z.coerce.date().optional().nullable(),
  clockOut: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const clockInSchema = z.object({
  userId: z.string().uuid(),
  outletId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
});

export const clockOutSchema = z.object({
  attendanceId: z.string().uuid(),
});

export const listAttendanceQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid("outletId is required"),
  userId: z.string().uuid().optional(),
  date: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), // YYYY-MM
  status: attendanceStatusEnum.optional(),
});

export type Attendance = z.infer<typeof attendanceSchema>;
export type CreateAttendance = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendance = z.infer<typeof updateAttendanceSchema>;
export type AttendanceStatus = z.infer<typeof attendanceStatusEnum>;

// ─── HR: Payroll ───

export const payrollStatusEnum = z.enum([
  "DRAFT",
  "CALCULATED",
  "APPROVED",
  "PAID",
]);

export const payrollSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  outletId: z.string().uuid(),
  month: z.string(), // "2026-07"
  baseSalary: z.number(),
  daysWorked: z.number().int(),
  totalDays: z.number().int(),
  overtimeHours: z.number().default(0),
  overtimeRate: z.number().default(0),
  deductions: z.number().default(0),
  bonus: z.number().default(0),
  netSalary: z.number(),
  status: payrollStatusEnum.default("DRAFT"),
  paidAt: z.coerce.date().optional(),
  notes: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const generatePayrollSchema = z.object({
  outletId: z.string().uuid("Invalid outlet ID"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM format"),
  userId: z.string().uuid().optional(), // optional: generate for single user
});

export const updatePayrollSchema = z.object({
  baseSalary: z.number().positive().optional(),
  deductions: z.number().min(0).optional(),
  bonus: z.number().min(0).optional(),
  overtimeRate: z.number().min(0).optional(),
  status: payrollStatusEnum.optional(),
  notes: z.string().optional().nullable(),
});

export const listPayrollsQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: payrollStatusEnum.optional(),
});

export type Payroll = z.infer<typeof payrollSchema>;
export type GeneratePayroll = z.infer<typeof generatePayrollSchema>;
export type UpdatePayroll = z.infer<typeof updatePayrollSchema>;
export type PayrollStatus = z.infer<typeof payrollStatusEnum>;

// ─── Reporting ───

export const salesReportQuerySchema = z.object({
  outletId: z.string().uuid("outletId is required"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  groupBy: z.enum(["day", "week", "month"]).default("day"),
});

export const inventoryReportQuerySchema = z.object({
  outletId: z.string().uuid().optional(),
  lowStockOnly: z.coerce.boolean().default(false),
});

export const profitabilityReportQuerySchema = z.object({
  outletId: z.string().uuid("outletId is required"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>;
export type ProfitabilityReportQuery = z.infer<typeof profitabilityReportQuerySchema>;

// ─── ERP: Vendors & PO ───

export const vendorSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  contactName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const purchaseOrderStatusEnum = z.enum([
  "DRAFT",
  "SENT",
  "PARTIAL",
  "FULFILLED",
  "CANCELLED",
]);

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  outletId: z.string().uuid(),
  vendorId: z.string().uuid(),
  poNumber: z.string(),
  status: purchaseOrderStatusEnum.default("DRAFT"),
  totalAmount: z.number().default(0),
  expectedDeliveryDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const purchaseOrderItemSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  quantity: z.number(),
  unitPrice: z.number(),
  totalPrice: z.number(),
});

export const goodsReceivedNoteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  outletId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional().nullable(),
  grnNumber: z.string(),
  receivedDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
  createdAt: z.coerce.date(),
});

export const grnItemSchema = z.object({
  id: z.string().uuid(),
  grnId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  receivedQuantity: z.number(),
  unitPrice: z.number(),
  totalPrice: z.number(),
});

export type Vendor = z.infer<typeof vendorSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderItem = z.infer<typeof purchaseOrderItemSchema>;
export type GoodsReceivedNote = z.infer<typeof goodsReceivedNoteSchema>;
export type GRNItem = z.infer<typeof grnItemSchema>;

// ─── Compliance / Tax Rules ───

export const taxRuleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  type: z.string(), // "GST", "VAT", "SERVICE_CHARGE"
  percentage: z.number(),
  isCgstSgstSplit: z.boolean().default(false),
  zone: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createTaxRuleSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["GST", "VAT", "SERVICE_CHARGE"]),
  percentage: z.number().min(0).max(100),
  isCgstSgstSplit: z.boolean().default(false),
  zone: z.string().max(100).optional(),
  isActive: z.boolean().default(true),
});

export type TaxRule = z.infer<typeof taxRuleSchema>;
export type CreateTaxRule = z.infer<typeof createTaxRuleSchema>;

// ─── Role Permissions ───

export const rolePermissionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  role: userRoleEnum,
  permissions: z.string(), // JSON string
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type RolePermission = z.infer<typeof rolePermissionSchema>;

// ─── Pos Heartbeats ───

export const posHeartbeatSchema = z.object({
  id: z.string().uuid(),
  outletId: z.string().uuid(),
  lastSeen: z.coerce.date(),
  latencyMs: z.number(),
  status: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type PosHeartbeat = z.infer<typeof posHeartbeatSchema>;
