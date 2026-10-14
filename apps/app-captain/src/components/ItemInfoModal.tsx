import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { colors, spacing, fontSize, fontWeight, radius } from "../config/theme";
import type { MenuItemResponse } from "../services/api";

interface ItemInfoModalProps {
  item: MenuItemResponse | null;
  isVisible: boolean;
  onClose: () => void;
  onAddPress?: (item: MenuItemResponse) => void;
}

export function ItemInfoModal({ item, isVisible, onClose, onAddPress }: ItemInfoModalProps) {
  if (!item) return null;

  // Parse variants if available
  let parsedVariants: { name: string; price: number }[] = [];
  if (item.variants) {
    try {
      parsedVariants = JSON.parse(item.variants);
    } catch (e) {
      console.error("Failed to parse variants for InfoModal", e);
    }
  }

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} height="60%">
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={[styles.vegIndicator, { borderColor: item.isVeg ? colors.veg : colors.nonVeg }]}>
              <View style={[styles.vegDot, { backgroundColor: item.isVeg ? colors.veg : colors.nonVeg }]} />
            </View>
            <Text style={styles.itemName}>{item.name}</Text>
          </View>

          {/* Description */}
          <View style={styles.descriptionContainer}>
            <Text style={styles.descriptionLabel}>Ingredients / Recipe</Text>
            <Text style={styles.descriptionText}>{item.description}</Text>
          </View>

          {/* Pricing & Sizes */}
          <View style={styles.pricingContainer}>
            <Text style={styles.pricingLabel}>Available Sizes & Pricing</Text>
            {parsedVariants.length > 0 ? (
              <View style={styles.variantList}>
                {parsedVariants.map((v, i) => (
                  <View key={i} style={styles.variantRow}>
                    <Text style={styles.variantName}>{v.name}</Text>
                    <Text style={styles.variantPrice}>₹{v.price}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.variantRow}>
                <Text style={styles.variantName}>Standard</Text>
                <Text style={styles.variantPrice}>₹{item.price}</Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer Actions */}
        <View style={styles.footer}>
          {onAddPress && item.isAvailable && (
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              onPress={() => {
                onClose();
                onAddPress(item);
              }}
            >
              <Text style={styles.addButtonText}>Add to Cart</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            onPress={onClose}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  vegIndicator: {
    width: 16,
    height: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  vegDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  itemName: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    flex: 1,
  },
  descriptionContainer: {
    backgroundColor: colors.bgCard,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  descriptionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  descriptionText: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  pricingContainer: {
    backgroundColor: colors.bgCard,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  pricingLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textTertiary,
    marginBottom: spacing.md,
    textTransform: "uppercase",
  },
  variantList: {
    gap: spacing.sm,
  },
  variantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  variantName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.textPrimary,
  },
  variantPrice: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  footer: {
    padding: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.bgCard,
  },
  addButton: {
    flex: 2,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  closeButton: {
    flex: 1,
    backgroundColor: colors.bgInput,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  closeButtonText: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  pressed: {
    opacity: 0.8,
  },
});
