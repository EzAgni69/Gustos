/**
 * Gusto Captain — BottomSheet Component
 *
 * Lightweight bottom sheet using React Native Reanimated and Gesture Handler.
 */

import React, { useEffect } from "react";
import { View, StyleSheet, Dimensions, TouchableWithoutFeedback, Modal } from "react-native";
import { PanGestureHandler } from "react-native-gesture-handler";
import Animated, {
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { colors, radius, shadow } from "../config/theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface BottomSheetProps {
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: number | string; // e.g., 400 or '80%'
}

export function BottomSheet({ isVisible, onClose, children, height = "80%" }: BottomSheetProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const opacity = useSharedValue(0);

  // Calculate actual height
  const sheetHeight =
    typeof height === "string" && height.endsWith("%")
      ? (SCREEN_HEIGHT * parseFloat(height)) / 100
      : (height as number);

  useEffect(() => {
    if (isVisible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 150 });
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [isVisible, translateY, opacity]);

  const handleClose = () => {
    translateY.value = withTiming(SCREEN_HEIGHT, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
    opacity.value = withTiming(0, { duration: 200 });
  };

  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_: any, ctx: { startY: number }) => {
      ctx.startY = translateY.value;
    },
    onActive: (event: any, ctx: { startY: number }) => {
      // Only allow dragging down
      if (event.translationY > 0) {
        translateY.value = ctx.startY + event.translationY;
      }
    },
    onEnd: (event: any) => {
      if (event.translationY > sheetHeight / 3 || event.velocityY > 500) {
        runOnJS(handleClose)();
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 150 });
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  if (!isVisible) return null;

  return (
    <Modal transparent visible={isVisible} animationType="none" onRequestClose={handleClose}>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={handleClose}>
          <Animated.View style={[styles.backdrop, backdropStyle]} />
        </TouchableWithoutFeedback>

        <PanGestureHandler onGestureEvent={gestureHandler}>
          <Animated.View style={[styles.sheet, { height: sheetHeight }, animatedStyle]}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.content}>{children}</View>
          </Animated.View>
        </PanGestureHandler>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.lg,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderLight,
  },
  content: {
    flex: 1,
  },
});
