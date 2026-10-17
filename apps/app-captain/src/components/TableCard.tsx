/**
 * Gusto Captain — TableCard Component
 *
 * Table status card with color coding and order summary.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fontSize, radius, spacing, fontWeight, shadow } from "../config/theme";
import { StatusBadge } from "./StatusBadge";
import type { TableResponse, ReservationResponse } from "../services/api";

interface TableCardProps {
  table: TableResponse;
  reservations?: ReservationResponse[];
  onPress: (table: TableResponse) => void;
}

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: colors.tableAvailable,
  OCCUPIED: colors.tableOccupied,
  RESERVED: colors.tableReserved,
  CLEANING: colors.tableCleaning,
};

function getElapsedTime(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function TableCard({ table, reservations = [], onPress }: TableCardProps) {
  const accentColor = STATUS_COLORS[table.status] ?? colors.textSecondary;

  // Find the next upcoming reservation for today
  const upcomingRes = reservations
    .filter(r => new Date(r.reservationTime).getTime() > Date.now())
    .sort((a, b) => new Date(a.reservationTime).getTime() - new Date(b.reservationTime).getTime())[0];

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { borderColor: accentColor + "40" },
        pressed && styles.cardPressed,
      ]}
      onPress={() => onPress(table)}
    >
      {/* Accent stripe */}
      <View style={[styles.stripe, { backgroundColor: accentColor }]} />

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.tableName}>{table.name}</Text>
          <View style={styles.capacityRow}>
            <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.capacity}>{table.capacity}</Text>
          </View>
        </View>

        {/* Status */}
        <View style={styles.statusRow}>
          <StatusBadge status={table.status} />
          {upcomingRes && (
            <View style={styles.reservationBadgeRow}>
              <Ionicons name="calendar-outline" size={12} color={colors.info} />
              <Text style={styles.reservationBadge}>
                {new Date(upcomingRes.reservationTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        </View>

        {/* Section */}
        {table.section && (
          <Text style={styles.section}>{table.section}</Text>
        )}

        {/* Order info (when occupied) */}
        {table.currentOrder && (
          <View style={styles.orderInfo}>
            <Text style={styles.orderNumber}>
              #{table.currentOrder.orderNumber}
            </Text>
            <View style={styles.orderMeta}>
              <Text style={styles.orderAmount}>
                ₹{Number(table.currentOrder.totalAmount).toFixed(0)}
              </Text>
              <Text style={styles.orderTime}>
                {getElapsedTime(table.currentOrder.createdAt)}
              </Text>
            </View>
            {table.currentOrder.waiterName && (
              <Text style={styles.waiterName}>
                {table.currentOrder.waiterName}
              </Text>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    ...shadow.sm,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  stripe: {
    height: 3,
    width: "100%",
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  capacityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  capacity: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reservationBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  reservationBadge: {
    fontSize: fontSize.xs,
    color: colors.info,
    fontWeight: fontWeight.bold,
  },
  section: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  orderInfo: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  orderNumber: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  orderMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderAmount: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  orderTime: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  waiterName: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
});
