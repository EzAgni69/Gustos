/**
 * Gusto Captain — Offline Banner Component
 *
 * Displays a non-intrusive warning when the offline action queue has pending items.
 * Disappears automatically when the queue is drained.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getOfflineQueueCount } from "../lib/offlineQueue";
import { onSocketEvent, isSocketConnected } from "../services/socket";

export function OfflineBanner() {
  const [pendingCount, setPendingCount] = useState(0);
  const [slideAnim] = useState(new Animated.Value(-100)); // Start off-screen

  // Function to refresh the queue count
  const refreshCount = async () => {
    try {
      const count = await getOfflineQueueCount();
      setPendingCount(count);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    // Initial check
    refreshCount();

    // Check periodically since we don't have an EventEmitter for the queue itself
    const interval = setInterval(refreshCount, 2000);

    // Refresh when socket reconnects (meaning it might have drained)
    const unsubConnect = onSocketEvent("connect", () => {
      setTimeout(refreshCount, 2000); // Give it time to drain
    });

    return () => {
      clearInterval(interval);
      unsubConnect();
    };
  }, []);

  useEffect(() => {
    if (pendingCount > 0) {
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    } else {
      // Slide out
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [pendingCount, slideAnim]);

  if (pendingCount === 0) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <Ionicons name="cloud-offline" size={16} color="#fff" style={{ marginRight: 8 }} />
      <Text style={styles.text}>
        {pendingCount} {pendingCount === 1 ? "action" : "actions"} queued. Will sync when back online.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 40, // Below standard status bar
    left: 16,
    right: 16,
    backgroundColor: "#f59e0b", // Amber-500
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 1000,
  },
  text: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
