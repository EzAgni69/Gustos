import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuthStore } from "../src/stores/auth.store";
import { onSocketEvent } from "../src/services/socket";
import { SOCKET_EVENTS } from "../src/config/constants";
import { getUsers } from "../src/services/api";
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
    ...Ionicons.font,
  });

  const { isHydrated, restoreSession } = useAuthStore();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // If currently logged-in user is deactivated in ERP, immediately log them out
  useEffect(() => {
    const unsub = onSocketEvent(SOCKET_EVENTS.SYNC_USERS_UPDATED, async () => {
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        try {
          const activeUsers = await getUsers();
          const isStillActive = activeUsers.some((u) => u.id === currentUser.id);
          if (!isStillActive) {
            console.warn(`[RootLayout] Current user ${currentUser.name} (${currentUser.id}) was deactivated or removed in ERP. Logging out.`);
            useAuthStore.getState().logoutUser();
          }
        } catch {
          // If offline or error, continue with cached session
        }
      }
    });

    return () => unsub();
  }, []);

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
