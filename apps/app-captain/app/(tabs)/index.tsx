import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/stores/auth.store";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore } from "../../src/stores/cart.store";
import { listOrders, getBaseUrl } from "../../src/services/api";
import { onSocketEvent } from "../../src/services/socket";
import { SOCKET_EVENTS } from "../../src/config/constants";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import { Ionicons } from "@expo/vector-icons";

export default function DashboardScreen() {
  const { user } = useAuthStore();
  const { tables, fetchTables } = useDataStore();
  const { clearCart } = useCartStore();
  const router = useRouter();

  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!getBaseUrl()) return;
    try {
      await fetchTables();
      const orders = await listOrders({ limit: 100, waiterId: user?.id });
      const activeStatuses = ["DRAFT", "PLACED", "IN_PROGRESS", "READY"];
      const activeCount = orders.filter(o => activeStatuses.includes(o.status)).length;
      setActiveOrdersCount(activeCount);
    } catch (err) {
      console.error("Failed to fetch dashboard stats", err);
    }
  }, [user?.id, fetchTables]);

  useEffect(() => {
    fetchStats().finally(() => setLoading(false));

    const unsubOrder = onSocketEvent(SOCKET_EVENTS.ORDER_UPDATED, () => {
      fetchStats();
    });

    return () => {
      unsubOrder();
    };
  }, [fetchStats]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  const occupiedTablesCount = tables.filter(t => t.status === "OCCUPIED" || t.status === "RESERVED").length;
  const availableTablesCount = tables.filter(t => t.status === "AVAILABLE").length;

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
    >
      <Text style={styles.sectionTitle}>Shift Overview</Text>
      
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginVertical: spacing.xl }} />
      ) : (
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
              <Ionicons name="time" size={24} color="#3b82f6" />
            </View>
            <Text style={styles.statValue}>{activeOrdersCount}</Text>
            <Text style={styles.statLabel}>Active Orders</Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Ionicons name="people" size={24} color="#ef4444" />
            </View>
            <Text style={styles.statValue}>{occupiedTablesCount}</Text>
            <Text style={styles.statLabel}>Busy Tables</Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(34, 197, 94, 0.1)' }]}>
              <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
            </View>
            <Text style={styles.statValue}>{availableTablesCount}</Text>
            <Text style={styles.statLabel}>Available Tables</Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      
      <View style={styles.actionsContainer}>
        <Pressable 
          style={styles.actionButton}
          onPress={() => {
            router.push("/(tabs)/tables");
          }}
        >
          <View style={[styles.actionIconBox, { backgroundColor: colors.accent }]}>
            <Ionicons name="add" size={24} color="#fff" />
          </View>
          <Text style={styles.actionText}>New Dine-In</Text>
        </Pressable>

        <Pressable 
          style={styles.actionButton}
          onPress={() => {
            clearCart();
            router.push("/(tabs)/menu");
          }}
        >
          <View style={[styles.actionIconBox, { backgroundColor: "#f59e0b" }]}>
            <Ionicons name="bag-handle" size={24} color="#fff" />
          </View>
          <Text style={styles.actionText}>Takeaway</Text>
        </Pressable>

        <Pressable 
          style={styles.actionButton}
          onPress={() => {
            router.push("/(tabs)/orders");
          }}
        >
          <View style={[styles.actionIconBox, { backgroundColor: "#8b5cf6" }]}>
            <Ionicons name="clipboard" size={24} color="#fff" />
          </View>
          <Text style={styles.actionText}>View Orders</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  contentContainer: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    minWidth: "30%",
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: "center",
  },
  actionsContainer: {
    gap: spacing.md,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgCard,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  actionText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  }
});
