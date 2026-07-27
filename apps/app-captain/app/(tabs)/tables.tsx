import React, { useEffect, useState } from "react";
import { View, StyleSheet, FlatList, RefreshControl, Text } from "react-native";
import { useRouter } from "expo-router";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore } from "../../src/stores/cart.store";
import { TableCard } from "../../src/components/TableCard";
import { colors, spacing, fontSize, fontWeight } from "../../src/config/theme";
import type { TableResponse } from "../../src/services/api";

export default function TablesScreen() {
  const { tables, fetchTables, tablesLoading } = useDataStore();
  const { setTable, clearCart } = useCartStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTables();
    setRefreshing(false);
  };

  const handleTablePress = (table: TableResponse) => {
    if (table.status === "AVAILABLE") {
      // Start a new order
      clearCart();
      setTable(table.id, table.name);
      router.push("/(tabs)/menu");
    } else if (table.currentOrderId) {
      // View existing order
      router.push(`/order/${table.currentOrderId}`);
    }
  };

  if (!tablesLoading && tables.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No tables configured.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={tables}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrapper}>
            <TableCard table={item} onPress={handleTablePress} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    padding: spacing.md,
  },
  row: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardWrapper: {
    flex: 1,
    maxWidth: "50%",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
});
