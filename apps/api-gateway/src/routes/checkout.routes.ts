/**
 * Gusto Cloud API Gateway — Checkout Routes
 *
 * Payment processing, invoice generation, and order completion
 * for the cloud-only MVP.
 *
 * POST /api/v1/orders/:orderId/checkout   — Process payment & complete order
 * GET  /api/v1/orders/:orderId/invoice    — Get invoice data
 */

import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import {
  calculateCartTotals,
  calculateGST,
  type CartItem,
  type DiscountConfig,
  type GSTRate,
} from "@gusto/core-logic";
import { getNextInvoiceNumber } from "../services/sequence.service.js";
import {
  emitOrderUpdated,
  emitTableStatusChanged,
} from "../socket/events.js";

export async function checkoutRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── Process Checkout ───
  fastify.post(
    "/api/v1/orders/:orderId/checkout",
    { preHandler: [requireMinRole("CASHIER")] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const orgId = getOrganizationId(request);
      const body = request.body as {
        paymentMode: "CASH" | "CARD" | "UPI" | "ONLINE" | "SPLIT";
        splitDetails?: { mode: string; amount: number }[];
      };

      // Get order with items
      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, orgId)
        ),
        with: { items: true },
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      if (order.status === "COMPLETED" || order.status === "CANCELLED") {
        return reply
          .status(400)
          .send(error(`Order is already ${order.status.toLowerCase()}`));
      }

      if (order.items.length === 0) {
        return reply.status(400).send(error("Cannot checkout an empty order"));
      }

      // Calculate final totals using shared core-logic
      const cartItems: CartItem[] = order.items.map((item) => ({
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        gstRate: item.gstRate as GSTRate,
        modifiers: item.modifiers
          ? JSON.parse(item.modifiers as string)
          : undefined,
      }));

      let discount: DiscountConfig | undefined;
      if (order.discountType && order.discountValue) {
        discount = {
          type: order.discountType as "PERCENTAGE" | "FLAT",
          value: Number(order.discountValue),
        };
      }

      const totals = calculateCartTotals(cartItems, discount);

      // Calculate CGST and SGST breakdown
      let totalCGST = 0;
      let totalSGST = 0;
      for (const tb of totals.taxBreakdown) {
        totalCGST += tb.cgst;
        totalSGST += tb.sgst;
      }

      // Generate invoice
      const invoiceNumber = await getNextInvoiceNumber(order.outletId);

      await db.insert(schema.invoices).values({
        orderId,
        outletId: order.outletId,
        invoiceNumber,
        subtotal: String(totals.subtotal),
        discountAmount: String(totals.discountAmount),
        cgstAmount: String(totalCGST),
        sgstAmount: String(totalSGST),
        totalAmount: String(totals.grandTotal),
        paymentMode: body.paymentMode,
        isPaid: true,
      });

      // Update order to COMPLETED
      await db
        .update(schema.orders)
        .set({
          status: "COMPLETED",
          paymentMode: body.paymentMode,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxAmount: String(totals.totalTax),
          totalAmount: String(totals.grandTotal),
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      // Release table if dine-in
      if (order.tableId) {
        await db
          .update(schema.diningTables)
          .set({ status: "AVAILABLE" })
          .where(eq(schema.diningTables.id, order.tableId));

        emitTableStatusChanged(order.outletId, {
          tableId: order.tableId,
          status: "AVAILABLE",
        });
      }

      // Emit socket event
      emitOrderUpdated(order.outletId, {
        type: "ORDER_COMPLETED",
        orderId,
        orderNumber: order.orderNumber,
      });

      console.log(
        `🧾 CHECKOUT — ${invoiceNumber} (Order: ${order.orderNumber}) — ₹${totals.grandTotal}`
      );

      return reply.send(
        success(
          {
            orderId,
            orderNumber: order.orderNumber,
            invoiceNumber,
            totals: {
              subtotal: totals.subtotal,
              discountAmount: totals.discountAmount,
              cgst: totalCGST,
              sgst: totalSGST,
              totalTax: totals.totalTax,
              grandTotal: totals.grandTotal,
            },
            paymentMode: body.paymentMode,
          },
          "Order completed"
        )
      );
    }
  );

  // ─── Get Invoice ───
  fastify.get(
    "/api/v1/orders/:orderId/invoice",
    { preHandler: [requireMinRole("CASHIER")] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const orgId = getOrganizationId(request);

      // Verify the order belongs to this org
      const order = await db.query.orders.findFirst({
        where: and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.organizationId, orgId)
        ),
        with: { items: true, table: true },
      });

      if (!order) {
        return reply.status(404).send(error("Order not found"));
      }

      const invoice = await db.query.invoices.findFirst({
        where: eq(schema.invoices.orderId, orderId),
      });

      if (!invoice) {
        return reply.status(404).send(error("Invoice not found for this order"));
      }

      return reply.send(
        success({
          invoice: {
            ...invoice,
            subtotal: Number(invoice.subtotal),
            discountAmount: Number(invoice.discountAmount),
            cgstAmount: Number(invoice.cgstAmount),
            sgstAmount: Number(invoice.sgstAmount),
            totalAmount: Number(invoice.totalAmount),
          },
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            tableName: order.table?.name,
            waiterName: order.waiterName,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
          },
          items: order.items.map((item) => ({
            name: item.menuItemName,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            total: Number(item.unitPrice) * item.quantity,
            gstRate: item.gstRate,
            modifiers: item.modifiers
              ? JSON.parse(item.modifiers as string)
              : [],
          })),
        })
      );
    }
  );
}
