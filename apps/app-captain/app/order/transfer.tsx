import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getTables, transferOrder, type TableResponse } from "../../src/services/api";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import * as Haptics from "expo-haptics";

export default function TransferTableScreen() {
  const { id, tableId: currentTableId } = useLocalSearchParams<{ id: string; tableId: string }>();
  const router = useRouter();

  const [tables, setTables] = useState<TableResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const data = await getTables();
      setTables(data);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to fetch tables");
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedTableId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      await transferOrder(currentTableId!, selectedTableId);
      Alert.alert("Success", "Table transferred successfully.", [
        { text: "OK", onPress: () => router.back() }
      ]);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to transfer table.");
    } finally {
      setSubmitting(false);
    }
  };

  const availableTables = tables.filter((t) => t.status === "AVAILABLE" && t.id !== currentTableId);
  const currentTable = tables.find((t) => t.id === currentTableId);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Transfer Table</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} />
        ) : (
          <>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Current Table</Text>
              <Text style={styles.infoValue}>{currentTable?.name || "Unknown"}</Text>
            </View>

            <Text style={styles.sectionTitle}>Select New Table</Text>

            {availableTables.length === 0 ? (
              <Text style={styles.emptyText}>No available tables to transfer to.</Text>
            ) : (
              <View style={styles.grid}>
                {availableTables.map((table) => {
                  const isSelected = selectedTableId === table.id;
                  return (
                    <Pressable
                      key={table.id}
                      style={[styles.tableCard, isSelected && styles.tableCardSelected]}
                      onPress={() => setSelectedTableId(table.id)}
                    >
                      <Text style={[styles.tableName, isSelected && styles.tableNameSelected]}>
                        {table.name}
                      </Text>
                      <Text style={[styles.tableCapacity, isSelected && styles.tableCapacitySelected]}>
                        {table.capacity} Pax
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.transferButton,
            pressed && styles.transferButtonPressed,
            (!selectedTableId || submitting) && styles.transferButtonDisabled,
          ]}
          onPress={handleTransfer}
          disabled={!selectedTableId || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.transferButtonText}>Confirm Transfer</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  backButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  content: { padding: spacing.lg, gap: spacing.lg },
  infoCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
  },
  infoLabel: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.xs },
  infoValue: { color: colors.textPrimary, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tableCard: {
    width: "30%",
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
  },
  tableCardSelected: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  tableName: { color: colors.textPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold, textAlign: "center" },
  tableNameSelected: { color: colors.accent },
  tableCapacity: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
  tableCapacitySelected: { color: colors.accent },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: "center", marginTop: spacing.xl },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: 40,
    backgroundColor: "rgba(9,9,11,0.9)",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  transferButton: { backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  transferButtonPressed: { opacity: 0.8 },
  transferButtonDisabled: { opacity: 0.5 },
  transferButtonText: { color: "#fff", fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
