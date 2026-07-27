/**
 * Gusto Captain — QuantityStepper Component
 *
 * +/– quantity control with haptic feedback.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, fontSize, radius, spacing, fontWeight } from "../config/theme";

interface QuantityStepperProps {
  quantity: number;
  onChange: (quantity: number) => void;
  min?: number;
  max?: number;
}

export function QuantityStepper({ quantity, onChange, min = 0, max = 99 }: QuantityStepperProps) {
  const handleDecrement = () => {
    if (quantity > min) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(quantity - 1);
    }
  };

  const handleIncrement = () => {
    if (quantity < max) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(quantity + 1);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          quantity <= min && styles.buttonDisabled,
          pressed && quantity > min && styles.buttonPressed,
        ]}
        onPress={handleDecrement}
        disabled={quantity <= min}
      >
        <Text style={styles.buttonText}>-</Text>
      </Pressable>

      <Text style={styles.value}>{quantity}</Text>

      <Pressable
        style={({ pressed }) => [
          styles.button,
          quantity >= max && styles.buttonDisabled,
          pressed && quantity < max && styles.buttonPressed,
        ]}
        onPress={handleIncrement}
        disabled={quantity >= max}
      >
        <Text style={styles.buttonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  button: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    backgroundColor: colors.border,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
  },
  value: {
    minWidth: 32,
    textAlign: "center",
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
});
