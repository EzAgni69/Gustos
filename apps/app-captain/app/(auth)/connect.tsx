import React, { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from "react-native";
import { useRouter } from "expo-router";
import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, fontSize, radius, spacing, fontWeight } from "../../src/config/theme";

export default function ConnectScreen() {
  const [ip, setIp] = useState(() => {
    const envUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/^https?:\/\//, '').replace(/\/api\/?$/, '') || "";
    // On physical mobile devices, localhost is unreachable — prefer leaving blank for subnet suggestion
    if (Platform.OS !== "web" && (envUrl === "localhost:8080" || envUrl === "localhost" || envUrl === "127.0.0.1:8080")) {
      return "";
    }
    return envUrl;
  });
  const [error, setError] = useState<string | null>(null);
  const [deviceIp, setDeviceIp] = useState<string | null>(null);
  const [recentIps, setRecentIps] = useState<string[]>([]);
  const { connectToServer, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    const loadNetworkInfo = async () => {
      try {
        const ipAddress = await Network.getIpAddressAsync();
        setDeviceIp(ipAddress);
        
        const stored = await AsyncStorage.getItem('recent_server_ips');
        if (stored) {
          const parsed = JSON.parse(stored);
          setRecentIps(parsed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setIp((prev: string) => (!prev || prev === "localhost:8080" || prev === "localhost" ? parsed[0] : prev));
          }
        }
      } catch (err) {
        console.warn("Could not fetch device IP or recent IPs", err);
      }
    };
    loadNetworkInfo();
  }, []);

  const saveRecentIp = async (connectedIp: string) => {
    try {
      const newRecents = [connectedIp, ...recentIps.filter(i => i !== connectedIp)].slice(0, 3);
      setRecentIps(newRecents);
      await AsyncStorage.setItem('recent_server_ips', JSON.stringify(newRecents));
    } catch (err) {
      console.warn("Could not save recent IP", err);
    }
  };

  const handleConnect = async (ipToConnect: string = ip) => {
    if (!ipToConnect.trim()) {
      setError("Please enter an IP address");
      return;
    }

    // Auto-append port if missing
    let finalIp = ipToConnect.trim();
    if (!finalIp.includes(':')) {
      finalIp += ':8080';
    }
    setIp(finalIp);

    setError(null);
    try {
      await connectToServer(finalIp);
      await saveRecentIp(finalIp);
      // Let root layout handle navigation to login once connected
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect to server");
    }
  };

  const getSubnetSuggestion = () => {
    if (!deviceIp) return null;
    const parts = deviceIp.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.`;
    }
    return null;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Image
          source={require("../../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Connect to POS</Text>
        <Text style={styles.subtitle}>Enter the local IP address of the POS server.</Text>
        
        {deviceIp && (
          <Text style={styles.deviceIpInfo}>
            Your Device IP: {deviceIp}
          </Text>
        )}

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

          {getSubnetSuggestion() && ip === "" && (
            <Pressable
              style={styles.suggestionPill}
              onPress={() => setIp(getSubnetSuggestion()!)}
            >
              <Text style={styles.suggestionText}>Start with: {getSubnetSuggestion()}</Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={() => handleConnect(ip)}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </Pressable>

          {recentIps.length > 0 && (
            <View style={styles.recentSection}>
              <Text style={styles.recentTitle}>Recent Servers</Text>
              {recentIps.map((recentIp, idx) => (
                <Pressable
                  key={idx}
                  style={styles.recentItem}
                  onPress={() => handleConnect(recentIp)}
                  disabled={isLoading}
                >
                  <Text style={styles.recentItemText}>{recentIp}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
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
  logo: {
    width: 140,
    height: 80,
    alignSelf: "center",
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
  deviceIpInfo: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
    marginBottom: spacing.xl,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  suggestionPill: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  suggestionText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  recentSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  recentTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  recentItem: {
    backgroundColor: colors.bgInput,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  recentItemText: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
