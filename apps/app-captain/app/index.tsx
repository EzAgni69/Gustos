import { View, Text, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.emoji}>🍽️</Text>
      <Text style={styles.title}>Gusto Captain</Text>
      <Text style={styles.subtitle}>Waiter App — Coming in Phase 3</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Tables</Text>
          <Text style={styles.statValue}>—</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>My Orders</Text>
          <Text style={styles.statValue}>—</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>KOTs</Text>
          <Text style={styles.statValue}>—</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#71717a",
    marginBottom: 48,
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
  },
  statCard: {
    backgroundColor: "#18181b",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#27272a",
    minWidth: 100,
  },
  statLabel: {
    fontSize: 12,
    color: "#71717a",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#ffffff",
  },
});
