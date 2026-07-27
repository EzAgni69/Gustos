/**
 * Gusto Captain — Design System / Theme
 *
 * Dark-mode theme using zinc color scale to match the existing POS palette.
 * Accent orange for restaurant warmth.
 */

export const colors = {
  // ─── Backgrounds ───
  bg: "#09090b",         // zinc-950
  bgCard: "#18181b",     // zinc-900
  bgElevated: "#1f1f23", // slightly lighter for modals/sheets
  bgInput: "#27272a",    // zinc-800

  // ─── Borders ───
  border: "#27272a",     // zinc-800
  borderLight: "#3f3f46", // zinc-700

  // ─── Text ───
  textPrimary: "#fafafa",   // zinc-50
  textSecondary: "#a1a1aa", // zinc-400
  textTertiary: "#71717a",  // zinc-500
  textMuted: "#52525b",     // zinc-600

  // ─── Accent ───
  accent: "#f97316",        // orange-500
  accentLight: "#fb923c",   // orange-400
  accentDark: "#ea580c",    // orange-600
  accentBg: "rgba(249, 115, 22, 0.12)",

  // ─── Semantic ───
  success: "#22c55e",       // green-500
  successBg: "rgba(34, 197, 94, 0.12)",
  warning: "#eab308",       // yellow-500
  warningBg: "rgba(234, 179, 8, 0.12)",
  danger: "#ef4444",        // red-500
  dangerBg: "rgba(239, 68, 68, 0.12)",
  info: "#3b82f6",          // blue-500
  infoBg: "rgba(59, 130, 246, 0.12)",

  // ─── Table Status Colors ───
  tableAvailable: "#22c55e",
  tableOccupied: "#f97316",
  tableReserved: "#eab308",
  tableCleaning: "#3b82f6",

  // ─── Veg/Non-veg indicators ───
  veg: "#22c55e",
  nonVeg: "#ef4444",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  display: 40,
} as const;

export const fontWeight = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
  extrabold: "800" as const,
};

export const shadow = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;
