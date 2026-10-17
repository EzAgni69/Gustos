import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Image, ScrollView, RefreshControl } from "react-native";
import { useAuthStore } from "../../src/stores/auth.store";
import { getUsers } from "../../src/services/api";
import { PinPad } from "../../src/components/PinPad";
import { onSocketEvent } from "../../src/services/socket";
import { SOCKET_EVENTS } from "../../src/config/constants";
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login, isLoading, disconnectServer } = useAuthStore();

  const fetchUsers = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setRefreshing(true);
    }
    try {
      const fetchedUsers = await getUsers();
      setUsers(fetchedUsers);
      setSelectedUser((prev) => {
        // If previously selected user still exists in fetched users, keep it;
        // otherwise default to first waiter or first active user
        if (prev && fetchedUsers.some((u) => u.id === prev.id)) {
          return prev;
        }
        return fetchedUsers.find((u) => u.role === "WAITER") || fetchedUsers[0] || null;
      });
      setError(null);
    } catch (err) {
      setError("Failed to load users. Is server running?");
    } finally {
      setLoadingUsers(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();

    // Listen for real-time user updates emitted when staff changes in ERP
    const unsubscribe = onSocketEvent(SOCKET_EVENTS.SYNC_USERS_UPDATED, () => {
      console.log("[LoginScreen] 🔄 Real-time staff update received from server. Refreshing...");
      fetchUsers();
    });

    return () => {
      unsubscribe();
    };
  }, [fetchUsers]);

  const handlePinSubmit = async (pin: string) => {
    if (!selectedUser) return;
    setError(null);
    try {
      await login(pin, selectedUser.id);
      // Root layout handles nav
    } catch (err: unknown) {
      setError("Invalid PIN");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require("../../assets/images/logo.png")} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Welcome to Gusto's</Text>
        <Text style={styles.subtitle}>Enter your PIN to start shift</Text>
      </View>

      {loadingUsers ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ flex: 1 }} />
      ) : (
        <ScrollView
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchUsers(true)}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {/* User Selector */}
          {users.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No active staff configured for this outlet.</Text>
              <Text style={styles.emptySubtext}>Add or activate staff in Web Admin, then pull down to refresh.</Text>
            </View>
          ) : (
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
          )}

          {/* PIN Pad */}
          {users.length > 0 && (
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
          )}

          <Pressable onPress={() => disconnectServer()} style={styles.changeServerButton}>
            <Text style={styles.changeServerText}>Change Server IP</Text>
          </Pressable>
        </ScrollView>
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
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: spacing.md,
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
    flexGrow: 1,
    alignItems: "center",
    paddingBottom: spacing.xxl,
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
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    marginHorizontal: spacing.xl,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.xxl,
  },
  emptyText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
