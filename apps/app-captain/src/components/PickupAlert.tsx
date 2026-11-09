/**
 * Gusto Captain — Pickup Alert
 *
 * Two triggers raise a "food ready" banner + haptic + chime:
 *  - kitchen bumps a KOT to READY on the KDS  (kot:status-update → KOT_READY_FOR_PICKUP)
 *  - the pass (Expo) sends a finished order out (expo:order-ready)
 *
 * The waiter who owns the order is alerted. Orders without a waiter
 * (counter / takeaway) alert every captain, and managers see every pickup.
 * Tap to open the order, ✕ to dismiss.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Vibration } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { onSocketEvent, type KotReadyForPickup } from "../services/socket";
import { playPickupChime, preloadPickupChime } from "../lib/pickupChime";
import { SOCKET_EVENTS } from "../config/constants";
import { useAuthStore } from "../stores/auth.store";
import { colors } from "../config/theme";

interface ExpoOrderReady {
  orderId: string;
  orderNumber: string;
  tableName: string | null;
  orderMode: string;
  platform: string | null;
  waiterId: string | null;
  waiterName: string | null;
  itemCount: number;
  bumpedAt: string;
}

/** What a banner renders — normalised from either trigger. */
interface PickupBanner {
  key: string;
  orderId: string;
  waiterId: string | null;
  waiterName: string | null;
  title: string;
  sub: string;
}

const MAX_ALERTS = 3;
const SEES_ALL_ROLES = ["OWNER", "ADMIN", "SUPER_ADMIN", "MANAGER", "POS_ADMIN"];
const MODE_LABEL: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", ONLINE: "Online" };

function isForMe(alert: { waiterId: string | null }, user: { id: string; role: string } | null): boolean {
  if (!user) return false;
  if (!alert.waiterId) return true;
  if (alert.waiterId === user.id) return true;
  return SEES_ALL_ROLES.includes(user.role?.toUpperCase());
}

/** "Table 4" / "Swiggy #12" / "Takeaway #12" */
function placeLabel(a: { tableName: string | null; orderNumber: string; orderMode: string | null; platform?: string | null }): string {
  if (a.tableName) {
    const num = a.tableName.match(/^T?-?\s*(\d+)$/i);
    return num ? `Table ${num[1]}` : a.tableName; // "T4" / "4" → "Table 4"; "Patio 3" stays as-is
  }
  const mode = a.platform
    ? a.platform.charAt(0) + a.platform.slice(1).toLowerCase()
    : (a.orderMode && MODE_LABEL[a.orderMode]) ?? "Order";
  return `${mode} #${shortNo(a.orderNumber)}`;
}

/** "KOT-0012" → "12", "ORD-20261109-0042" → "42" */
function shortNo(n: string): string {
  return (n.split("-").pop() ?? n).replace(/^0+(?=\d)/, "");
}

function fromKot(k: KotReadyForPickup): PickupBanner {
  const kotNo = k.kotNumber ? ` (KOT #${shortNo(k.kotNumber)})` : "";
  return {
    key: `kot-${k.kotId}`,
    orderId: k.orderId,
    waiterId: k.waiterId,
    waiterName: k.waiterName,
    title: `🍽️ ${placeLabel(k)}: Food Ready for Pickup!${kotNo}`,
    sub: "Kitchen bumped this ticket",
  };
}

function fromExpo(a: ExpoOrderReady): PickupBanner {
  return {
    key: `expo-${a.orderId}-${a.bumpedAt}`,
    orderId: a.orderId,
    waiterId: a.waiterId,
    waiterName: a.waiterName,
    title: `🍽️ ${placeLabel(a)}: Order Ready for Pickup!`,
    sub: `${a.itemCount} item${a.itemCount === 1 ? "" : "s"} at the pass`,
  };
}

export function PickupAlert() {
  const [alerts, setAlerts] = useState<PickupBanner[]>([]);
  const user = useAuthStore((s) => s.user);
  const userRef = useRef(user);
  userRef.current = user;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    preloadPickupChime();

    const raise = (banner: PickupBanner, replaceSameOrder: boolean) => {
      if (!isForMe(banner, userRef.current)) return;
      setAlerts((prev) =>
        [
          banner,
          ...prev.filter((a) => a.key !== banner.key && !(replaceSameOrder && a.orderId === banner.orderId)),
        ].slice(0, MAX_ALERTS)
      );
      // Distinct from the plain tap used elsewhere: success notification + long double buzz + chime.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Vibration.vibrate([0, 400, 200, 400]);
      playPickupChime();
    };

    const unsubKot = onSocketEvent(SOCKET_EVENTS.KOT_READY_FOR_PICKUP, (data: unknown) => {
      const k = data as KotReadyForPickup;
      if (k?.orderId) raise(fromKot(k), false);
    });
    // Expo "whole order ready" supersedes the per-KOT banners for that order.
    const unsubExpo = onSocketEvent(SOCKET_EVENTS.EXPO_ORDER_READY, (data: unknown) => {
      const a = data as ExpoOrderReady;
      if (a?.orderId) raise(fromExpo(a), true);
    });

    return () => {
      unsubKot();
      unsubExpo();
    };
  }, []);

  if (alerts.length === 0) return null;

  const dismiss = (key: string) => setAlerts((prev) => prev.filter((a) => a.key !== key));

  return (
    <View pointerEvents="box-none" style={[styles.stack, { top: insets.top + 8 }]}>
      {alerts.map((a) => (
        <AlertCard
          key={a.key}
          alert={a}
          mine={!!user && a.waiterId === user.id}
          onOpen={() => {
            // Opening the order acknowledges every pickup banner for it.
            setAlerts((prev) => prev.filter((x) => x.orderId !== a.orderId));
            router.push(`/order/${a.orderId}`);
          }}
          onDismiss={() => dismiss(a.key)}
        />
      ))}
    </View>
  );
}

function AlertCard({
  alert,
  mine,
  onOpen,
  onDismiss,
}: {
  alert: PickupBanner;
  mine: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const slide = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  }, [slide]);

  return (
    <Animated.View style={[styles.card, { transform: [{ translateY: slide }] }]}>
      <Pressable style={styles.body} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${alert.title}. Open order`}>
        <View style={styles.iconWrap}>
          <Ionicons name="restaurant" size={22} color={colors.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{alert.title}</Text>
          <Text style={styles.sub}>
            {alert.sub}
            {!mine && alert.waiterName ? ` · ${alert.waiterName}'s table` : ""}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={12} style={styles.close} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={20} color={colors.bg} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: "absolute",
    left: 12,
    right: 12,
    gap: 8,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.success,
    borderRadius: 14,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.bg, fontFamily: "Inter_700Bold", fontSize: 16 },
  sub: { color: colors.bg, fontFamily: "Inter_500Medium", fontSize: 13, opacity: 0.85, marginTop: 2 },
  close: { padding: 6 },
});
