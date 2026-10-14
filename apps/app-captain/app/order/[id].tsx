import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, DeviceEventEmitter } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { getOrder, fireKOT, printBill, type OrderResponse, type KOTResponse, type OrderItemResponse } from "../../src/services/api";
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
  const [printingBill, setPrintingBill] = useState(false);

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

  const handlePrintBill = async () => {
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPrintingBill(true);
    try {
      await printBill(order.id);
      Alert.alert("Bill sent", "Bill sent to the WiFi printer.");
    } catch (err) {
      console.error("Failed to print bill", err);
      Alert.alert("Print failed", "Could not print the bill. Please check the printer connection.");
    } finally {
      setPrintingBill(false);
    }
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

  const parseModifiers = (mods: unknown): string[] => {
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
  };

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
              {unassignedItems.map(item => {
                const modifiers = parseModifiers(item.modifiers);
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemQty}><Text style={styles.itemQtyText}>{item.quantity}x</Text></View>
                    <View style={styles.itemDetails}>
                      <View style={styles.itemHeaderLine}>
                        <Text style={styles.itemName}>{item.menuItemName}</Text>
                        {item.variantName ? (
                          <View style={styles.variantBadge}>
                            <Text style={styles.variantBadgeText}>
                              {item.variantName === '12"' ? '12" L' : item.variantName === '8"' ? '8" R' : item.variantName}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {modifiers.length > 0 && (
                        <View style={styles.modifiersWrap}>
                          {modifiers.map((m, idx) => {
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

                      {item.notes && <Text style={styles.itemNotes}>📝 {item.notes}</Text>}
                    </View>
                    <Text style={styles.itemPrice}>₹{(item.unitPrice * item.quantity).toFixed(0)}</Text>
                  </View>
                );
              })}
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
              <View style={styles.kotHeaderRow}>
                <Text style={styles.sectionTitle}>{kot.kotNumber}</Text>
                {kot.station && (
                  <View style={styles.stationBadge}>
                    <Text style={styles.stationBadgeText}>{kot.station}</Text>
                  </View>
                )}
              </View>
              <StatusBadge status={kot.status} />
            </View>
            <View style={styles.card}>
              {items.map(item => {
                const modifiers = parseModifiers(item.modifiers);
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemQty}><Text style={styles.itemQtyText}>{item.quantity}x</Text></View>
                    <View style={styles.itemDetails}>
                      <View style={styles.itemHeaderLine}>
                        <Text style={styles.itemName}>{item.menuItemName}</Text>
                        {item.variantName ? (
                          <View style={styles.variantBadge}>
                            <Text style={styles.variantBadgeText}>
                              {item.variantName === '12"' ? '12" L' : item.variantName === '8"' ? '8" R' : item.variantName}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {modifiers.length > 0 && (
                        <View style={styles.modifiersWrap}>
                          {modifiers.map((m, idx) => {
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

                      {item.notes && <Text style={styles.itemNotes}>📝 {item.notes}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>₹{Number(order.subtotal).toFixed(0)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Taxes</Text>
              <Text style={styles.totalValue}>₹{Number(order.taxAmount).toFixed(0)}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>₹{Number(order.totalAmount).toFixed(0)}</Text>
            </View>
          </View>
        </View>

        {/* Transfer Table — only for non-completed dine-in orders */}
        {order.status !== "COMPLETED" && order.status !== "CANCELLED" && order.tableId && (
          <Pressable
            style={({pressed}) => [styles.transferButton, pressed && styles.transferButtonPressed]}
            onPress={() => router.push(`/order/transfer?id=${order.id}&tableId=${order.tableId}`)}
          >
            <Text style={styles.transferButtonText}>Transfer Table</Text>
          </Pressable>
        )}

        <Pressable
          style={({pressed}) => [styles.printButton, pressed && styles.printButtonPressed, printingBill && styles.printButtonDisabled]}
          onPress={handlePrintBill}
          disabled={printingBill}
        >
          {printingBill ? <ActivityIndicator color="#fff" /> : <Text style={styles.printButtonText}>Print Bill</Text>}
        </Pressable>

        {/* Settle Bill — only for non-completed orders */}
        {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
          <Pressable
            style={({pressed}) => [styles.settleButton, pressed && styles.settleButtonPressed]}
            onPress={() => router.push(`/order/checkout?id=${order.id}`)}
          >
            <Text style={styles.settleButtonText}>Settle Bill</Text>
          </Pressable>
        )}

        {order.status === "COMPLETED" && (
          <View style={styles.settledBanner}>
            <Text style={styles.settledBannerText}>✅ This order has been settled</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Add Items Button — hidden for completed/cancelled orders */}
      {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
        <View style={styles.floatingAction}>
          <Pressable 
            style={({pressed}) => [styles.addButton, pressed && styles.addButtonPressed]}
            onPress={handleAddItems}
          >
            <Text style={styles.addButtonText}>+ Add More Items</Text>
          </Pressable>
        </View>
      )}
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
  itemHeaderLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  itemName: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.medium },
  variantBadge: { backgroundColor: colors.accentBg, paddingHorizontal: spacing.xs, paddingVertical: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent },
  variantBadgeText: { fontSize: 10, color: colors.accent, fontWeight: fontWeight.bold },
  kotHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stationBadge: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  stationBadgeText: { fontSize: fontSize.xs, color: colors.accent, fontWeight: fontWeight.bold },
  modifiersWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3 },
  modPill: { backgroundColor: colors.bgInput, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  modPillHalf: { backgroundColor: "rgba(249, 115, 22, 0.15)", borderWidth: 1, borderColor: colors.accent },
  modPillDrink: { backgroundColor: "rgba(59, 130, 246, 0.15)", borderWidth: 1, borderColor: colors.info },
  modPillText: { fontSize: 11, color: colors.textSecondary },
  modPillTextHalf: { color: colors.accent, fontWeight: fontWeight.semibold },
  modPillTextDrink: { color: colors.info, fontWeight: fontWeight.semibold },
  itemNotes: { fontSize: fontSize.sm, color: colors.warning, fontStyle: "italic", marginTop: 2 },
  itemPrice: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.medium },
  fireButton: { backgroundColor: colors.warning, padding: spacing.lg, borderRadius: radius.md, alignItems: "center", marginTop: spacing.md },
  fireButtonPressed: { opacity: 0.8 },
  fireButtonDisabled: { opacity: 0.5 },
  fireButtonText: { color: "#000", fontSize: fontSize.md, fontWeight: fontWeight.bold },
  printButton: { backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  printButtonPressed: { opacity: 0.8 },
  printButtonDisabled: { opacity: 0.5 },
  printButtonText: { color: "#fff", fontSize: fontSize.md, fontWeight: fontWeight.bold },
  settleButton: { backgroundColor: colors.success, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  settleButtonPressed: { opacity: 0.8 },
  settleButtonText: { color: "#fff", fontSize: fontSize.md, fontWeight: fontWeight.bold },
  transferButton: { backgroundColor: colors.info, padding: spacing.lg, borderRadius: radius.md, alignItems: "center", marginBottom: spacing.md },
  transferButtonPressed: { opacity: 0.8 },
  transferButtonText: { color: "#fff", fontSize: fontSize.md, fontWeight: fontWeight.bold },
  settledBanner: { backgroundColor: colors.successBg, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  settledBannerText: { color: colors.success, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
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
