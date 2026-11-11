"use client";

/**
 * Read-only matrix of what each role can do.
 *
 * Roles are fixed and enforced on the servers (cloud API and outlet POS); this
 * table documents those rules so owners can pick the right role for each
 * person. Keep it in step with the role checks in api-gateway and
 * pos-local-server when they change.
 */

import { Check, Minus, ShieldCheck } from "lucide-react";
import type { UserRole } from "@gusto/api-contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ROLES: { role: UserRole; label: string }[] = [
  { role: "OWNER", label: "Owner" },
  { role: "MANAGER", label: "Manager" },
  { role: "CASHIER", label: "Cashier" },
  { role: "WAITER", label: "Waiter / Captain" },
  { role: "CHEF", label: "Chef" },
];

const LEVEL: Record<UserRole, number> = { CHEF: 0, WAITER: 1, CASHIER: 2, MANAGER: 3, OWNER: 4, SUPER_ADMIN: 5 };

/** A permission is granted to `min` and every role above it. */
interface Permission {
  label: string;
  hint?: string;
  min: UserRole;
}

const SECTIONS: { title: string; description: string; permissions: Permission[] }[] = [
  {
    title: "Outlet POS & Captain app",
    description: "Signed in with a PIN on the billing counter or a waiter's phone.",
    permissions: [
      { label: "Take orders and send them to the kitchen", min: "WAITER" },
      { label: "Move, merge and transfer tables", min: "WAITER" },
      { label: "Void an item", hint: "Needs a reason and a named approver; recorded in the audit trail", min: "WAITER" },
      { label: "Take payment and print bills", min: "WAITER" },
      { label: "Apply discounts", min: "CASHIER" },
      { label: "Open / close shifts, X and Z reports, cash drawer", min: "CASHIER" },
      { label: "Correct or void a bill after payment", min: "CASHIER" },
      { label: "Mark a menu item unavailable (86)", min: "MANAGER" },
      { label: "Mark an order complimentary", min: "MANAGER" },
    ],
  },
  {
    title: "Cloud ERP (this dashboard)",
    description: "Signed in with email and password.",
    permissions: [
      { label: "View dashboard, orders and sales reports", min: "MANAGER" },
      { label: "Manage menu, categories and tables", min: "MANAGER" },
      { label: "Manage inventory, recipes, vendors, purchase orders and GRNs", min: "MANAGER" },
      { label: "Add and edit staff", hint: "Only people below their own role; cannot grant a role above their own", min: "MANAGER" },
      { label: "Create and edit outlets", min: "MANAGER" },
      { label: "View profitability report", min: "OWNER" },
      { label: "Create, rename and delete franchises; delete outlets", min: "OWNER" },
      { label: "Organization settings, tax rules and integrations", min: "OWNER" },
    ],
  },
];

export function PermissionMatrix() {
  return (
    <Card className="shadow-xs border-gray-100">
      <CardHeader className="bg-gray-50/50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-600" />
          <div>
            <CardTitle className="text-lg">Permission Matrix</CardTitle>
            <CardDescription>
              What each role can do. Permissions come with the role — change a person's role in the Staff tab to change their access.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th scope="col" className="px-4 py-3 font-medium text-gray-500">
                Permission
              </th>
              {ROLES.map((r) => (
                <th key={r.role} scope="col" className="px-3 py-3 font-medium text-gray-700 text-center whitespace-nowrap">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          {SECTIONS.map((section) => (
            <tbody key={section.title}>
              <tr className="bg-gray-50/70 border-y border-gray-100">
                <th scope="colgroup" colSpan={ROLES.length + 1} className="px-4 py-2 text-left">
                  <span className="font-semibold text-gray-900">{section.title}</span>
                  <span className="ml-2 font-normal text-xs text-gray-500">{section.description}</span>
                </th>
              </tr>
              {section.permissions.map((p) => (
                <tr key={p.label} className="border-b border-gray-50">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal text-gray-800">
                    {p.label}
                    {p.hint && <div className="text-xs text-gray-500">{p.hint}</div>}
                  </th>
                  {ROLES.map((r) => {
                    const allowed = LEVEL[r.role] >= LEVEL[p.min];
                    return (
                      <td key={r.role} className="px-3 py-2.5 text-center">
                        {allowed ? (
                          <Check className="inline w-4 h-4 text-emerald-600" aria-label="Allowed" />
                        ) : (
                          <Minus className="inline w-4 h-4 text-gray-300" aria-label="Not allowed" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
          Kitchen display screens need no sign-in: they can only view tickets and mark them cooking or ready. Chefs have no POS or ERP access
          unless given a higher role.
        </p>
      </CardContent>
    </Card>
  );
}
