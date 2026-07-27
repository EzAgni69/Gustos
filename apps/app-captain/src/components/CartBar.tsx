/**
 * Gusto Captain — CartBar Component
 *
 * Sticky bottom bar showing cart summary with item count, total, and View Cart CTA.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fontSize, radius, spacing, fontWeight, shadow } from "../config/theme";

interface CartBarProps {
  itemCount: number;
  total: number;
  onPress: () => void;
}

export function CartBar({ itemCount, total, onPress }: CartBarProps) {
  const insets = useSafeAreaInsets();

  if (itemCount === 0) return null;

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onPress}
      >
        <View style={styles.info}>
          <Text style={styles.countText}>
            {itemCount} {itemCount === 1 ? "Item" : "Items"}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.totalText}>₹{total.toFixed(0)}</Text>
        </View>

        <Text style={styles.ctaText}>View Cart →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: "rgba(9, 9, 11, 0.9)", // semi-transparent zinc-950
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadow.md,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  countText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  totalText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  ctaText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
});
