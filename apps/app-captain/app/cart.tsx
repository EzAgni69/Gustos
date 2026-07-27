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
            <View key={item.menuItemId} style={styles.itemRow}>
              <View style={styles.itemDetails}>
                <Text style={styles.itemName}>{item.menuItemName}</Text>
                {item.modifiers.length > 0 && (
                  <Text style={styles.itemModifiers}>{item.modifiers.join(", ")}</Text>
                )}
                <Text style={styles.itemPrice}>₹{(item.unitPrice * item.quantity).toFixed(0)}</Text>
              </View>
              <View style={styles.itemActions}>
                <QuantityStepper 
                  quantity={item.quantity} 
                  onChange={(q) => updateQuantity(item.menuItemId, q)} 
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
            <Text style={styles.totalValue}>₹{getSubtotal().toFixed(0)}</Text>
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
  itemName: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.semibold },
  itemModifiers: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 4 },
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
