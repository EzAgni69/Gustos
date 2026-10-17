import React, { useEffect } from "react";
import { Tabs } from "expo-router";
import { Platform, Pressable, Text, View, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore } from "../../src/stores/cart.store";
import { useAuthStore } from "../../src/stores/auth.store";
import { colors, fontSize, fontWeight, spacing, radius } from "../../src/config/theme";

export default function TabsLayout() {
  const initSocketListeners = useDataStore((s) => s.initSocketListeners);
  const cartItemCount = useCartStore((s) => s.getItemCount());
  const tableName = useCartStore((s) => s.tableName);
  const existingOrderId = useCartStore((s) => s.existingOrderId);
  const { user, logoutUser } = useAuthStore();

  useEffect(() => {
    // Start listening to real-time events when entering tabs
    const unsubscribe = initSocketListeners();
    return () => unsubscribe();
  }, [initSocketListeners]);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleAlign: "left",
        headerStyle: { backgroundColor: colors.bgCard, borderBottomColor: colors.border, borderBottomWidth: 1 },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: fontWeight.bold, fontSize: fontSize.lg },
        headerLeft: () => (
          <Image
            source={require("../../assets/images/logo.png")}
            style={{ width: 28, height: 28, marginLeft: spacing.lg, marginRight: spacing.sm }}
            resizeMode="contain"
          />
        ),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center", marginRight: spacing.lg, gap: spacing.md, maxWidth: 220 }}>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: fontSize.sm, flexShrink: 1 }}>
              {user?.name}
            </Text>
            <Pressable
              onPress={() => logoutUser()}
              style={{
                backgroundColor: colors.bgInput,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.full,
              }}
            >
              <Text style={{ color: colors.danger, fontWeight: fontWeight.semibold, fontSize: fontSize.sm }}>Logout</Text>
            </Pressable>
          </View>
        ),
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
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tables"
        options={{
          title: "Tables",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "grid" : "grid-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: tableName ? (existingOrderId ? `Add to ${tableName}` : `Menu - ${tableName}`) : "Menu",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "restaurant" : "restaurant-outline"} size={22} color={color} />
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
            <Ionicons name={focused ? "receipt" : "receipt-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="kots"
        options={{
          title: "KOTs",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "print" : "print-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reservations"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
