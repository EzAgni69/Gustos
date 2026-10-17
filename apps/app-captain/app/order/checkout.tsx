import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  getOrder,
  checkoutOrder,
  type OrderResponse,
  type PaymentMode,
  type PaymentSplitInput,
} from "../../src/services/api";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import { Ionicons } from "@expo/vector-icons";

// ─── Payment Config ───

const PAYMENT_MODES: { key: PaymentMode; label: string; icon: any }[] = [
  { key: "CASH", label: "Cash", icon: require("../../assets/images/icons/cash.png") },
  { key: "CARD", label: "Card", icon: require("../../assets/images/icons/card.png") },
  { key: "UPI", label: "UPI", icon: require("../../assets/images/icons/upi.png") },
  { key: "SPLIT", label: "Split", icon: require("../../assets/images/icons/split.png") },
];

const UPI_SUB_METHODS: { key: string; label: string; icon: any }[] = [
  { key: "GPAY", label: "GPay", icon: require("../../assets/images/icons/gpay.png") },
  { key: "PHONEPE", label: "PhonePe", icon: require("../../assets/images/icons/phonepe.png") },
  { key: "PAYTM", label: "Paytm", icon: require("../../assets/images/icons/paytm.png") },
  { key: "OTHER", label: "Other", icon: require("../../assets/images/icons/other_upi.png") },
];

const TIP_PRESETS = [0, 50, 100, 200];

// ─── Component ───

