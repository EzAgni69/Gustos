/**
 * Gusto Captain — Void / Modify Fired Item Modal
 *
 * Allows captains to reduce quantity or completely void items that have already
 * been sent to the kitchen (fired KOT).
 * Automatically notifies pos-local-server to print a Kitchen Correction slip,
 * update the KDS, and record an NCR audit trail.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "./BottomSheet";
import { QuantityStepper } from "./QuantityStepper";
import { colors, spacing, fontSize, fontWeight, radius } from "../config/theme";
import { voidOrderItem, type OrderItemResponse } from "../services/api";
import { useAuthStore } from "../stores/auth.store";

interface VoidItemModalProps {
  isVisible: boolean;
  item: OrderItemResponse | null;
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const COMMON_REASONS = [
  "Accidental punch / wrong quantity",
  "Customer changed mind",
  "Kitchen unable to prepare",
  "Entered wrong table",
  "Quality / taste issue",
];

export function VoidItemModal({
  isVisible,
  item,
  orderId,
  onClose,
  onSuccess,
}: VoidItemModalProps) {
  const user = useAuthStore((s) => s.user);

  const [mode, setMode] = useState<"reduce" | "void_all">("reduce");
  const [reduceQty, setReduceQty] = useState(1);
  const [selectedReason, setSelectedReason] = useState(COMMON_REASONS[0]!);
  const [customReason, setCustomReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (item) {
      const canReduce = item.quantity > 1;
      setMode(canReduce ? "reduce" : "void_all");
      setReduceQty(1);
      setSelectedReason(COMMON_REASONS[0]!);
      setCustomReason("");
      setApprovedBy(user?.name || "Captain");
    }
  }, [item, user]);

  if (!item) return null;

  const maxReducible = Math.max(1, item.quantity - 1);
  const isPartial = mode === "reduce" && item.quantity > 1;
  const voidQty = isPartial ? reduceQty : item.quantity;
  const remainingQty = item.quantity - voidQty;

  const handleConfirm = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const finalReason = customReason.trim()
      ? `${selectedReason} - ${customReason.trim()}`
      : selectedReason;

    setIsSubmitting(true);
    try {
      await voidOrderItem(
        orderId,
        item.id,
        finalReason,
        approvedBy.trim() || user?.name || "Captain",
        voidQty
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
      onClose();
      Alert.alert(
        "KOT Corrected",
        isPartial
          ? `Reduced by ${voidQty}x. Remaining: ${remainingQty}x. Kitchen correction slip printed.`
          : `Item voided completely. Kitchen cancellation slip printed.`
      );
    } catch (err: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message =
        err instanceof Error ? err.message : "Failed to void item. Please try again.";
      Alert.alert("Correction Failed", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} height="85%">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <View style={styles.headerBadge}>
                <Ionicons name="flame" size={12} color={colors.accent} />
                <Text style={styles.headerBadgeText}>FIRED KOT CORRECTION</Text>
              </View>
              <Text style={styles.title}>Modify / Void Item</Text>
              <Text style={styles.subtitle}>
                Changes will sync to KDS & print a kitchen correction slip.
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Item Summary Card */}
          <View style={styles.itemCard}>
            <View style={styles.itemCardRow}>
              <View style={styles.qtyBubble}>
                <Text style={styles.qtyBubbleText}>{item.quantity}x</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.menuItemName}</Text>
                {item.variantName ? (
                  <Text style={styles.variantText}>
                    Size: {item.variantName}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.itemPrice}>
                ₹{(item.unitPrice * item.quantity).toFixed(0)}
              </Text>
            </View>
          </View>

          {/* Action Mode Toggle (if qty > 1) */}
          {item.quantity > 1 && (
            <View style={styles.modeContainer}>
              <Pressable
                style={[
                  styles.modeTab,
                  mode === "reduce" && styles.modeTabActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMode("reduce");
                }}
              >
                <Ionicons
                  name="remove-circle-outline"
                  size={16}
                  color={
                    mode === "reduce" ? colors.accent : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.modeTabText,
                    mode === "reduce" && styles.modeTabTextActive,
                  ]}
                >
                  Reduce Quantity
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.modeTab,
                  mode === "void_all" && styles.modeTabDangerActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMode("void_all");
                }}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={
                    mode === "void_all" ? colors.danger : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.modeTabText,
                    mode === "void_all" && styles.modeTabTextDangerActive,
                  ]}
                >
                  Void Entire Item
                </Text>
              </Pressable>
            </View>
          )}

          {/* Quantity adjustment stepper for reduce mode */}
          {mode === "reduce" && item.quantity > 1 ? (
            <View style={styles.reduceSection}>
              <View style={styles.reduceRow}>
                <View>
                  <Text style={styles.sectionLabel}>Quantity to Cancel</Text>
                  <Text style={styles.sectionSub}>
                    Remaining on bill:{" "}
                    <Text style={{ color: colors.success, fontWeight: "bold" }}>
                      {remainingQty}x
                    </Text>
                  </Text>
                </View>
                <QuantityStepper
                  quantity={reduceQty}
                  onChange={(q) => setReduceQty(Math.min(maxReducible, Math.max(1, q)))}
                  min={1}
                  max={maxReducible}
                />
              </View>
              <View style={styles.changeBanner}>
                <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
                <Text style={styles.changeBannerText}>
                  Changing quantity from {item.quantity}x → {remainingQty}x (voiding {reduceQty}x)
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.voidAllBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.voidAllBannerText}>
                All {item.quantity}x will be removed from billing and marked cancelled on KDS.
              </Text>
            </View>
          )}

          {/* Reason Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Reason for Correction *</Text>
            <View style={styles.reasonWrap}>
              {COMMON_REASONS.map((r) => {
                const isSelected = selectedReason === r;
                return (
                  <Pressable
                    key={r}
                    style={[
                      styles.reasonChip,
                      isSelected && styles.reasonChipSelected,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedReason(r);
                    }}
                  >
                    <Text
                      style={[
                        styles.reasonChipText,
                        isSelected && styles.reasonChipTextSelected,
                      ]}
                    >
                      {r}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.textInput}
              placeholder="Additional remarks or notes (optional)"
              placeholderTextColor={colors.textTertiary}
              value={customReason}
              onChangeText={setCustomReason}
            />
          </View>

          {/* Approval & Audit */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Approved By (NCR Audit)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Staff / Manager Name"
              placeholderTextColor={colors.textTertiary}
              value={approvedBy}
              onChangeText={setApprovedBy}
            />
          </View>

          {/* Warning notice */}
          <View style={styles.warningBox}>
            <Ionicons name="print-outline" size={18} color={colors.warning} />
            <Text style={styles.warningBoxText}>
              A kitchen correction slip with reason will immediately print for kitchen staff.
            </Text>
          </View>

          {/* Submit & Cancel Buttons */}
          <View style={styles.actions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelBtnText}>Keep Item</Text>
            </Pressable>

            <Pressable
              style={[
                styles.confirmBtn,
                mode === "void_all" ? styles.confirmBtnDanger : styles.confirmBtnAccent,
                isSubmitting && styles.btnDisabled,
              ]}
              onPress={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons
                    name={mode === "reduce" ? "checkmark-circle-outline" : "trash-outline"}
                    size={18}
                    color="#fff"
                  />
                  <Text style={styles.confirmBtnText}>
                    {mode === "reduce"
                      ? `Confirm Reduce (-${reduceQty})`
                      : "Confirm Full Void"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accentBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  headerBadgeText: {
    fontSize: 10,
    color: colors.accent,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput,
  },
  itemCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  itemCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  qtyBubble: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBubbleText: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  itemName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  variantText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  modeContainer: {
    flexDirection: "row",
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    padding: 3,
    gap: 4,
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  modeTabActive: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  modeTabDangerActive: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  modeTabText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
  modeTabTextActive: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  modeTabTextDangerActive: {
    color: colors.danger,
    fontWeight: fontWeight.bold,
  },
  reduceSection: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  reduceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  changeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentBg,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  changeBannerText: {
    fontSize: fontSize.xs,
    color: colors.accentLight,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  voidAllBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  voidAllBannerText: {
    fontSize: fontSize.sm,
    color: colors.danger,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  sectionSub: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  reasonWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  reasonChip: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  reasonChipSelected: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accent,
  },
  reasonChipText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  reasonChipTextSelected: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  textInput: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: fontSize.sm,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.3)",
  },
  warningBoxText: {
    fontSize: fontSize.xs,
    color: colors.warning,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xxl,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colors.bgInput,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  confirmBtn: {
    flex: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  confirmBtnAccent: {
    backgroundColor: colors.accent,
  },
  confirmBtnDanger: {
    backgroundColor: colors.danger,
  },
  confirmBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: "#fff",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
