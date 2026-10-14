import React, { useEffect, useState } from "react";
import { View, StyleSheet, FlatList, RefreshControl, Text, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore } from "../../src/stores/cart.store";
import { TableCard } from "../../src/components/TableCard";
import { colors, spacing, fontSize, fontWeight } from "../../src/config/theme";
import { updateTableStatus, getAllReservations, type TableResponse, type ReservationResponse } from "../../src/services/api";

export default function TablesScreen() {
  const { tables, fetchTables, tablesLoading } = useDataStore();
  const { setTable, clearCart } = useCartStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [reservations, setReservations] = useState<ReservationResponse[]>([]);

  const loadData = async () => {
    await fetchTables();
    try {
      const res = await getAllReservations();
      setReservations(res);
    } catch (e) {
      console.error("Failed to load reservations", e);
    }
  };

  useEffect(() => {
    loadData();
  }, [fetchTables]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleTablePress = (table: TableResponse) => {
    Alert.alert(
      `Table: ${table.name}`,
      `What would you like to do?`,
      [
        {
          text: table.currentOrderId ? "View Order" : "Start Order",
          onPress: () => {
            if (table.currentOrderId) {
              router.push(`/order/${table.currentOrderId}`);
            } else {
              clearCart();
              setTable(table.id, table.name);
              router.push("/(tabs)/menu");
            }
          },
        },
          ...(table.currentOrderId ? [{
            text: "Add Items",
            onPress: () => {
              clearCart();
              setTable(table.id, table.name);
              useCartStore.getState().setExistingOrder(table.currentOrderId!);
              router.push("/(tabs)/menu");
            }
          }] : []),
          {
            text: "Reserve Table",
            onPress: () => {
              router.push(`/reserve/${table.id}`);
            },
          },
          {
            text: "Mark as Available",
            onPress: async () => {
              try {
                await updateTableStatus(table.id, "AVAILABLE");
                fetchTables();
              } catch (e) {
                Alert.alert("Error", "Could not update table status.");
              }
            },
            style: "destructive",
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
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
            <TableCard 
              table={item} 
              reservations={reservations.filter(r => r.tableId === item.id)}
              onPress={handleTablePress} 
            />
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