export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);

  // Payment state
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [upiSubMethod, setUpiSubMethod] = useState("GPAY");
  const [tipAmount, setTipAmount] = useState(0);
  const [customTip, setCustomTip] = useState("");
  const [isCustomTip, setIsCustomTip] = useState(false);
  const [tenderedAmount, setTenderedAmount] = useState("");

  // Split payment state
  const [splits, setSplits] = useState<PaymentSplitInput[]>([
    { mode: "CASH", amount: 0 },
    { mode: "UPI", amount: 0 },
  ]);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  const fetchOrder = async () => {
    try {
      const data = await getOrder(id);
      setOrder(data);

      // Guard: if order is already completed, alert and go back
      if (data.status === "COMPLETED" || data.status === "CANCELLED") {
        Alert.alert(
          "Already Settled",
          `This order is already ${data.status.toLowerCase()}.`,
          [{ text: "OK", onPress: () => router.back() }]
        );
      }
    } catch (err) {
      console.error("Failed to fetch order", err);
      Alert.alert("Error", "Could not load order.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Computed values
  const grandTotal = useMemo(() => {
    if (!order) return 0;
    return Number(order.totalAmount);
  }, [order]);

  const effectiveTip = useMemo(() => {
    if (isCustomTip) {
      const parsed = parseFloat(customTip);
      return isNaN(parsed) || parsed < 0 ? 0 : parsed;
    }
    return tipAmount;
  }, [isCustomTip, customTip, tipAmount]);

  const payableTotal = useMemo(() => {
    return grandTotal + effectiveTip;
  }, [grandTotal, effectiveTip]);

  const changeDue = useMemo(() => {
    if (paymentMode !== "CASH") return 0;
    const tendered = parseFloat(tenderedAmount);
    if (isNaN(tendered) || tendered < payableTotal) return 0;
    return Math.round((tendered - payableTotal) * 100) / 100;
  }, [paymentMode, tenderedAmount, payableTotal]);

  // Split helpers
  const updateSplit = (index: number, field: "mode" | "amount", value: string | number) => {
    setSplits((prev) => {
      const next = [...prev];
      if (field === "mode") next[index] = { ...next[index]!, mode: value as string };
      else next[index] = { ...next[index]!, amount: Number(value) || 0 };
      return next;
    });
  };

  const addSplitLeg = () => {
    setSplits((prev) => [...prev, { mode: "CASH", amount: 0 }]);
  };

  const removeSplitLeg = (index: number) => {
    if (splits.length <= 2) return; // Minimum 2 legs
    setSplits((prev) => prev.filter((_, i) => i !== index));
  };

  const splitTotal = useMemo(() => {
    return splits.reduce((sum, s) => sum + s.amount, 0);
  }, [splits]);

  const splitRemaining = useMemo(() => {
    return Math.round((payableTotal - splitTotal) * 100) / 100;
  }, [payableTotal, splitTotal]);

  // ─── Settle Handler ───

  const handleSettle = async () => {
    if (!order) return;
    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      Alert.alert("Error", "This order is already settled.");
      return;
    }

    // Validate cash tendered
    if (paymentMode === "CASH" && tenderedAmount) {
      const tendered = parseFloat(tenderedAmount);
      if (tendered < payableTotal) {
        Alert.alert(
          "Insufficient Amount",
          `Tendered ₹${tendered.toFixed(0)} is less than payable ₹${payableTotal.toFixed(0)}.`
        );
        return;
      }
    }

    // Validate split payments
    if (paymentMode === "SPLIT") {
      if (Math.abs(splitRemaining) > 0.01) {
        Alert.alert(
          "Split Mismatch",
          `Split amounts don't add up. ₹${splitRemaining.toFixed(0)} remaining.`
        );
        return;
      }
      for (const split of splits) {
        if (split.amount <= 0) {
          Alert.alert("Invalid Split", "Each payment leg must have a positive amount.");
          return;
        }
      }
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSettling(true);

    try {
      const result = await checkoutOrder(order.id, {
        paymentMode,
        paymentSubMethod: paymentMode === "UPI" ? upiSubMethod : undefined,
        paymentSplits: paymentMode === "SPLIT" ? splits : undefined,
        tipAmount: effectiveTip > 0 ? effectiveTip : undefined,
        tenderedAmount: paymentMode === "CASH" && tenderedAmount ? parseFloat(tenderedAmount) : undefined,
        changeDue: paymentMode === "CASH" && changeDue > 0 ? changeDue : undefined,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Alert.alert(
        "Payment Received",
        `${result.invoiceNumber}\n₹${Number(result.totalAmount).toFixed(0)} via ${result.paymentMode}`,
        [
          {
            text: "Done",
            onPress: () => router.replace(`/order/${order.id}`),
          },
        ]
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Checkout failed. Please try again.";
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Checkout Failed", message);
    } finally {
      setSettling(false);
    }
  };

  // ─── Render ───

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Order not found.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Settle #{order.orderNumber}</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ─── Order Summary ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.card}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Items</Text>
              <Text style={styles.summaryValue}>{order.items.length}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>₹{Number(order.subtotal).toFixed(0)}</Text>
            </View>
            {Number(order.discountAmount) > 0 && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.success }]}>Discount</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>
                  -₹{Number(order.discountAmount).toFixed(0)}
                </Text>
              </View>
            )}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Taxes</Text>
              <Text style={styles.summaryValue}>₹{Number(order.taxAmount).toFixed(0)}</Text>
            </View>
            <View style={[styles.summaryRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>₹{grandTotal.toFixed(0)}</Text>
            </View>
          </View>
        </View>

        {/* ─── Payment Mode ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <View style={styles.paymentGrid}>
            {PAYMENT_MODES.map((mode) => (
              <Pressable
                key={mode.key}
                style={[
                  styles.paymentModeBtn,
                  paymentMode === mode.key && styles.paymentModeBtnActive,
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setPaymentMode(mode.key);
                }}
              >
                <Image source={mode.icon} style={styles.paymentModeImg} resizeMode="contain" />
                <Text
                  style={[
                    styles.paymentModeLabel,
                    paymentMode === mode.key && styles.paymentModeLabelActive,
                  ]}
                >
                  {mode.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ─── UPI Sub-method ─── */}
        {paymentMode === "UPI" && (
          <View style={styles.section}>
            <View style={styles.upiCard}>
              <View style={styles.upiIconContainer}>
                <Image
                  source={require("../../assets/images/icons/upi.png")}
                  style={styles.upiBigImg}
                  resizeMode="contain"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.upiAmountLabel}>Request UPI Payment</Text>
                <Text style={styles.upiAmountValue}>₹{payableTotal.toFixed(0)}</Text>
                <Text style={styles.upiInstruction}>
                  Collect payment on table QR or captain soundbox
                </Text>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>UPI App (for records)</Text>
            <View style={styles.upiGrid}>
              {UPI_SUB_METHODS.map((sub) => (
                <Pressable
                  key={sub.key}
                  style={[
                    styles.upiChip,
                    upiSubMethod === sub.key && styles.upiChipActive,
                  ]}
                  onPress={() => setUpiSubMethod(sub.key)}
                >
                  <Image source={sub.icon} style={styles.upiChipImg} resizeMode="contain" />
                  <Text
                    style={[
                      styles.upiChipText,
                      upiSubMethod === sub.key && styles.upiChipTextActive,
                    ]}
                  >
                    {sub.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* ─── Cash Tendered ─── */}
        {paymentMode === "CASH" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cash Tendered</Text>
            <TextInput
              style={styles.amountInput}
              keyboardType="numeric"
              placeholder={`₹${payableTotal.toFixed(0)} or more`}
              placeholderTextColor={colors.textTertiary}
              value={tenderedAmount}
              onChangeText={setTenderedAmount}
            />
            {tenderedAmount && parseFloat(tenderedAmount) >= payableTotal && (
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>Change Due</Text>
                <Text style={styles.changeValue}>₹{changeDue.toFixed(0)}</Text>
              </View>
            )}
          </View>
        )}

        {/* ─── Split Payment ─── */}
        {paymentMode === "SPLIT" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Split Details</Text>
            <View style={styles.card}>
              {splits.map((split, index) => (
                <View key={index} style={styles.splitRow}>
                  <View style={styles.splitModeSelector}>
                    {(
                      [
                        { key: "CASH", label: "Cash", icon: require("../../assets/images/icons/cash.png") },
                        { key: "CARD", label: "Card", icon: require("../../assets/images/icons/card.png") },
                        { key: "UPI", label: "UPI", icon: require("../../assets/images/icons/upi.png") },
                      ] as const
                    ).map((m) => (
                      <Pressable
                        key={m.key}
                        style={[
                          styles.splitModeChip,
                          split.mode === m.key && styles.splitModeChipActive,
                        ]}
                        onPress={() => updateSplit(index, "mode", m.key)}
                      >
                        <Image source={m.icon} style={styles.splitModeImg} resizeMode="contain" />
                        <Text
                          style={[
                            styles.splitModeChipText,
                            split.mode === m.key && styles.splitModeChipTextActive,
                          ]}
                        >
                          {m.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.splitAmountRow}>
                    <TextInput
                      style={styles.splitAmountInput}
                      keyboardType="numeric"
                      placeholder="₹ Amount"
                      placeholderTextColor={colors.textTertiary}
                      value={split.amount > 0 ? split.amount.toString() : ""}
                      onChangeText={(v) => updateSplit(index, "amount", v)}
                    />
                    {splits.length > 2 && (
                      <Pressable
                        style={styles.removeSplitBtn}
                        onPress={() => removeSplitLeg(index)}
                      >
                        <Ionicons name="close" size={16} color={colors.danger} />
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}

              <Pressable style={styles.addSplitBtn} onPress={addSplitLeg}>
                <Text style={styles.addSplitText}>+ Add Payment Leg</Text>
              </Pressable>

              <View style={[styles.summaryRow, { marginTop: spacing.md }]}>
                <Text style={styles.summaryLabel}>Split Total</Text>
                <Text
                  style={[
                    styles.summaryValue,
                    Math.abs(splitRemaining) > 0.01 && { color: colors.danger },
                  ]}
                >
                  ₹{splitTotal.toFixed(0)}
                </Text>
              </View>
              {Math.abs(splitRemaining) > 0.01 && (
                <Text style={styles.splitWarning}>
                  {splitRemaining > 0
                    ? `₹${splitRemaining.toFixed(0)} remaining`
                    : `₹${Math.abs(splitRemaining).toFixed(0)} over`}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* ─── Tip ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tip (Optional)</Text>
          <View style={styles.tipGrid}>
            {TIP_PRESETS.map((preset) => (
              <Pressable
                key={preset}
                style={[
                  styles.tipChip,
                  !isCustomTip && tipAmount === preset && styles.tipChipActive,
                ]}
                onPress={() => {
                  setIsCustomTip(false);
                  setTipAmount(preset);
                  setCustomTip("");
                }}
              >
                <Text
                  style={[
                    styles.tipChipText,
                    !isCustomTip && tipAmount === preset && styles.tipChipTextActive,
                  ]}
                >
                  {preset === 0 ? "No Tip" : `₹${preset}`}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.tipChip, isCustomTip && styles.tipChipActive]}
              onPress={() => {
                setIsCustomTip(true);
                setTipAmount(0);
              }}
            >
              <Text style={[styles.tipChipText, isCustomTip && styles.tipChipTextActive]}>
                Custom
              </Text>
            </Pressable>
          </View>
          {isCustomTip && (
            <TextInput
              style={styles.amountInput}
              keyboardType="numeric"
              placeholder="Enter tip amount"
              placeholderTextColor={colors.textTertiary}
              value={customTip}
              onChangeText={setCustomTip}
              autoFocus
            />
          )}
        </View>

        {/* ─── Payable Total ─── */}
        <View style={styles.payableTotalCard}>
          <Text style={styles.payableTotalLabel}>Total Payable</Text>
          <Text style={styles.payableTotalValue}>₹{payableTotal.toFixed(0)}</Text>
          {effectiveTip > 0 && (
            <Text style={styles.payableTipNote}>
              Includes ₹{effectiveTip.toFixed(0)} tip
            </Text>
          )}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ─── Settle Footer ─── */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.settleButton,
            pressed && styles.settleButtonPressed,
            settling && styles.settleButtonDisabled,
          ]}
          onPress={handleSettle}
          disabled={settling}
        >
          {settling ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.settleButtonText}>
              Settle ₹{payableTotal.toFixed(0)}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  errorText: { color: colors.danger, fontSize: fontSize.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingTop: 60,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: spacing.xs },
  backButtonText: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  scrollContent: { padding: spacing.md, gap: spacing.lg },

  // Sections
  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },

  // Summary
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  summaryLabel: { color: colors.textSecondary, fontSize: fontSize.md },
  summaryValue: { color: colors.textPrimary, fontSize: fontSize.md },
  grandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  grandTotalLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  grandTotalValue: {
    color: colors.accent,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },

  // Payment modes
  paymentGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  paymentModeBtn: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: 4,
  },
  paymentModeBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  paymentModeImg: {
    width: 28,
    height: 28,
  },
  paymentModeLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  paymentModeLabelActive: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },

  // UPI sub-method
  upiCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  upiIconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  upiBigImg: {
    width: 38,
    height: 38,
  },
  upiAmountLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  upiAmountValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.accent },
  upiInstruction: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  upiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  upiChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  upiChipImg: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  upiChipActive: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accent,
  },
  upiChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  upiChipTextActive: { color: colors.accent, fontWeight: fontWeight.bold },

  // Cash tendered
  amountInput: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: "center",
  },
  changeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.successBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  changeLabel: { color: colors.success, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  changeValue: {
    color: colors.success,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },

  // Split payment
  splitRow: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  splitModeSelector: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  splitModeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput,
  },
  splitModeImg: {
    width: 14,
    height: 14,
  },
  splitModeChipActive: {
    backgroundColor: colors.accent,
  },
  splitModeChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  splitModeChipTextActive: { color: "#fff", fontWeight: fontWeight.bold },
  splitAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  splitAmountInput: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  removeSplitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.dangerBg,
    justifyContent: "center",
    alignItems: "center",
  },
  removeSplitText: {
    color: colors.danger,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  addSplitBtn: {
    padding: spacing.sm,
    alignItems: "center",
  },
  addSplitText: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  splitWarning: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: "center",
    marginTop: spacing.xs,
  },

  // Tip
  tipGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tipChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  tipChipActive: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accent,
  },
  tipChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tipChipTextActive: { color: colors.accent, fontWeight: fontWeight.bold },

  // Payable total
  payableTotalCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.accent,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.xs,
  },
  payableTotalLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  payableTotalValue: {
    color: colors.textPrimary,
    fontSize: fontSize.xxxl,
    fontWeight: fontWeight.extrabold,
  },
  payableTipNote: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: 40,
    backgroundColor: "rgba(9,9,11,0.95)",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settleButton: {
    backgroundColor: colors.success,
    padding: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  settleButtonPressed: { opacity: 0.8 },
  settleButtonDisabled: { opacity: 0.5 },
  settleButtonText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
});
