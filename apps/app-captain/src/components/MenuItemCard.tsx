/**
 * Gusto Captain — MenuItemCard Component
 *
 * Menu item card displaying veg/non-veg dot, name, price, and quick-add button.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, fontSize, radius, spacing, fontWeight, shadow } from "../config/theme";
import type { MenuItemResponse } from "../services/api";

interface MenuItemCardProps {
  item: MenuItemResponse;
  quantity?: number;
  onAdd: (item: MenuItemResponse) => void;
  onPress: (item: MenuItemResponse) => void;
}

export function MenuItemCard({ item, quantity = 0, onAdd, onPress }: MenuItemCardProps) {
  const isAvailable = item.isAvailable;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        !isAvailable && styles.cardUnavailable,
        pressed && isAvailable && styles.cardPressed,
      ]}
      onPress={() => isAvailable && onPress(item)}
      disabled={!isAvailable}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.vegIndicator, { borderColor: item.isVeg ? colors.veg : colors.nonVeg }]}>
            <View style={[styles.vegDot, { backgroundColor: item.isVeg ? colors.veg : colors.nonVeg }]} />
          </View>
          <Text style={[styles.name, !isAvailable && styles.textUnavailable]} numberOfLines={2}>
            {item.name}
          </Text>
        </View>

        {item.description && (
          <Text style={[styles.description, !isAvailable && styles.textUnavailable]} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        <View style={styles.footer}>
          <Text style={[styles.price, !isAvailable && styles.textUnavailable]}>
            ₹{item.price.toFixed(0)}
          </Text>

          {isAvailable ? (
            <Pressable
              style={({ pressed }) => [
                styles.addButton,
                quantity > 0 && styles.addButtonActive,
                pressed && styles.addButtonPressed,
              ]}
              onPress={() => onAdd(item)}
              hitSlop={8}
            >
              {quantity > 0 ? (
                <Text style={styles.addTextActive}>{quantity}</Text>
              ) : (
                <Text style={styles.addText}>ADD</Text>
              )}
            </Pressable>
          ) : (
            <Text style={styles.unavailableBadge}>86'd</Text>
          )}
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
  cardUnavailable: {
    opacity: 0.5,
    backgroundColor: colors.bg,
  },
  cardPressed: {
    opacity: 0.8,
  },
  content: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  vegIndicator: {
    width: 14,
    height: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
    backgroundColor: "#fff", // traditional white background for veg indicator
  },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  name: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  price: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  addButton: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    minWidth: 70,
    alignItems: "center",
  },
  addButtonActive: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accent,
  },
  addButtonPressed: {
    opacity: 0.7,
  },
  addText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  addTextActive: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  unavailableBadge: {
    fontSize: fontSize.sm,
    color: colors.danger,
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
  },
  textUnavailable: {
    color: colors.textTertiary,
  },
});
