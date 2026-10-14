/**
 * Gusto Cloud API Gateway — HR Routes
 *
 * Shift management, attendance tracking, and payroll.
 *
 * ─── Shifts ───
 * GET    /api/v1/hr/shifts       — List shifts for an outlet
 * POST   /api/v1/hr/shifts       — Create shift
 * PUT    /api/v1/hr/shifts/:id   — Update shift
 * DELETE /api/v1/hr/shifts/:id   — Delete shift
 *
 * ─── Attendance ───
 * GET   /api/v1/hr/attendance           — List attendance records
 * POST  /api/v1/hr/attendance           — Create attendance record
 * PUT   /api/v1/hr/attendance/:id       — Update attendance record
 * POST  /api/v1/hr/attendance/clock-in  — Clock in
 * POST  /api/v1/hr/attendance/clock-out — Clock out
 *
 * ─── Payroll ───
 * GET   /api/v1/hr/payrolls           — List payrolls
 * POST  /api/v1/hr/payrolls/generate  — Generate payroll for month
 * GET   /api/v1/hr/payrolls/:id       — Get payroll details
 * PUT   /api/v1/hr/payrolls/:id       — Update payroll
 * PATCH /api/v1/hr/payrolls/:id/status — Approve / Mark paid
 */

import type { FastifyInstance } from "fastify";
import { eq, and, count, between } from "drizzle-orm";
import {
  createShiftSchema,
  updateShiftSchema,
  listShiftsQuerySchema,
  createAttendanceSchema,
  updateAttendanceSchema,
  clockInSchema,
  clockOutSchema,
  listAttendanceQuerySchema,
  generatePayrollSchema,
  updatePayrollSchema,
  listPayrollsQuerySchema,
} from "@gusto/api-contracts";
import * as schema from "@gusto/db-schema/cloud";
import { db } from "../db/index.js";
import { getOrganizationId, requireMinRole } from "../middleware/auth.js";
import { success, paginated, error } from "../utils/response.js";

