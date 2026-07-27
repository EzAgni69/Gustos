import { z } from "zod";

// ─── Tenant Hierarchy ───

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  gstNumber: z.string().optional(),
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
  description: z.string().optional(),
  price: z.number().positive(),
  gstRate: z.enum(["0", "5", "12", "18", "28"]),
  isVeg: z.boolean().default(true),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Orders ───

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
]);

export const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  menuItemName: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  gstRate: z.string(),
  modifiers: z.array(z.string()).default([]),
  notes: z.string().optional(),
  status: orderStatusEnum.default("PLACED"),
});

export const orderSchema = z.object({
  id: z.string().uuid(),
  outletId: z.string().uuid(),
  tableId: z.string().uuid().optional(),
  orderNumber: z.string(),
  status: orderStatusEnum.default("DRAFT"),
  items: z.array(orderItemSchema).default([]),
  subtotal: z.number().default(0),
  discountAmount: z.number().default(0),
  taxAmount: z.number().default(0),
  totalAmount: z.number().default(0),
  paymentMode: paymentModeEnum.optional(),
  customerId: z.string().uuid().optional(),
  waiterId: z.string().uuid().optional(),
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
  subtotal: z.number(),
  discountAmount: z.number().default(0),
  cgstAmount: z.number().default(0),
  sgstAmount: z.number().default(0),
  totalAmount: z.number(),
  paymentMode: paymentModeEnum,
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
  description: z.string().optional(),
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

// ─── Update Schemas ───

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  gstNumber: z.string().max(20).optional().nullable(),
});

export const updateFranchiseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export const updateOutletSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().optional(),
  phone: z.string().max(20).optional().nullable(),
  gstNumber: z.string().max(20).optional().nullable(),
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
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type KOT = z.infer<typeof kotSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type DiningTable = z.infer<typeof diningTableSchema>;
export type User = z.infer<typeof userSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
export type PaymentMode = z.infer<typeof paymentModeEnum>;
export type KOTStatus = z.infer<typeof kotStatusEnum>;
export type TableStatus = z.infer<typeof tableStatusEnum>;
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
export type CreateCustomer = z.infer<typeof createCustomerSchema>;
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;
export type UpdateFranchise = z.infer<typeof updateFranchiseSchema>;
export type UpdateOutlet = z.infer<typeof updateOutletSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type UpdateMenuCategory = z.infer<typeof updateMenuCategorySchema>;
export type UpdateMenuItem = z.infer<typeof updateMenuItemSchema>;
export type UpdateDiningTable = z.infer<typeof updateDiningTableSchema>;
export type UpdateTableStatus = z.infer<typeof updateTableStatusSchema>;
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

// ─── Orders ───

export const createOrderSchema = z.object({
  outletId: z.string().uuid(),
  tableId: z.string().uuid().optional(),
  status: orderStatusEnum.default("DRAFT"),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    notes: z.string().optional(),
    modifiers: z.array(z.string()).default([]),
  })).default([]),
  paymentMode: paymentModeEnum.optional(),
  customerId: z.string().uuid().optional(),
  waiterId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const updateOrderSchema = z.object({
  tableId: z.string().uuid().optional().nullable(),
  status: orderStatusEnum.optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    notes: z.string().optional(),
    modifiers: z.array(z.string()).default([]),
  })).optional(),
  paymentMode: paymentModeEnum.optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  waiterId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const listOrdersQuerySchema = paginationSchema.extend({
  outletId: z.string().uuid("outletId is required"),
  status: orderStatusEnum.optional(),
  search: z.string().optional(),
});

export type CreateOrder = z.infer<typeof createOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;

