/**
 * Gusto Captain — OrderCard Component
 *
 * Order list card showing order number, table, status, total, and time.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, fontSize, radius, spacing, fontWeight, shadow } from "../config/theme";
import { StatusBadge } from "./StatusBadge";
import type { OrderResponse } from "../services/api";

interface OrderCardProps {
  order: OrderResponse;
  tableName?: string; // Optional if we want to display the table name
  onPress: (order: OrderResponse) => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function OrderCard({ order, tableName, onPress }: OrderCardProps) {
  const itemCount = order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && styles.cardPressed,
      ]}
      onPress={() => onPress(order)}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
          {tableName && <Text style={styles.tableName}>• {tableName}</Text>}
        </View>
        <Text style={styles.time}>{formatTime(order.createdAt)}</Text>
      </View>

      <View style={styles.body}>
        <StatusBadge status={order.status} />
        <View style={styles.metaRow}>
          <Text style={styles.items}>{itemCount} {itemCount === 1 ? "Item" : "Items"}</Text>
          <Text style={styles.total}>₹{Number(order.totalAmount).toFixed(0)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadow.sm,
  },
  cardPressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  orderNumber: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  tableName: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  time: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  body: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaRow: {
    alignItems: "flex-end",
  },
  items: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  total: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
});
