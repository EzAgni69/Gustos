import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCartStore } from "../src/stores/cart.store";
import { useAuthStore } from "../src/stores/auth.store";
import { createOrder, addItemsToOrder, fireKOT } from "../src/services/api";
import { QuantityStepper } from "../src/components/QuantityStepper";
import { colors, spacing, fontSize, fontWeight, radius } from "../src/config/theme";

export default function CartScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { 
    items, 
    tableName, 
    tableId, 
    paxCount, 
    setPaxCount, 
    orderNotes, 
    setOrderNotes, 
    removeItem, 
    updateQuantity, 
    getSubtotal, 
    toAddItemInputs, 
    clearCart,
    existingOrderId 
  } = useCartStore();

  const [loading, setLoading] = useState(false);

  const handlePlaceOrder = async () => {
    if (items.length === 0) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setLoading(true);

    try {
      let orderId = existingOrderId;

      // 1. Create order if it doesn't exist
      if (!orderId) {
        const order = await createOrder({
          orderMode: tableId ? "DINE_IN" : "TAKEAWAY",
          tableId: tableId ?? undefined,
          waiterId: user?.id,
          waiterName: user?.name,
          paxCount,
          notes: orderNotes,
        });
        orderId = order.id;
      }

      // 2. Add items to order
      const itemInputs = toAddItemInputs();
      await addItemsToOrder(orderId, itemInputs);

      // 3. Fire KOT for these new items
      await fireKOT(orderId);

      // Success!
      clearCart();
      router.replace(`/order/${orderId}`);

    } catch (err) {
      console.error("Failed to place order", err);
      Alert.alert("Error", "Failed to place order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>Cart is empty</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to Menu</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
        <Text style={styles.title}>Review Order</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Table & Pax Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Table</Text>
            <Text style={styles.infoValue}>{tableName || "Takeaway"}</Text>
          </View>
          {!existingOrderId && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Pax</Text>
              <QuantityStepper quantity={paxCount} onChange={setPaxCount} min={1} max={20} />
            </View>
          )}
        </View>

        {/* Items List */}
        <Text style={styles.sectionTitle}>Items ({items.reduce((s, i) => s + i.quantity, 0)})</Text>
        <View style={styles.itemsCard}>
          {items.map((item) => (
            <View key={item.cartKey} style={styles.itemRow}>
              <View style={styles.itemDetails}>
                <View style={styles.itemNameRow}>
                  <Text style={styles.itemName}>{item.menuItemName}</Text>
                  {item.variantName ? (
                    <View style={styles.variantBadge}>
                      <Text style={styles.variantBadgeText}>
                        {item.variantName === '12"' ? '12" L' : item.variantName === '8"' ? '8" R' : item.variantName}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {item.addOns.length > 0 && (
                  <View style={styles.addOnsList}>
                    {item.addOns.map((ao) => (
                      <Text key={ao.name} style={styles.addOnText}>
                        + {ao.name} ×{ao.quantity} (₹{(ao.unitPrice * ao.quantity).toFixed(0)})
                      </Text>
                    ))}
                  </View>
                )}

                {item.modifiers.length > 0 && (
                  <View style={styles.modifiersWrap}>
                    {item.modifiers.map((m, idx) => {
                      const isHalf = m.startsWith("L:") && m.includes("R:");
                      const isDrink = m.startsWith("Drink:");
                      return (
                        <View
                          key={idx}
                          style={[
                            styles.modPill,
                            isHalf && styles.modPillHalf,
                            isDrink && styles.modPillDrink,
                          ]}
                        >
                          <Text
                            style={[
                              styles.modPillText,
                              isHalf && styles.modPillTextHalf,
                              isDrink && styles.modPillTextDrink,
                            ]}
                          >
                            {m}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {item.notes ? (
                  <Text style={styles.itemNotes}>📝 {item.notes}</Text>
                ) : null}

                <Text style={styles.itemPrice}>
                  ₹{((item.unitPrice + item.addOns.reduce((s, a) => s + a.unitPrice * a.quantity, 0)) * item.quantity).toFixed(0)}
                </Text>
              </View>
              <View style={styles.itemActions}>
                <QuantityStepper 
                  quantity={item.quantity} 
                  onChange={(q) => updateQuantity(item.cartKey, q)} 
                />
              </View>
            </View>
          ))}
        </View>

        {/* Notes */}
        {!existingOrderId && (
          <>
            <Text style={styles.sectionTitle}>Order Notes</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="e.g. VIP guest, serve starters quickly..."
              placeholderTextColor={colors.textTertiary}
              value={orderNotes}
              onChangeText={setOrderNotes}
              multiline
              numberOfLines={3}
            />
          </>
        )}

        {/* Totals */}
        <View style={styles.totalsCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>₹{Number(getSubtotal()).toFixed(0)}</Text>
          </View>
          <Text style={styles.taxNote}>+ Taxes calculated upon order creation</Text>
        </View>
      </ScrollView>

      {/* Action Footer */}
      <View style={styles.footer}>
        <Pressable 
          style={({pressed}) => [styles.placeButton, pressed && styles.placeButtonPressed, loading && styles.placeButtonDisabled]}
          onPress={handlePlaceOrder}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.placeButtonText}>Place Order & Fire KOT</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.lg, marginBottom: spacing.xl },
  backButton: { padding: spacing.md },
  backButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, paddingTop: 60, backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeButton: { padding: spacing.xs },
  closeButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  scrollContent: { padding: spacing.md, gap: spacing.lg, paddingBottom: 40 },
  infoCard: { backgroundColor: colors.bgCard, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { color: colors.textSecondary, fontSize: fontSize.md },
  infoValue: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary, marginLeft: spacing.xs },
  itemsCard: { backgroundColor: colors.bgCard, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  itemRow: { flexDirection: "row", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  itemDetails: { flex: 1, justifyContent: "center" },
  itemNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  itemName: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.semibold },
  variantBadge: { backgroundColor: colors.accentBg, paddingHorizontal: spacing.xs, paddingVertical: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent },
  variantBadgeText: { fontSize: 10, color: colors.accent, fontWeight: fontWeight.bold },
  addOnsList: { marginTop: 4 },
  addOnText: { fontSize: fontSize.xs, color: colors.info, marginTop: 1 },
  modifiersWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  modPill: { backgroundColor: colors.bgInput, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  modPillHalf: { backgroundColor: "rgba(249, 115, 22, 0.15)", borderWidth: 1, borderColor: colors.accent },
  modPillDrink: { backgroundColor: "rgba(59, 130, 246, 0.15)", borderWidth: 1, borderColor: colors.info },
  modPillText: { fontSize: 11, color: colors.textSecondary },
  modPillTextHalf: { color: colors.accent, fontWeight: fontWeight.semibold },
  modPillTextDrink: { color: colors.info, fontWeight: fontWeight.semibold },
  itemNotes: { fontSize: fontSize.sm, color: colors.warning, fontStyle: "italic", marginTop: 2 },
  itemPrice: { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 4 },
  itemActions: { justifyContent: "center" },
  notesInput: { backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.md, color: colors.textPrimary, minHeight: 80, fontSize: fontSize.md, textAlignVertical: "top" },
  totalsCard: { backgroundColor: colors.bgCard, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: "center" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginBottom: spacing.xs },
  totalLabel: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  totalValue: { color: colors.accent, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  taxNote: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: spacing.sm },
  footer: { padding: spacing.lg, paddingBottom: 40, backgroundColor: "rgba(9,9,11,0.9)", borderTopWidth: 1, borderTopColor: colors.border },
  placeButton: { backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  placeButtonPressed: { opacity: 0.8 },
  placeButtonDisabled: { opacity: 0.5 },
  placeButtonText: { color: "#fff", fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
