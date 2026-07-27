import React, { useEffect, useState, useCallback } from "react";
import { View, StyleSheet, FlatList, RefreshControl, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { listOrders, type OrderResponse } from "../../src/services/api";
import { OrderCard } from "../../src/components/OrderCard";
import { useAuthStore } from "../../src/stores/auth.store";
import { useDataStore } from "../../src/stores/data.store";
import { onSocketEvent } from "../../src/services/socket";
import { SOCKET_EVENTS } from "../../src/config/constants";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";

type FilterMode = "ACTIVE" | "PAST";

export default function OrdersScreen() {
  const [orders, setOrders] = useState<OrderResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("ACTIVE");
  
  const { tables } = useDataStore();
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const fetchMyOrders = useCallback(async () => {
    try {
      // Fetch up to 100 recent orders for the captain
      const data = await listOrders({ limit: 100, waiterId: user?.id });
      // Sort newest first
      const sorted = [...data].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setOrders(sorted);
    } catch (err) {
      console.error("Failed to fetch orders", err);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchMyOrders().finally(() => setLoading(false));

    // Listen to real-time order updates to keep the list fresh
    const unsubOrder = onSocketEvent(SOCKET_EVENTS.ORDER_UPDATED, () => {
      fetchMyOrders();
    });

    return () => {
      unsubOrder();
    };
  }, [fetchMyOrders]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchMyOrders();
    setRefreshing(false);
  };

  const activeStatuses = ["DRAFT", "PLACED", "IN_PROGRESS", "READY"];
  
  const filteredOrders = orders.filter(o => 
    filter === "ACTIVE" 
      ? activeStatuses.includes(o.status) 
      : !activeStatuses.includes(o.status)
  );

  return (
    <View style={styles.container}>
      <View style={styles.segmentContainer}>
        <Pressable 
          style={[styles.segment, filter === "ACTIVE" && styles.segmentActive]}
          onPress={() => setFilter("ACTIVE")}
        >
          <Text style={[styles.segmentText, filter === "ACTIVE" && styles.segmentTextActive]}>Active</Text>
        </Pressable>
        <Pressable 
          style={[styles.segment, filter === "PAST" && styles.segmentActive]}
          onPress={() => setFilter("PAST")}
        >
          <Text style={[styles.segmentText, filter === "PAST" && styles.segmentTextActive]}>Past</Text>
        </Pressable>
      </View>

      {!loading && filteredOrders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No {filter.toLowerCase()} orders found.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
          }
          renderItem={({ item }) => {
            const tableName = tables.find((t) => t.id === item.tableId)?.name;
            return (
              <OrderCard 
                order={item} 
                tableName={tableName} 
                onPress={(order) => router.push(`/order/${order.id}`)} 
              />
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  segmentContainer: { 
    flexDirection: "row", 
    padding: spacing.md, 
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radius.md,
  },
  segmentActive: {
    backgroundColor: colors.accentBg,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  segmentTextActive: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  listContent: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.medium },
});
