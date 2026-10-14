import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuthStore } from "../src/stores/auth.store";
import { colors } from "../src/config/theme";

function useProtectedRoute(isReady: boolean, fontsLoaded: boolean) {
  const { isConnected, user } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isReady || !fontsLoaded) return;

    const inAuthGroup = segments[0] === "(auth)";
    const path = segments.join("/");

    if (!isConnected) {
      if (path !== "(auth)/connect") {
        router.replace("/(auth)/connect");
      }
    } else if (!user) {
      if (path !== "(auth)/login") {
        router.replace("/(auth)/login");
      }
    } else {
      if (inAuthGroup || path === "") {
        router.replace("/(tabs)");
      }
    }
  }, [isConnected, user, segments, isReady, fontsLoaded]);
}

import { OfflineBanner } from "../src/components/OfflineBanner";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const { isHydrated, restoreSession } = useAuthStore();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useProtectedRoute(isHydrated, fontsLoaded);

  if (!fontsLoaded || !isHydrated) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="cart"
          options={{
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        />
        <Stack.Screen
          name="order/[id]"
          options={{
            animation: "slide_from_right",
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}
