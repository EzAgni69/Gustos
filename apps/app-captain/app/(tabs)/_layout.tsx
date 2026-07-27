import React, { useEffect } from "react";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { SymbolView } from "expo-symbols";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore } from "../../src/stores/cart.store";
import { colors, fontSize, fontWeight } from "../../src/config/theme";

export default function TabsLayout() {
  const initSocketListeners = useDataStore((s) => s.initSocketListeners);
  const cartItemCount = useCartStore((s) => s.getItemCount());

  useEffect(() => {
    // Start listening to real-time events when entering tabs
    const unsubscribe = initSocketListeners();
    return () => unsubscribe();
  }, [initSocketListeners]);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.bgCard, borderBottomColor: colors.border, borderBottomWidth: 1 },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: fontWeight.bold, fontSize: fontSize.lg },
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          elevation: 0,
          height: Platform.OS === "ios" ? 88 : 60,
          paddingBottom: Platform.OS === "ios" ? 28 : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
      }}
    >
      <Tabs.Screen
        name="tables"
        options={{
          title: "Tables",
          tabBarIcon: ({ color, focused }) => (
            <SymbolView name={focused ? "square.grid.2x2.fill" : "square.grid.2x2"} tintColor={color} size={24} fallback={<>🧊</>} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          tabBarIcon: ({ color, focused }) => (
            <SymbolView name={focused ? "list.bullet.rectangle.fill" : "list.bullet.rectangle"} tintColor={color} size={24} fallback={<>📖</>} />
          ),
          tabBarBadge: cartItemCount > 0 ? cartItemCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent },
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "My Orders",
          tabBarIcon: ({ color, focused }) => (
            <SymbolView name={focused ? "clock.fill" : "clock"} tintColor={color} size={24} fallback={<>⏱️</>} />
          ),
        }}
      />
    </Tabs>
  );
}
