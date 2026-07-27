import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, fontSize, radius, spacing, fontWeight } from "../../src/config/theme";

export default function ConnectScreen() {
  const [ip, setIp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { connectToServer, isLoading } = useAuthStore();
  const router = useRouter();

  const handleConnect = async () => {
    if (!ip.trim()) {
      setError("Please enter an IP address");
      return;
    }

    setError(null);
    try {
      await connectToServer(ip);
      // Let root layout handle navigation to login once connected
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect to server");
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.content}>
        <Text style={styles.emoji}>📡</Text>
        <Text style={styles.title}>Connect to POS</Text>
        <Text style={styles.subtitle}>Enter the local IP address of the POS server.</Text>

        <View style={styles.form}>
          <TextInput
            style={[styles.input, error && styles.inputError]}
            placeholder="e.g. 192.168.1.100:8080"
            placeholderTextColor={colors.textTertiary}
            value={ip}
            onChangeText={(text) => {
              setIp(text);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!isLoading}
          />
          {error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleConnect}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },
  emoji: {
    fontSize: 64,
    marginBottom: spacing.lg,
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
    textAlign: "center",
    marginBottom: spacing.xxxl,
  },
  form: {
    width: "100%",
    maxWidth: 400,
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.sm,
  },
  button: {
    backgroundColor: colors.accent,
    padding: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
});
