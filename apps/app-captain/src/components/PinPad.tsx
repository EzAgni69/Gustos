/**
 * Gusto Captain — PinPad Component
 *
 * 4-digit numeric PIN keypad with haptic feedback.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { colors, fontSize, radius, spacing, fontWeight } from "../config/theme";
import { Ionicons } from "@expo/vector-icons";

interface PinPadProps {
  onSubmit: (pin: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "DEL"],
];

export function PinPad({ onSubmit, isLoading, error }: PinPadProps) {
  const [pin, setPin] = useState("");

  const handlePress = useCallback(
    (key: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (key === "DEL") {
        setPin((prev) => prev.slice(0, -1));
        return;
      }

      if (key === "") return;

      const newPin = pin + key;
      if (newPin.length <= 4) {
        setPin(newPin);
        if (newPin.length === 4) {
          onSubmit(newPin);
          // Reset after a short delay for feedback
          setTimeout(() => setPin(""), 500);
        }
      }
    },
    [pin, onSubmit]
  );

  return (
    <View style={styles.container}>
      {/* PIN dots */}
      <View style={styles.dotsRow}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < pin.length && styles.dotFilled,
              error && i < pin.length && styles.dotError,
            ]}
          />
        ))}
      </View>

      {/* Error text */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Keypad */}
      <View style={styles.keypad}>
        {KEYS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keyRow}>
            {row.map((key) => (
              <Pressable
                key={key || `empty-${rowIndex}`}
                style={({ pressed }) => [
                  styles.key,
                  key === "" && styles.keyEmpty,
                  pressed && key !== "" && styles.keyPressed,
                ]}
                onPress={() => handlePress(key)}
                disabled={isLoading || key === ""}
              >
                {key === "DEL" ? (
                  <Ionicons name="backspace-outline" size={24} color={colors.textPrimary} />
                ) : (
                  <Text style={styles.keyText}>{key}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.xxl,
  },
  dotsRow: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.borderLight,
    backgroundColor: "transparent",
  },
  dotFilled: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dotError: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginTop: -spacing.md,
  },
  keypad: {
    gap: spacing.md,
  },
  keyRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  key: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  keyEmpty: {
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  keyPressed: {
    backgroundColor: colors.bgInput,
    borderColor: colors.borderLight,
  },
  keyText: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  keyTextDelete: {
    fontSize: fontSize.xl,
  },
});
