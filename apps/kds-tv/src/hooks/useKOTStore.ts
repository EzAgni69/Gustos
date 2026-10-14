/**
 * KDS-TV — KOT State Management
 *
 * useReducer-based store for managing the array of active KOTs.
 * Provides actions: HYDRATE, ADD_KOT, REMOVE_KOT, UPDATE_STATUS,
 * COMPLETE_KOT (move to history), RECALL_KOT (restore from history).
 * KOTs are always sorted by createdAt ascending (oldest first).
 *
 * Also provides Hold & Fire status computation for multi-course pacing.
 */

import { useReducer, useCallback, useMemo } from "react";
import type { KDSKot, KotNewPayload, KotListItem, CompletedKot, HoldStatus } from "../types";
import { getCourseNumber } from "../types";

const MAX_COMPLETED_KOTS = 50;

// ─── State ───

interface KOTState {
  kots: KDSKot[];
  completedKots: CompletedKot[];
}

// ─── Actions ───

type KOTAction =
  | { type: "HYDRATE"; kots: KDSKot[] }
  | { type: "ADD_KOT"; kot: KDSKot }
  | { type: "REMOVE_KOT"; kotId: string }
  | { type: "UPDATE_STATUS"; kotId: string; status: KDSKot["status"] }
  | { type: "COMPLETE_KOT"; kotId: string }
  | { type: "RECALL_KOT"; kotId: string };

// ─── Reducer ───

function kotReducer(state: KOTState, action: KOTAction): KOTState {
  switch (action.type) {
    case "HYDRATE":
      return { ...state, kots: sortByCreatedAt(action.kots) };

    case "ADD_KOT": {
      // Deduplicate — if KOT already exists, skip
      if (state.kots.some((k) => k.kotId === action.kot.kotId)) return state;
      return { ...state, kots: sortByCreatedAt([...state.kots, action.kot]) };
    }

    case "REMOVE_KOT":
      return { ...state, kots: state.kots.filter((k) => k.kotId !== action.kotId) };

    case "UPDATE_STATUS":
      return {
        ...state,
        kots: state.kots.map((k) =>
          k.kotId === action.kotId ? { ...k, status: action.status } : k
        ),
      };

    case "COMPLETE_KOT": {
      const kot = state.kots.find((k) => k.kotId === action.kotId);
      if (!kot) return state;

      const completedKot: CompletedKot = {
        ...kot,
        completedAt: new Date().toISOString(),
      };

      // Remove from active, add to completed (ring buffer, newest first)
      const updatedCompleted = [completedKot, ...state.completedKots].slice(
        0,
        MAX_COMPLETED_KOTS
      );

      return {
        kots: state.kots.filter((k) => k.kotId !== action.kotId),
        completedKots: updatedCompleted,
      };
    }

    case "RECALL_KOT": {
      const completedKot = state.completedKots.find(
        (k) => k.kotId === action.kotId
      );
      if (!completedKot) return state;

      // Restore to active with IN_PROGRESS status
      const { completedAt: _, ...restoredKot } = completedKot;
      const kot: KDSKot = { ...restoredKot, status: "IN_PROGRESS" };

      return {
        kots: sortByCreatedAt([...state.kots, kot]),
        completedKots: state.completedKots.filter(
          (k) => k.kotId !== action.kotId
        ),
      };
    }

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
      categoryId: i.categoryId,
      variantName: i.variantName,
    })),
    status: item.status,
    createdAt: item.createdAt,
  };
}

// ─── Hold & Fire Logic ───

/**
 * Compute hold status for a single KOT based on multi-course pacing.
 * Returns "HOLD" if earlier courses for the same order are still active,
 * "FIRE" if earlier courses just became ready (transient),
 * or null if hold/fire is not applicable.
 */
function computeHoldStatusMap(kots: KDSKot[]): Map<string, HoldStatus> {
  const holdMap = new Map<string, HoldStatus>();

  // Group KOTs by orderId
  const orderGroups = new Map<string, KDSKot[]>();
  for (const kot of kots) {
    const group = orderGroups.get(kot.orderId) ?? [];
    group.push(kot);
    orderGroups.set(kot.orderId, group);
  }

  for (const [, group] of orderGroups) {
    // Skip single-KOT orders — no pacing needed
    if (group.length <= 1) continue;

    // Check if any KOT has a recognized course station
    const hasCourseStations = group.some(
      (k) => getCourseNumber(k.station) > 0
    );
    if (!hasCourseStations) continue;

    // Find the minimum course number that still has active (non-READY/SERVED) KOTs
    const activeCourses = new Set<number>();
    const readyCourses = new Set<number>();

    for (const kot of group) {
      const course = getCourseNumber(kot.station);
      if (course === 0) continue; // Unknown station — don't gate

      if (kot.status === "READY" || kot.status === "SERVED") {
        readyCourses.add(course);
      } else {
        activeCourses.add(course);
      }
    }

    if (activeCourses.size === 0) continue;

    const minActiveCourse = Math.min(...activeCourses);

    for (const kot of group) {
      const course = getCourseNumber(kot.station);
      if (course === 0) continue;

      if (course > minActiveCourse) {
        // This is a later course and earlier courses are still active → HOLD
        holdMap.set(kot.kotId, "HOLD");
      } else if (
        course === minActiveCourse &&
        readyCourses.size > 0 &&
        Math.min(...readyCourses) < course
      ) {
        // Earlier courses are now ready, this course should fire → FIRE
        holdMap.set(kot.kotId, "FIRE");
      }
    }
  }

  return holdMap;
}

// ─── Hook ───

export function useKOTStore() {
  const [state, dispatch] = useReducer(kotReducer, {
    kots: [],
    completedKots: [],
  });

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

  const completeKOT = useCallback((kotId: string) => {
    dispatch({ type: "COMPLETE_KOT", kotId });
  }, []);

  const recallKOT = useCallback((kotId: string) => {
    dispatch({ type: "RECALL_KOT", kotId });
  }, []);

  // Active KOTs = not READY or SERVED
  const activeKots = state.kots.filter(
    (k) => k.status !== "READY" && k.status !== "SERVED"
  );

  // Unique stations from all KOTs
  const stations = Array.from(
    new Set(state.kots.map((k) => k.station).filter(Boolean) as string[])
  );

  // Compute hold status map for all active KOTs
  const holdStatusMap = useMemo(
    () => computeHoldStatusMap(state.kots),
    [state.kots]
  );

  return {
    kots: state.kots,
    activeKots,
    completedKots: state.completedKots,
    stations,
    holdStatusMap,
    hydrate,
    addKOT,
    removeKOT,
    updateStatus,
    completeKOT,
    recallKOT,
  };
}
