import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useAuthStore } from "../../src/stores/auth.store";
import { getUsers } from "../../src/services/api";
import { PinPad } from "../../src/components/PinPad";
import { colors, fontSize, radius, spacing, fontWeight } from "../../src/config/theme";

interface UserOption {
  id: string;
  name: string;
  role: string;
}

export default function LoginScreen() {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { login, isLoading, logout } = useAuthStore();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const fetchedUsers = await getUsers();
      setUsers(fetchedUsers);
      // Auto-select first waiter if available
      const firstWaiter = fetchedUsers.find((u) => u.role === "WAITER") || fetchedUsers[0];
      if (firstWaiter) setSelectedUser(firstWaiter);
    } catch (err) {
      setError("Failed to load users. Is server running?");
    } finally {
      setLoadingUsers(false);
    }
  };

  const handlePinSubmit = async (pin: string) => {
    if (!selectedUser) return;
    setError(null);
    try {
      await login(pin);
      // Root layout handles nav
    } catch (err: unknown) {
      setError("Invalid PIN");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to Gusto</Text>
        <Text style={styles.subtitle}>Enter your PIN to start shift</Text>
      </View>

      {loadingUsers ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ flex: 1 }} />
      ) : (
        <View style={styles.content}>
          {/* User Selector */}
          <View style={styles.userList}>
            {users.map((u) => (
              <Pressable
                key={u.id}
                style={[
                  styles.userChip,
                  selectedUser?.id === u.id && styles.userChipSelected,
                ]}
                onPress={() => setSelectedUser(u)}
              >
                <Text
                  style={[
                    styles.userChipText,
                    selectedUser?.id === u.id && styles.userChipTextSelected,
                  ]}
                >
                  {u.name}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* PIN Pad */}
          <View style={styles.pinContainer}>
            <Text style={styles.selectedName}>
              {selectedUser ? selectedUser.name : "Select a user"}
            </Text>
            <PinPad
              onSubmit={handlePinSubmit}
              isLoading={isLoading}
              error={error}
            />
          </View>

          <Pressable onPress={() => logout()} style={styles.changeServerButton}>
            <Text style={styles.changeServerText}>Change Server IP</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 80,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xxxl,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  content: {
    flex: 1,
    alignItems: "center",
  },
  userList: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginBottom: 40,
  },
  userChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  userChipSelected: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accent,
  },
  userChipText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  userChipTextSelected: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  pinContainer: {
    alignItems: "center",
  },
  selectedName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },
  changeServerButton: {
    marginTop: "auto",
    marginBottom: spacing.xxxl,
    padding: spacing.md,
  },
  changeServerText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
  },
});
