/**
 * Gusto Captain — StatusBadge Component
 *
 * Pill badge for order/KOT/table statuses with color mapping.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, fontSize, radius, spacing, fontWeight } from "../config/theme";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

const STATUS_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  // Order statuses
  DRAFT: { label: "Draft", variant: "neutral" },
  PLACED: { label: "Placed", variant: "info" },
  IN_PROGRESS: { label: "In Progress", variant: "warning" },
  READY: { label: "Ready", variant: "success" },
  SERVED: { label: "Served", variant: "accent" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
  // KOT statuses
  PENDING: { label: "Pending", variant: "warning" },
  // Table statuses
  AVAILABLE: { label: "Available", variant: "success" },
  OCCUPIED: { label: "Occupied", variant: "accent" },
  RESERVED: { label: "Reserved", variant: "warning" },
  CLEANING: { label: "Cleaning", variant: "info" },
};

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: colors.successBg, text: colors.success },
  warning: { bg: colors.warningBg, text: colors.warning },
  danger: { bg: colors.dangerBg, text: colors.danger },
  info: { bg: colors.infoBg, text: colors.info },
  neutral: { bg: "rgba(161, 161, 170, 0.12)", text: colors.textSecondary },
  accent: { bg: colors.accentBg, text: colors.accent },
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const mapped = STATUS_MAP[status] ?? { label: status, variant: "neutral" as BadgeVariant };
  const variantStyle = VARIANT_STYLES[mapped.variant];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: variantStyle.bg },
        size === "md" && styles.badgeMd,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: variantStyle.text },
          size === "md" && styles.textMd,
        ]}
      >
        {mapped.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  badgeMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textMd: {
    fontSize: fontSize.sm,
  },
});
