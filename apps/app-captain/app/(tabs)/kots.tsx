import React, { useEffect, useState } from "react";
import { View, StyleSheet, FlatList, RefreshControl, Text, Alert, DeviceEventEmitter } from "react-native";
import { getKOTs, updateKOTStatus, type KOTResponse } from "../../src/services/api";
import { KOTCard } from "../../src/components/KOTCard";
import { colors, spacing, fontSize, fontWeight } from "../../src/config/theme";
import * as Haptics from "expo-haptics";

export default function KOTsScreen() {
  const [kots, setKots] = useState<KOTResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchKots = async () => {
    try {
      // Fetch all except SERVED, or fetch all and filter client-side
      const data = await getKOTs();
      // Only show active KOTs (not SERVED) in the main view
      setKots(data.filter(k => k.status !== "SERVED"));
    } catch (e) {
      console.error("Failed to fetch KOTs", e);
      Alert.alert("Error", "Could not load Kitchen Order Tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKots();
    
    const sub = DeviceEventEmitter.addListener("kotUpdated", () => {
      fetchKots();
    });

    return () => sub.remove();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchKots();
    setRefreshing(false);
  };

  const handleUpdateStatus = async (
    id: string,
    newStatus: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED"
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateKOTStatus(id, newStatus);
      fetchKots();
    } catch (e) {
      Alert.alert("Error", "Failed to update KOT status.");
    }
  };

  if (!loading && kots.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No active kitchen tickets.</Text>
        <Text style={styles.emptySubText}>Tickets will appear here when an order is fired.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={kots}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <KOTCard kot={item} onUpdateStatus={handleUpdateStatus} />
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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  emptySubText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