export async function hrRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  // ═══════════════════════════════════
  // ─── Shifts ───
  // ═══════════════════════════════════

  // List shifts
  fastify.get(
    "/api/v1/hr/shifts",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listShiftsQuerySchema.parse(request.query);

      const shifts = await db.query.shifts.findMany({
        where: and(
          eq(schema.shifts.organizationId, orgId),
          eq(schema.shifts.outletId, query.outletId)
        ),
        orderBy: (s, { asc }) => [asc(s.startTime)],
      });

      return reply.send(success(shifts));
    }
  );

  // Create shift
  fastify.post(
    "/api/v1/hr/shifts",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createShiftSchema.parse(request.body);

      const results = await db
        .insert(schema.shifts)
        .values({
          organizationId: orgId,
          ...body,
        })
        .returning();
      const shift = results[0]!;

      return reply.status(201).send(success(shift, "Shift created"));
    }
  );

  // Update shift
  fastify.put(
    "/api/v1/hr/shifts/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateShiftSchema.parse(request.body);

      const results = await db
        .update(schema.shifts)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(schema.shifts.id, id),
            eq(schema.shifts.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Shift not found"));
      }

      return reply.send(success(results[0], "Shift updated"));
    }
  );

  // Delete shift
  fastify.delete(
    "/api/v1/hr/shifts/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const results = await db
        .delete(schema.shifts)
        .where(
          and(
            eq(schema.shifts.id, id),
            eq(schema.shifts.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Shift not found"));
      }

      return reply.send(success(null, "Shift deleted"));
    }
  );

  // ═══════════════════════════════════
  // ─── Attendance ───
  // ═══════════════════════════════════

  // List attendance
  fastify.get(
    "/api/v1/hr/attendance",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listAttendanceQuerySchema.parse(request.query);

      const conditions = [
        eq(schema.attendances.organizationId, orgId),
        eq(schema.attendances.outletId, query.outletId),
      ];

      if (query.userId) {
        conditions.push(eq(schema.attendances.userId, query.userId));
      }
      if (query.date) {
        conditions.push(eq(schema.attendances.date, query.date));
      }
      if (query.month) {
        // Filter by month prefix — e.g. "2026-07" matches "2026-07-01" thru "2026-07-31"
        const startDate = `${query.month}-01`;
        const endDate = `${query.month}-31`;
        conditions.push(between(schema.attendances.date, startDate, endDate));
      }
      if (query.status) {
        conditions.push(eq(schema.attendances.status, query.status));
      }

      const where = and(...conditions);

      const [records, totalResult] = await Promise.all([
        db.query.attendances.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (a, { desc }) => [desc(a.date)],
          with: { user: true, shift: true },
        }),
        db.select({ count: count() }).from(schema.attendances).where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const formatted = records.map((r) => ({
        ...r,
        hoursWorked: r.hoursWorked ? Number(r.hoursWorked) : null,
        overtimeHours: Number(r.overtimeHours),
      }));

      return reply.send(paginated(formatted, total, query.page, query.limit));
    }
  );

  // Create attendance record
  fastify.post(
    "/api/v1/hr/attendance",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = createAttendanceSchema.parse(request.body);

      // Check for duplicate date + user
      const existing = await db.query.attendances.findFirst({
        where: and(
          eq(schema.attendances.organizationId, orgId),
          eq(schema.attendances.userId, body.userId),
          eq(schema.attendances.date, body.date)
        ),
      });

      if (existing) {
        return reply
          .status(409)
          .send(error("Attendance record already exists for this date"));
      }

      const results = await db
        .insert(schema.attendances)
        .values({
          organizationId: orgId,
          ...body,
        })
        .returning();

      return reply
        .status(201)
        .send(success(results[0], "Attendance recorded"));
    }
  );

  // Update attendance
  fastify.put(
    "/api/v1/hr/attendance/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updateAttendanceSchema.parse(request.body);

      // Calculate hours worked if both clock times are provided
      const updateData: Record<string, unknown> = {
        ...body,
        updatedAt: new Date(),
      };

      if (body.clockIn && body.clockOut) {
        const hoursWorked =
          (new Date(body.clockOut).getTime() -
            new Date(body.clockIn).getTime()) /
          (1000 * 60 * 60);
        updateData.hoursWorked = String(Math.round(hoursWorked * 100) / 100);

        // Standard 8-hour shift — anything beyond is overtime
        const overtime = Math.max(0, hoursWorked - 8);
        updateData.overtimeHours = String(Math.round(overtime * 100) / 100);
      }

      const results = await db
        .update(schema.attendances)
        .set(updateData)
        .where(
          and(
            eq(schema.attendances.id, id),
            eq(schema.attendances.organizationId, orgId)
          )
        )
        .returning();

      if (results.length === 0) {
        return reply.status(404).send(error("Attendance record not found"));
      }

      return reply.send(success(results[0], "Attendance updated"));
    }
  );

  // Clock In
  fastify.post(
    "/api/v1/hr/attendance/clock-in",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = clockInSchema.parse(request.body);
      const today = new Date().toISOString().split("T")[0]!;

      // Check if already clocked in today
      const existing = await db.query.attendances.findFirst({
        where: and(
          eq(schema.attendances.organizationId, orgId),
          eq(schema.attendances.userId, body.userId),
          eq(schema.attendances.date, today)
        ),
      });

      if (existing) {
        return reply
          .status(409)
          .send(error("Already clocked in for today"));
      }

      const results = await db
        .insert(schema.attendances)
        .values({
          organizationId: orgId,
          userId: body.userId,
          outletId: body.outletId,
          shiftId: body.shiftId || null,
          date: today,
          status: "PRESENT",
          clockIn: new Date(),
        })
        .returning();

      return reply
        .status(201)
        .send(success(results[0], "Clocked in successfully"));
    }
  );

  // Clock Out
  fastify.post(
    "/api/v1/hr/attendance/clock-out",
    { preHandler: [requireMinRole("WAITER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = clockOutSchema.parse(request.body);

      const attendance = await db.query.attendances.findFirst({
        where: and(
          eq(schema.attendances.id, body.attendanceId),
          eq(schema.attendances.organizationId, orgId)
        ),
      });

      if (!attendance) {
        return reply.status(404).send(error("Attendance record not found"));
      }

      if (attendance.clockOut) {
        return reply.status(400).send(error("Already clocked out"));
      }

      const clockOut = new Date();
      let hoursWorked: number | null = null;
      let overtime = 0;

      if (attendance.clockIn) {
        hoursWorked =
          (clockOut.getTime() - attendance.clockIn.getTime()) /
          (1000 * 60 * 60);
        hoursWorked = Math.round(hoursWorked * 100) / 100;
        overtime = Math.max(0, hoursWorked - 8);
      }

      const results = await db
        .update(schema.attendances)
        .set({
          clockOut,
          hoursWorked: hoursWorked !== null ? String(hoursWorked) : null,
          overtimeHours: String(Math.round(overtime * 100) / 100),
          updatedAt: new Date(),
        })
        .where(eq(schema.attendances.id, body.attendanceId))
        .returning();

      return reply.send(success(results[0], "Clocked out successfully"));
    }
  );

  // ═══════════════════════════════════
  // ─── Payroll ───
  // ═══════════════════════════════════

  // List payrolls
  fastify.get(
    "/api/v1/hr/payrolls",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const query = listPayrollsQuerySchema.parse(request.query);

      const conditions = [eq(schema.payrolls.organizationId, orgId)];

      if (query.outletId) {
        conditions.push(eq(schema.payrolls.outletId, query.outletId));
      }
      if (query.userId) {
        conditions.push(eq(schema.payrolls.userId, query.userId));
      }
      if (query.month) {
        conditions.push(eq(schema.payrolls.month, query.month));
      }
      if (query.status) {
        conditions.push(eq(schema.payrolls.status, query.status));
      }

      const where = and(...conditions);

      const [payrolls, totalResult] = await Promise.all([
        db.query.payrolls.findMany({
          where,
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
          orderBy: (p, { desc }) => [desc(p.createdAt)],
          with: { user: true },
        }),
        db.select({ count: count() }).from(schema.payrolls).where(where),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const formatted = payrolls.map((p) => ({
        ...p,
        baseSalary: Number(p.baseSalary),
        overtimeHours: Number(p.overtimeHours),
        overtimeRate: Number(p.overtimeRate),
        deductions: Number(p.deductions),
        bonus: Number(p.bonus),
        netSalary: Number(p.netSalary),
      }));

      return reply.send(paginated(formatted, total, query.page, query.limit));
    }
  );

  // Generate payroll for a month
  fastify.post(
    "/api/v1/hr/payrolls/generate",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const orgId = getOrganizationId(request);
      const body = generatePayrollSchema.parse(request.body);

      // Get employees for the outlet
      const userConditions = [
        eq(schema.users.organizationId, orgId),
        eq(schema.users.outletId, body.outletId),
        eq(schema.users.isActive, true),
      ];

      if (body.userId) {
        userConditions.push(eq(schema.users.id, body.userId));
      }

      const employees = await db.query.users.findMany({
        where: and(...userConditions),
      });

      if (employees.length === 0) {
        return reply
          .status(404)
          .send(error("No active employees found for this outlet"));
      }

      // Calculate working days in the month
      const [year, month] = body.month.split("-").map(Number) as [number, number];
      const daysInMonth = new Date(year, month, 0).getDate();
      // Rough estimate: exclude Sundays
      const totalWorkingDays = Math.round(daysInMonth * (6 / 7));

      const generated: unknown[] = [];

      for (const employee of employees) {
        // Check if payroll already exists
        const existing = await db.query.payrolls.findFirst({
          where: and(
            eq(schema.payrolls.organizationId, orgId),
            eq(schema.payrolls.userId, employee.id),
            eq(schema.payrolls.month, body.month)
          ),
        });

        if (existing) continue; // Skip already generated

        // Count attendance days
        const startDate = `${body.month}-01`;
        const endDate = `${body.month}-${daysInMonth}`;

        const attendanceRecords = await db.query.attendances.findMany({
          where: and(
            eq(schema.attendances.userId, employee.id),
            eq(schema.attendances.outletId, body.outletId),
            between(schema.attendances.date, startDate, endDate)
          ),
        });

        const daysWorked = attendanceRecords.filter(
          (a) => a.status === "PRESENT" || a.status === "HALF_DAY"
        ).length;

        const totalOvertime = attendanceRecords.reduce(
          (sum, a) => sum + Number(a.overtimeHours || 0),
          0
        );

        // Default base salary placeholder — should come from employee profile
        // in a future iteration
        const baseSalary = 25000;
        const perDaySalary = baseSalary / totalWorkingDays;
        const earnedSalary = perDaySalary * daysWorked;
        const deduction = baseSalary - earnedSalary;
        const netSalary = earnedSalary;

        const results = await db
          .insert(schema.payrolls)
          .values({
            organizationId: orgId,
            userId: employee.id,
            outletId: body.outletId,
            month: body.month,
            baseSalary: String(baseSalary),
            daysWorked,
            totalDays: totalWorkingDays,
            overtimeHours: String(Math.round(totalOvertime * 100) / 100),
            overtimeRate: "0",
            deductions: String(Math.round(deduction * 100) / 100),
            bonus: "0",
            netSalary: String(Math.round(netSalary * 100) / 100),
            status: "CALCULATED",
          })
          .returning();

        generated.push(results[0]);
      }

      return reply.send(
        success(
          { generated: generated.length, payrolls: generated },
          `Payroll generated for ${generated.length} employees`
        )
      );
    }
  );

  // Get payroll details
  fastify.get(
    "/api/v1/hr/payrolls/:id",
    { preHandler: [requireMinRole("MANAGER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);

      const payroll = await db.query.payrolls.findFirst({
        where: and(
          eq(schema.payrolls.id, id),
          eq(schema.payrolls.organizationId, orgId)
        ),
        with: { user: true },
      });

      if (!payroll) {
        return reply.status(404).send(error("Payroll not found"));
      }

      return reply.send(
        success({
          ...payroll,
          baseSalary: Number(payroll.baseSalary),
          overtimeHours: Number(payroll.overtimeHours),
          overtimeRate: Number(payroll.overtimeRate),
          deductions: Number(payroll.deductions),
          bonus: Number(payroll.bonus),
          netSalary: Number(payroll.netSalary),
        })
      );
    }
  );

  // Update payroll
  fastify.put(
    "/api/v1/hr/payrolls/:id",
    { preHandler: [requireMinRole("OWNER")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = getOrganizationId(request);
      const body = updatePayrollSchema.parse(request.body);

      const existing = await db.query.payrolls.findFirst({
        where: and(
          eq(schema.payrolls.id, id),
          eq(schema.payrolls.organizationId, orgId)
        ),
      });

      if (!existing) {
        return reply.status(404).send(error("Payroll not found"));
      }

      if (existing.status === "PAID") {
        return reply
          .status(400)
          .send(error("Cannot modify a paid payroll"));
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (body.baseSalary !== undefined)
        updateData.baseSalary = String(body.baseSalary);
      if (body.deductions !== undefined)
        updateData.deductions = String(body.deductions);
      if (body.bonus !== undefined) updateData.bonus = String(body.bonus);
      if (body.overtimeRate !== undefined)
        updateData.overtimeRate = String(body.overtimeRate);
      if (body.notes !== undefined) updateData.notes = body.notes;

      // Recalculate net salary
      const baseSalary =
        body.baseSalary ?? Number(existing.baseSalary);
      const deductions =
        body.deductions ?? Number(existing.deductions);
      const bonus = body.bonus ?? Number(existing.bonus);
      const overtimeRate =
        body.overtimeRate ?? Number(existing.overtimeRate);
      const overtimeHours = Number(existing.overtimeHours);
      const overtimePay = overtimeRate * overtimeHours;

      const perDaySalary = baseSalary / existing.totalDays;
      const earnedSalary = perDaySalary * existing.daysWorked;
      const netSalary = earnedSalary - deductions + bonus + overtimePay;

      updateData.netSalary = String(Math.round(netSalary * 100) / 100);

      if (body.status !== undefined) {
        updateData.status = body.status;
        if (body.status === "PAID") {
          updateData.paidAt = new Date();
        }
      }

      const results = await db
        .update(schema.payrolls)
        .set(updateData)
        .where(eq(schema.payrolls.id, id))
        .returning();

      return reply.send(success(results[0], "Payroll updated"));
    }
  );
}
