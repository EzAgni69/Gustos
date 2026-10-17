import type { Outlet } from "@gusto/api-contracts";

// ─── Role Badge ───

/**
 * Returns the Tailwind CSS class string for a given employee role badge.
 *
 * @param role - The employee role string (e.g. "MANAGER", "CASHIER").
 * @returns A Tailwind class string for background and text colour.
 */
export function getRoleBadgeClass(role: string): string {
  switch (role) {
    case "MANAGER":
      return "bg-blue-100 text-blue-800";
    case "CASHIER":
      return "bg-gray-100 text-gray-700";
    case "WAITER":
      return "bg-green-100 text-green-800";
    case "CHEF":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

// ─── Outlet Name Resolution ───

/**
 * Resolves a human-readable outlet name from an outlet ID.
 *
 * @param outletId - The outlet ID to look up (may be null or undefined for global staff).
 * @param outlets  - The array of known outlets to search within.
 * @returns The matched outlet's name, "Global" when outletId is null/undefined,
 *          or "Unknown Outlet" when the ID is not found in the array.
 */
export function resolveOutletName(
  outletId: string | null | undefined,
  outlets: Outlet[],
): string {
  if (outletId == null) {
    return "Global";
  }
  const found = outlets.find((o) => o.id === outletId);
  return found ? found.name : "Unknown Outlet";
}

// ─── Staff Filter ───

/**
 * Filters a staff list by a free-text query, matching against name, email, and role
 * (case-insensitive substring match).
 *
 * @param staff - The full array of staff members to filter.
 * @param query - The search string; an empty/blank string returns the full list.
 * @returns A new array containing only the staff members that match the query.
 */
export function filterStaff<
  T extends { name: string; email?: string | null; role: string },
>(staff: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return staff;

  return staff.filter(
    (member) =>
      member.name.toLowerCase().includes(q) ||
      (member.email ?? "").toLowerCase().includes(q) ||
      member.role.toLowerCase().includes(q),
  );
}
