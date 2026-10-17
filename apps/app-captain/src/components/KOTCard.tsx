import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, fontSize, fontWeight, radius, shadow } from "../config/theme";
import type { KOTResponse } from "../services/api";

interface KOTCardProps {
  kot: KOTResponse;
  onUpdateStatus: (id: string, newStatus: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED") => void;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: colors.warning,
  IN_PROGRESS: colors.info,
  READY: colors.success,
  SERVED: colors.textTertiary,
};

function getElapsedMinutes(createdAt: string): number {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diff / 60000);
}

function formatElapsedTime(minutes: number): string {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function parseModifiers(mods: unknown): string[] {
  if (!mods) return [];
  if (Array.isArray(mods)) return mods.map(String);
  if (typeof mods === "string") {
    try {
      const parsed = JSON.parse(mods);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [mods];
    } catch {
      return [mods];
    }
  }
  return [];
}

export function KOTCard({ kot, onUpdateStatus }: KOTCardProps) {
  const accentColor = STATUS_COLORS[kot.status] ?? colors.textSecondary;
  const elapsedMins = getElapsedMinutes(kot.createdAt);
  const isUrgent = kot.status !== "READY" && kot.status !== "SERVED" && elapsedMins >= 15;
  const isWarning = kot.status !== "READY" && kot.status !== "SERVED" && elapsedMins >= 10 && !isUrgent;

  const renderActionButton = () => {
    switch (kot.status) {
      case "PENDING":
        return (
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: colors.info },
              pressed && styles.actionButtonPressed,
            ]}
            onPress={() => onUpdateStatus(kot.id, "IN_PROGRESS")}
          >
            <Text style={styles.actionButtonText}>Start Prep</Text>
          </Pressable>
        );
      case "IN_PROGRESS":
        return (
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: colors.success },
              pressed && styles.actionButtonPressed,
            ]}
            onPress={() => onUpdateStatus(kot.id, "READY")}
          >
            <Text style={styles.actionButtonText}>Mark Ready</Text>
          </Pressable>
        );
      case "READY":
        return (
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: colors.textSecondary },
              pressed && styles.actionButtonPressed,
            ]}
            onPress={() => onUpdateStatus(kot.id, "SERVED")}
          >
            <Text style={styles.actionButtonText}>Mark Served</Text>
          </Pressable>
        );
      default:
        return null;
    }
  };

  return (
    <View
      style={[
        styles.card,
        { borderColor: isUrgent ? colors.danger : accentColor + "40" },
        isUrgent && styles.cardUrgent,
      ]}
    >
      <View
        style={[
          styles.stripe,
          { backgroundColor: isUrgent ? colors.danger : accentColor },
        ]}
      />
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.kotTitleRow}>
              <Text style={styles.kotNumber}>KOT #{kot.kotNumber}</Text>
              {kot.station && (
                <View style={styles.stationBadge}>
                  <Text style={styles.stationBadgeText}>{kot.station}</Text>
                </View>
              )}
            </View>
            <Text style={styles.orderNumber}>
              Order #{kot.orderNumber}
              {kot.tableName && ` • Table ${kot.tableName}`}
            </Text>
          </View>

          <View style={styles.metaRight}>
            <View
              style={[
                styles.timeBadge,
                isUrgent && styles.timeBadgeUrgent,
                isWarning && styles.timeBadgeWarning,
              ]}
            >
              {isUrgent && <Ionicons name="alert-circle" size={12} color={colors.danger} style={{ marginRight: 3 }} />}
              <Text
                style={[
                  styles.timeText,
                  isUrgent && styles.timeTextUrgent,
                  isWarning && styles.timeTextWarning,
                ]}
              >
                {formatElapsedTime(elapsedMins)}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: accentColor + "20" }]}>
              <Text style={[styles.statusText, { color: accentColor }]}>{kot.status}</Text>
            </View>
          </View>
        </View>

        {/* Items List */}
        <View style={styles.itemsContainer}>
          {kot.items.map((item) => {
            const modifiers = parseModifiers(item.modifiers);

            return (
              <View key={item.id} style={styles.itemRow}>
                <Text style={styles.itemQty}>{item.quantity}x</Text>
                <View style={styles.itemDetails}>
                  <View style={styles.itemHeaderLine}>
                    <Text style={styles.itemName}>{item.menuItemName}</Text>
                    {item.variantName && (
                      <View style={styles.variantBadge}>
                        <Text style={styles.variantBadgeText}>
                          {item.variantName === '12"' ? '12" L' : item.variantName === '8"' ? '8" R' : item.variantName}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Modifiers Chips */}
                  {modifiers.length > 0 && (
                    <View style={styles.modifiersWrap}>
                      {modifiers.map((mod, idx) => {
                        const isHalf = mod.startsWith("L:") && mod.includes("R:");
                        const isDrink = mod.startsWith("Drink:");
                        return (
                          <View
                            key={idx}
                            style={[
                              styles.modChip,
                              isHalf && styles.modChipHalf,
                              isDrink && styles.modChipDrink,
                            ]}
                          >
                            <Text
                              style={[
                                styles.modChipText,
                                isHalf && styles.modChipTextHalf,
                                isDrink && styles.modChipTextDrink,
                              ]}
                            >
                              {mod}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {item.notes && (
                    <View style={styles.itemNotesRow}>
                      <Ionicons name="document-text-outline" size={12} color={colors.warning} />
                      <Text style={styles.itemNotes}>{item.notes}</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Footer Actions */}
        <View style={styles.footer}>{renderActionButton()}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.md,
    ...shadow.sm,
  },
  cardUrgent: {
    borderWidth: 1.5,
  },
  stripe: {
    height: 4,
    width: "100%",
  },
  content: {
    padding: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  kotTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  kotNumber: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  stationBadge: {
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  stationBadgeText: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  orderNumber: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  metaRight: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput,
  },
  timeBadgeWarning: {
    backgroundColor: colors.warningBg,
  },
  timeBadgeUrgent: {
    backgroundColor: colors.dangerBg,
  },
  timeText: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
    fontWeight: fontWeight.semibold,
  },
  timeTextWarning: {
    color: colors.warning,
  },
  timeTextUrgent: {
    color: colors.danger,
    fontWeight: fontWeight.bold,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  itemsContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  itemQty: {
    width: 30,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  itemDetails: {
    flex: 1,
  },
  itemHeaderLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  itemName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.textPrimary,
  },
  variantBadge: {
    backgroundColor: colors.accentBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  variantBadgeText: {
    fontSize: 10,
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  modifiersWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 3,
  },
  modChip: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  modChipHalf: {
    backgroundColor: "rgba(249, 115, 22, 0.15)",
    borderWidth: 1,
    borderColor: colors.accent,
  },
  modChipDrink: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    borderWidth: 1,
    borderColor: colors.info,
  },
  modChipText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  modChipTextHalf: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  modChipTextDrink: {
    color: colors.info,
    fontWeight: fontWeight.semibold,
  },
  itemNotesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  itemNotes: {
    fontSize: fontSize.sm,
    color: colors.warning,
    fontStyle: "italic",
  },
  footer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    alignItems: "flex-end",
  },
  actionButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  actionButtonPressed: {
    opacity: 0.8,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
});
