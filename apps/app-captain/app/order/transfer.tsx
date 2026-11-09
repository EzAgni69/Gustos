import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  getTables,
  transferOrder,
  swapTables,
  mergeTables,
  type TableResponse,
} from "../../src/services/api";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import * as Haptics from "expo-haptics";

/**
 * Table actions for an open order:
 *  - Move:  shift this order to an empty table
 *  - Swap:  exchange orders with another occupied table (guests switch seats)
 *  - Merge: combine two occupied tables' bills into one (Table 4 joins Table 3)
 */
type Mode = "move" | "swap" | "merge";
/** into: this bill goes into the picked table's bill. from: the picked table's bill comes into this one. */
type MergeDirection = "into" | "from";

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "move", label: "Move", hint: "Pick an empty table" },
  { key: "swap", label: "Swap", hint: "Pick an occupied table — the two orders trade places" },
  { key: "merge", label: "Merge", hint: "Pick an occupied table to combine bills with" },
];

export default function TransferTableScreen() {
  const { id, tableId: currentTableId, mode: initialMode } = useLocalSearchParams<{
    id: string;
    tableId: string;
    mode?: Mode;
  }>();
  const router = useRouter();

  const [tables, setTables] = useState<TableResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>(
    initialMode === "swap" || initialMode === "merge" ? initialMode : "move"
  );
  const [mergeDirection, setMergeDirection] = useState<MergeDirection>("into");
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

  const changeMode = (next: Mode) => {
    if (next === mode) return;
    Haptics.selectionAsync().catch(() => {});
    setMode(next);
    setSelectedTableId(null);
  };

  const currentTable = tables.find((t) => t.id === currentTableId);
  const selectedTable = tables.find((t) => t.id === selectedTableId);

  const candidateTables = tables.filter((t) => {
    if (t.id === currentTableId) return false;
    return mode === "move" ? t.status === "AVAILABLE" && !t.currentOrderId : !!t.currentOrderId;
  });

  const run = async (action: () => Promise<void>) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSubmitting(true);
    try {
      await action();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert("Error", e?.message || "Something went wrong. Please try again.");
      fetchTables(); // table states may have changed under us
    } finally {
      setSubmitting(false);
    }
  };

  const handleMove = () =>
    run(async () => {
      await transferOrder(currentTableId!, selectedTableId!);
      Alert.alert("Moved", `Order moved to ${selectedTable?.name}.`, [{ text: "OK", onPress: () => router.back() }]);
    });

  const handleSwap = () => {
    const a = currentTable?.name ?? "this table";
    const b = selectedTable?.name ?? "the other table";
    Alert.alert("Swap tables?", `${a}'s order moves to ${b}, and ${b}'s order moves to ${a}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Swap",
        onPress: () =>
          run(async () => {
            await swapTables(currentTableId!, selectedTableId!);
            Alert.alert("Swapped", `${a} ⇄ ${b}`, [{ text: "OK", onPress: () => router.back() }]);
          }),
      },
    ]);
  };

  const handleMerge = () => {
    if (!selectedTable || !currentTable) return;
    const source = mergeDirection === "into" ? currentTable : selectedTable;
    const target = mergeDirection === "into" ? selectedTable : currentTable;
    Alert.alert(
      `Merge ${source.name} into ${target.name}?`,
      `All items on ${source.name}'s bill move onto ${target.name}'s bill and ${source.name} is freed. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge",
          style: "destructive",
          onPress: () =>
            run(async () => {
              const merged = await mergeTables(source.id, target.id);
              const targetOrderId = merged?.id ?? target.currentOrderId;
              Alert.alert("Merged", `${source.name} merged into ${target.name}.`, [
                {
                  text: "OK",
                  // This order no longer exists if it was the source — land on the combined bill.
                  onPress: () => {
                    router.back();
                    if (source.id === currentTableId && targetOrderId) {
                      // Replace the now-merged order screen underneath with the combined bill.
                      router.replace(`/order/${targetOrderId}`);
                    }
                  },
                },
              ]);
            }),
        },
      ]
    );
  };

  const onConfirm = mode === "move" ? handleMove : mode === "swap" ? handleSwap : handleMerge;

  const confirmLabel = (() => {
    if (!selectedTable) return mode === "move" ? "Select a table" : "Select an occupied table";
    const here = currentTable?.name ?? "This table";
    if (mode === "move") return `Move to ${selectedTable.name}`;
    if (mode === "swap") return `Swap ${here} ⇄ ${selectedTable.name}`;
    return mergeDirection === "into"
      ? `Merge ${here} → ${selectedTable.name}`
      : `Merge ${selectedTable.name} → ${here}`;
  })();

  const emptyText =
    mode === "move" ? "No empty tables to move to." : "No other occupied tables right now.";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Table Actions</Text>
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
              {currentTable?.currentOrder && (
                <Text style={styles.infoMeta}>
                  #{currentTable.currentOrder.orderNumber.split("-").pop()} · ₹
                  {Number(currentTable.currentOrder.totalAmount).toFixed(0)}
                </Text>
              )}
            </View>

            {/* Mode switch */}
            <View style={styles.segment} accessibilityRole="tablist">
              {MODES.map((m) => {
                const active = m.key === mode;
                return (
                  <Pressable
                    key={m.key}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                    onPress={() => changeMode(m.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {mode === "merge" && (
              <View style={styles.directionRow}>
                {(["into", "from"] as MergeDirection[]).map((d) => {
                  const active = d === mergeDirection;
                  return (
                    <Pressable
                      key={d}
                      style={[styles.directionChip, active && styles.directionChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setMergeDirection(d);
                      }}
                    >
                      <Text style={[styles.directionText, active && styles.directionTextActive]}>
                        {d === "into" ? "Send this bill into…" : "Bring a bill here from…"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.sectionTitle}>{MODES.find((m) => m.key === mode)!.hint}</Text>

            {candidateTables.length === 0 ? (
              <Text style={styles.emptyText}>{emptyText}</Text>
            ) : (
              <View style={styles.grid}>
                {candidateTables.map((table) => {
                  const isSelected = selectedTableId === table.id;
                  const o = table.currentOrder;
                  return (
                    <Pressable
                      key={table.id}
                      style={[styles.tableCard, isSelected && styles.tableCardSelected]}
                      onPress={() => setSelectedTableId(table.id)}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.tableName, isSelected && styles.tableNameSelected]}>
                        {table.name}
                      </Text>
                      <Text style={[styles.tableCapacity, isSelected && styles.tableCapacitySelected]}>
                        {o ? `₹${Number(o.totalAmount).toFixed(0)}` : `${table.capacity} Pax`}
                      </Text>
                      {o?.waiterName ? (
                        <Text style={styles.tableWaiter} numberOfLines={1}>
                          {o.waiterName}
                        </Text>
                      ) : null}
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
            mode === "merge" && styles.mergeButton,
            pressed && styles.transferButtonPressed,
            (!selectedTableId || submitting) && styles.transferButtonDisabled,
          ]}
          onPress={onConfirm}
          disabled={!selectedTableId || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.transferButtonText} numberOfLines={1}>
              {confirmLabel}
            </Text>
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
  infoMeta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
  },
  segmentItem: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segmentItemActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  segmentTextActive: { color: "#fff" },
  directionRow: { flexDirection: "row", gap: spacing.sm },
  directionChip: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  directionChipActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  directionText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium, textAlign: "center" },
  directionTextActive: { color: colors.accent },
  tableWaiter: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  mergeButton: { backgroundColor: colors.danger },
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
