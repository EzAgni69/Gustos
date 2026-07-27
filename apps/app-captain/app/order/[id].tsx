import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { getOrder, fireKOT, type OrderResponse, type KOTResponse, type OrderItemResponse } from "../../src/services/api";
import { useCartStore } from "../../src/stores/cart.store";
import { onSocketEvent } from "../../src/services/socket";
import { SOCKET_EVENTS } from "../../src/config/constants";
import { StatusBadge } from "../../src/components/StatusBadge";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { setTable, setExistingOrder } = useCartStore();
  
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [firingKOT, setFiringKOT] = useState(false);

  useEffect(() => {
    fetchOrder();

    // Listen for real-time updates to this order
    const unsubOrder = onSocketEvent(SOCKET_EVENTS.ORDER_UPDATED, (data: any) => {
      if (data?.order?.id === id) {
        setOrder(data.order);
      }
    });

    const unsubKOT = onSocketEvent(SOCKET_EVENTS.KOT_STATUS_UPDATE, (data: any) => {
      // Re-fetch order to get updated KOT and Item statuses
      // We could patch the local state, but fetching is safer for consistency
      fetchOrder();
    });

    return () => {
      unsubOrder();
      unsubKOT();
    };
  }, [id]);

  const fetchOrder = async () => {
    try {
      const data = await getOrder(id);
      setOrder(data);
    } catch (err) {
      console.error("Failed to fetch order", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFireKOT = async () => {
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setFiringKOT(true);
    try {
      await fireKOT(order.id);
      await fetchOrder(); // Refresh to see new KOTs
    } catch (err) {
      console.error("Failed to fire KOT", err);
      Alert.alert("Error", "Failed to fire KOT. Please try again.");
    } finally {
      setFiringKOT(false);
    }
  };

  const handleAddItems = () => {
    if (!order) return;
    setTable(order.tableId || "takeaway", "Current Table"); // Ideally we fetch table name
    setExistingOrder(order.id);
    router.push("/(tabs)/menu");
  };

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

  // Group items by KOT
  const unassignedItems = order.items.filter(i => !i.kotId);
  const kotMap = new Map<string, { kot: KOTResponse, items: OrderItemResponse[] }>();
  
  order.kots.forEach(kot => {
    kotMap.set(kot.id, { kot, items: [] });
  });

  order.items.forEach(item => {
    if (item.kotId && kotMap.has(item.kotId)) {
      kotMap.get(item.kotId)!.items.push(item);
    }
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Order #{order.orderNumber}</Text>
        <StatusBadge status={order.status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Unsent Items (Pending KOT) */}
        {unassignedItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Unsent Items</Text>
              <Text style={styles.sectionSubtitle}>Requires KOT</Text>
            </View>
            <View style={styles.card}>
              {unassignedItems.map(item => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemQty}><Text style={styles.itemQtyText}>{item.quantity}x</Text></View>
                  <View style={styles.itemDetails}>
                    <Text style={styles.itemName}>{item.menuItemName}</Text>
                    {item.modifiers?.length > 0 && (
                      <Text style={styles.itemModifiers}>{JSON.parse(item.modifiers as any).join(", ")}</Text>
                    )}
                    {item.notes && <Text style={styles.itemNotes}>Note: {item.notes}</Text>}
                  </View>
                  <Text style={styles.itemPrice}>₹{(item.unitPrice * item.quantity).toFixed(0)}</Text>
                </View>
              ))}
            </View>

            <Pressable 
              style={({pressed}) => [styles.fireButton, pressed && styles.fireButtonPressed, firingKOT && styles.fireButtonDisabled]}
              onPress={handleFireKOT}
              disabled={firingKOT}
            >
              {firingKOT ? <ActivityIndicator color="#fff" /> : <Text style={styles.fireButtonText}>Fire KOT for Unsent Items</Text>}
            </Pressable>
          </View>
        )}

        {/* Existing KOTs */}
        {Array.from(kotMap.values()).map(({ kot, items }) => (
          <View key={kot.id} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{kot.kotNumber}</Text>
              <StatusBadge status={kot.status} />
            </View>
            <View style={styles.card}>
              {items.map(item => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemQty}><Text style={styles.itemQtyText}>{item.quantity}x</Text></View>
                  <View style={styles.itemDetails}>
                    <Text style={styles.itemName}>{item.menuItemName}</Text>
                    {item.modifiers?.length > 0 && (
                      <Text style={styles.itemModifiers}>{JSON.parse(item.modifiers as any).join(", ")}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>₹{order.subtotal.toFixed(0)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Taxes</Text>
              <Text style={styles.totalValue}>₹{order.taxAmount.toFixed(0)}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>₹{order.totalAmount.toFixed(0)}</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Add Items Button */}
      <View style={styles.floatingAction}>
        <Pressable 
          style={({pressed}) => [styles.addButton, pressed && styles.addButtonPressed]}
          onPress={handleAddItems}
        >
          <Text style={styles.addButtonText}>+ Add More Items</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  errorText: { color: colors.danger, fontSize: fontSize.lg },
  header: { 
    flexDirection: "row", alignItems: "center", padding: spacing.lg, 
    paddingTop: 60, backgroundColor: colors.bgCard, borderBottomWidth: 1, borderBottomColor: colors.border 
  },
  backButton: { marginRight: spacing.md, padding: spacing.xs },
  backButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  title: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textPrimary },
  scrollContent: { padding: spacing.md, gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  sectionSubtitle: { fontSize: fontSize.sm, color: colors.warning },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  itemRow: { flexDirection: "row", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  itemQty: { width: 30 },
  itemQtyText: { color: colors.accent, fontWeight: fontWeight.bold, fontSize: fontSize.md },
  itemDetails: { flex: 1 },
  itemName: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.medium },
  itemModifiers: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 2 },
  itemNotes: { fontSize: fontSize.sm, color: colors.warning, fontStyle: "italic", marginTop: 2 },
  itemPrice: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.medium },
  fireButton: { backgroundColor: colors.warning, padding: spacing.lg, borderRadius: radius.md, alignItems: "center", marginTop: spacing.md },
  fireButtonPressed: { opacity: 0.8 },
  fireButtonDisabled: { opacity: 0.5 },
  fireButtonText: { color: "#000", fontSize: fontSize.md, fontWeight: fontWeight.bold },
  totalsCard: { backgroundColor: colors.bgCard, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { color: colors.textSecondary, fontSize: fontSize.md },
  totalValue: { color: colors.textPrimary, fontSize: fontSize.md },
  grandTotalRow: { borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: spacing.sm, marginTop: spacing.xs },
  grandTotalLabel: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  grandTotalValue: { color: colors.textPrimary, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  floatingAction: { position: "absolute", bottom: 0, left: 0, right: 0, padding: spacing.lg, paddingBottom: 40, backgroundColor: "rgba(9,9,11,0.9)", borderTopWidth: 1, borderTopColor: colors.border },
  addButton: { backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  addButtonPressed: { opacity: 0.8 },
  addButtonText: { color: "#fff", fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
