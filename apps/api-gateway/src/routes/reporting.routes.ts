/**
 * Gusto Cloud API Gateway — Reporting Routes
 *
 * Aggregated analytics and reports for the ERP dashboard.
 *
 * GET /api/v1/reports/sales          — Sales report (daily/weekly/monthly)
 * GET /api/v1/reports/inventory      — Inventory stock levels & low-stock alerts
 * GET /api/v1/reports/profitability  — Revenue vs. cost analysis
 * GET /api/v1/reports/dashboard      — Quick summary for dashboard widgets
 */

import type { FastifyInstance } from "fastify";
import { eq, and, between, sql, lt } from "drizzle-orm";
import {
  salesReportQuerySchema,
  inventoryReportQuerySchema,
  profitabilityReportQuerySchema,
} from "@gusto/api-contracts";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";

export async function reportingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ─── Sales Report ───
  fastify.get(
    "/api/v1/reports/sales",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = salesReportQuerySchema.parse(request.query);

      const startTs = new Date(`${query.startDate}T00:00:00`);
      const endTs = new Date(`${query.endDate}T23:59:59`);

      // Get all completed orders in the date range
      const orders = await db.query.orders.findMany({
        where: and(
          eq(schema.orders.organizationId, orgId),
          eq(schema.orders.outletId, query.outletId),
          eq(schema.orders.status, "COMPLETED"),
          between(schema.orders.createdAt, startTs, endTs)
        ),
        with: { items: true },
      });

      // Aggregate by date grouping
      const grouped = new Map<
        string,
        {
          period: string;
          orderCount: number;
          totalRevenue: number;
          totalTax: number;
          totalDiscount: number;
          avgOrderValue: number;
          itemsSold: number;
        }
      >();

      for (const order of orders) {
        let periodKey: string;

        if (query.groupBy === "day") {
          periodKey = order.createdAt.toISOString().split("T")[0]!;
        } else if (query.groupBy === "week") {
          const d = new Date(order.createdAt);
          const dayOfWeek = d.getDay();
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - dayOfWeek);
          periodKey = `W-${weekStart.toISOString().split("T")[0]!}`;
        } else {
          // month
          periodKey = order.createdAt.toISOString().slice(0, 7);
        }

        const existing = grouped.get(periodKey) || {
          period: periodKey,
          orderCount: 0,
          totalRevenue: 0,
          totalTax: 0,
          totalDiscount: 0,
          avgOrderValue: 0,
          itemsSold: 0,
        };

        existing.orderCount += 1;
        existing.totalRevenue += Number(order.totalAmount);
        existing.totalTax += Number(order.taxAmount);
        existing.totalDiscount += Number(order.discountAmount);
        existing.itemsSold += order.items.reduce(
          (sum, item) => sum + item.quantity,
          0
        );

        grouped.set(periodKey, existing);
      }

      // Calculate averages
      const report = Array.from(grouped.values())
        .map((g) => ({
          ...g,
          totalRevenue: Math.round(g.totalRevenue * 100) / 100,
          totalTax: Math.round(g.totalTax * 100) / 100,
          totalDiscount: Math.round(g.totalDiscount * 100) / 100,
          avgOrderValue:
            g.orderCount > 0
              ? Math.round((g.totalRevenue / g.orderCount) * 100) / 100
              : 0,
        }))
        .sort((a, b) => a.period.localeCompare(b.period));

      // Summary totals
      const summary = {
        totalOrders: orders.length,
        totalRevenue:
          Math.round(
            orders.reduce((s, o) => s + Number(o.totalAmount), 0) * 100
          ) / 100,
        totalTax:
          Math.round(
            orders.reduce((s, o) => s + Number(o.taxAmount), 0) * 100
          ) / 100,
        totalDiscount:
          Math.round(
            orders.reduce((s, o) => s + Number(o.discountAmount), 0) * 100
          ) / 100,
        avgOrderValue: 0 as number,
        totalItemsSold: orders.reduce(
          (s, o) => s + o.items.reduce((is, i) => is + i.quantity, 0),
          0
        ),
      };
      summary.avgOrderValue =
        summary.totalOrders > 0
          ? Math.round(
              (summary.totalRevenue / summary.totalOrders) * 100
            ) / 100
          : 0;

      return reply.send(
        success({
          startDate: query.startDate,
          endDate: query.endDate,
          groupBy: query.groupBy,
          summary,
          breakdown: report,
        })
      );
    }
  );

  // ─── Inventory Report ───
  fastify.get(
    "/api/v1/reports/inventory",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = inventoryReportQuerySchema.parse(request.query);

      const conditions = [eq(schema.inventoryItems.organizationId, orgId)];

      if (query.lowStockOnly) {
        // Items where currentStock <= minimumStock
        conditions.push(
          sql`${schema.inventoryItems.currentStock} <= ${schema.inventoryItems.minimumStock}`
        );
      }

      const items = await db.query.inventoryItems.findMany({
        where: and(...conditions),
        orderBy: (i, { asc }) => [asc(i.name)],
      });

      const formatted = items.map((item) => {
        const current = Number(item.currentStock);
        const minimum = Number(item.minimumStock);
        const isLowStock = current <= minimum;
        const stockPercentage =
          minimum > 0 ? Math.round((current / minimum) * 100) : 100;

        return {
          ...item,
          currentStock: current,
          minimumStock: minimum,
          costPerUnit: Number(item.costPerUnit),
          totalValue: Math.round(current * Number(item.costPerUnit) * 100) / 100,
          isLowStock,
          stockPercentage,
        };
      });

      const summary = {
        totalItems: formatted.length,
        lowStockItems: formatted.filter((i) => i.isLowStock).length,
        totalInventoryValue: Math.round(
          formatted.reduce((s, i) => s + i.totalValue, 0) * 100
        ) / 100,
      };

      return reply.send(
        success({
          summary,
          items: formatted,
        })
      );
    }
  );

  // ─── Profitability Report ───
  fastify.get(
    "/api/v1/reports/profitability",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = profitabilityReportQuerySchema.parse(request.query);

      const startTs = new Date(`${query.startDate}T00:00:00`);
      const endTs = new Date(`${query.endDate}T23:59:59`);

      // Revenue from completed orders
      const orders = await db.query.orders.findMany({
        where: and(
          eq(schema.orders.organizationId, orgId),
          eq(schema.orders.outletId, query.outletId),
          eq(schema.orders.status, "COMPLETED"),
          between(schema.orders.createdAt, startTs, endTs)
        ),
        with: { items: true },
      });

      const totalRevenue = orders.reduce(
        (s, o) => s + Number(o.totalAmount),
        0
      );
      const totalTax = orders.reduce(
        (s, o) => s + Number(o.taxAmount),
        0
      );
      const totalDiscounts = orders.reduce(
        (s, o) => s + Number(o.discountAmount),
        0
      );

      // Estimated food cost based on recipes
      // For now, calculate using item-level cost estimates
      // In a future phase, this should deduct from recipe ingredient costs
      const itemsSold: { name: string; quantity: number; revenue: number }[] =
        [];
      const itemMap = new Map<
        string,
        { name: string; quantity: number; revenue: number }
      >();

      for (const order of orders) {
        for (const item of order.items) {
          const key = item.menuItemId;
          const existing = itemMap.get(key) || {
            name: item.menuItemName,
            quantity: 0,
            revenue: 0,
          };
          existing.quantity += item.quantity;
          existing.revenue += Number(item.unitPrice) * item.quantity;
          itemMap.set(key, existing);
        }
      }

      const topItems = Array.from(itemMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map((i) => ({
          ...i,
          revenue: Math.round(i.revenue * 100) / 100,
        }));

      // Payroll costs for the period
      const payrollCosts = await db.query.payrolls.findMany({
        where: and(
          eq(schema.payrolls.organizationId, orgId),
          eq(schema.payrolls.outletId, query.outletId)
        ),
      });

      const totalLabourCost = payrollCosts.reduce(
        (s, p) => s + Number(p.netSalary),
        0
      );

      // Online order commissions
      const onlineOrders = await db.query.onlineOrders.findMany({
        where: and(
          eq(schema.onlineOrders.organizationId, orgId),
          eq(schema.onlineOrders.outletId, query.outletId),
          between(schema.onlineOrders.createdAt, startTs, endTs)
        ),
      });

      const totalCommissions = onlineOrders.reduce(
        (s, o) => s + Number(o.commissionAmount),
        0
      );
      const onlineRevenue = onlineOrders.reduce(
        (s, o) => s + Number(o.totalAmount),
        0
      );

      const netRevenueBeforeTax = totalRevenue - totalTax;

      return reply.send(
        success({
          period: {
            startDate: query.startDate,
            endDate: query.endDate,
          },
          revenue: {
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalTax: Math.round(totalTax * 100) / 100,
            totalDiscounts: Math.round(totalDiscounts * 100) / 100,
            netRevenueBeforeTax:
              Math.round(netRevenueBeforeTax * 100) / 100,
            orderCount: orders.length,
            avgOrderValue:
              orders.length > 0
                ? Math.round(
                    (totalRevenue / orders.length) * 100
                  ) / 100
                : 0,
          },
          online: {
            orderCount: onlineOrders.length,
            revenue: Math.round(onlineRevenue * 100) / 100,
            commissions: Math.round(totalCommissions * 100) / 100,
          },
          costs: {
            labourCost: Math.round(totalLabourCost * 100) / 100,
            commissions: Math.round(totalCommissions * 100) / 100,
          },
          topSellingItems: topItems,
        })
      );
    }
  );

  // ─── Dashboard Quick Summary ───
  fastify.get(
    "/api/v1/reports/dashboard",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const { outletId } = request.query as { outletId?: string };

      if (!outletId) {
        return reply.status(400).send(error("outletId is required"));
      }

      const today = new Date();
      const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const todayEnd = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        23,
        59,
        59
      );

      // Today's orders
      const todayOrders = await db.query.orders.findMany({
        where: and(
          eq(schema.orders.organizationId, orgId),
          eq(schema.orders.outletId, outletId),
          between(schema.orders.createdAt, todayStart, todayEnd)
        ),
      });

      const todayRevenue = todayOrders
        .filter((o) => o.status === "COMPLETED")
        .reduce((s, o) => s + Number(o.totalAmount), 0);

      const activeOrders = todayOrders.filter(
        (o) =>
          o.status !== "COMPLETED" &&
          o.status !== "CANCELLED"
      ).length;

      // Low stock count
      const lowStockItems = await db.query.inventoryItems.findMany({
        where: and(
          eq(schema.inventoryItems.organizationId, orgId),
          sql`${schema.inventoryItems.currentStock} <= ${schema.inventoryItems.minimumStock}`
        ),
      });

      // Today's attendance
      const todayDate = today.toISOString().split("T")[0]!;
      const todayAttendance = await db.query.attendances.findMany({
        where: and(
          eq(schema.attendances.organizationId, orgId),
          eq(schema.attendances.outletId, outletId),
          eq(schema.attendances.date, todayDate)
        ),
      });

      // Pending online orders
      const pendingOnline = await db.query.onlineOrders.findMany({
        where: and(
          eq(schema.onlineOrders.organizationId, orgId),
          eq(schema.onlineOrders.outletId, outletId),
          eq(schema.onlineOrders.status, "RECEIVED")
        ),
      });

      return reply.send(
        success({
          today: {
            totalOrders: todayOrders.length,
            activeOrders,
            revenue: Math.round(todayRevenue * 100) / 100,
            completedOrders: todayOrders.filter(
              (o) => o.status === "COMPLETED"
            ).length,
          },
          alerts: {
            lowStockItems: lowStockItems.length,
            pendingOnlineOrders: pendingOnline.length,
          },
          staff: {
            presentToday: todayAttendance.filter(
              (a) => a.status === "PRESENT"
            ).length,
            totalCheckedIn: todayAttendance.length,
          },
        })
      );
    }
  );
}
