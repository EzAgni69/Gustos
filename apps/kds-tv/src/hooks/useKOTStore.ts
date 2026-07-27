/**
 * KDS-TV — KOT State Management
 *
 * useReducer-based store for managing the array of active KOTs.
 * Provides actions: HYDRATE, ADD_KOT, REMOVE_KOT, UPDATE_STATUS.
 * KOTs are always sorted by createdAt ascending (oldest first).
 */

import { useReducer, useCallback } from "react";
import type { KDSKot, KotNewPayload, KotListItem } from "../types";

// ─── Actions ───

type KOTAction =
  | { type: "HYDRATE"; kots: KDSKot[] }
  | { type: "ADD_KOT"; kot: KDSKot }
  | { type: "REMOVE_KOT"; kotId: string }
  | { type: "UPDATE_STATUS"; kotId: string; status: KDSKot["status"] };

// ─── Reducer ───

function kotReducer(state: KDSKot[], action: KOTAction): KDSKot[] {
  switch (action.type) {
    case "HYDRATE":
      return sortByCreatedAt(action.kots);

    case "ADD_KOT": {
      // Deduplicate — if KOT already exists, skip
      if (state.some((k) => k.kotId === action.kot.kotId)) return state;
      return sortByCreatedAt([...state, action.kot]);
    }

    case "REMOVE_KOT":
      return state.filter((k) => k.kotId !== action.kotId);

    case "UPDATE_STATUS":
      return state.map((k) =>
        k.kotId === action.kotId ? { ...k, status: action.status } : k
      );

    default:
      return state;
  }
}

function sortByCreatedAt(kots: KDSKot[]): KDSKot[] {
  return [...kots].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

// ─── Converters ───

/** Convert a `kot:new` socket payload into a KDSKot */
export function payloadToKDSKot(payload: KotNewPayload): KDSKot {
  return {
    kotId: payload.kotId,
    kotNumber: payload.kotNumber,
    orderId: payload.orderId,
    orderNumber: payload.orderNumber,
    tableName: payload.tableName,
    waiterName: payload.waiterName,
    station: payload.station,
    items: payload.items,
    status: "PENDING",
    createdAt: payload.createdAt,
  };
}

/** Convert a REST list item into a KDSKot */
export function listItemToKDSKot(item: KotListItem): KDSKot {
  return {
    kotId: item.id,
    kotNumber: item.kotNumber,
    orderId: item.orderId,
    orderNumber: item.orderNumber ?? "",
    tableName: item.tableName,
    waiterName: undefined,
    station: item.station,
    items: item.items.map((i) => ({
      name: i.menuItemName,
      quantity: i.quantity,
      modifiers: i.modifiers ?? [],
      notes: i.notes,
    })),
    status: item.status,
    createdAt: item.createdAt,
  };
}

// ─── Hook ───

export function useKOTStore() {
  const [kots, dispatch] = useReducer(kotReducer, []);

  const hydrate = useCallback((kots: KDSKot[]) => {
    dispatch({ type: "HYDRATE", kots });
  }, []);

  const addKOT = useCallback((kot: KDSKot) => {
    dispatch({ type: "ADD_KOT", kot });
  }, []);

  const removeKOT = useCallback((kotId: string) => {
    dispatch({ type: "REMOVE_KOT", kotId });
  }, []);

  const updateStatus = useCallback(
    (kotId: string, status: KDSKot["status"]) => {
      dispatch({ type: "UPDATE_STATUS", kotId, status });
    },
    []
  );

  // Active KOTs = not READY or SERVED
  const activeKots = kots.filter(
    (k) => k.status !== "READY" && k.status !== "SERVED"
  );

  // Unique stations from all KOTs
  const stations = Array.from(
    new Set(kots.map((k) => k.station).filter(Boolean) as string[])
  );

  return {
    kots,
    activeKots,
    stations,
    hydrate,
    addKOT,
    removeKOT,
    updateStatus,
  };
}
