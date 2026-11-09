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
import type {
  KDSKot,
  KotNewPayload,
  KotListItem,
  CompletedKot,
  HoldStatus,
  KotModificationPayload,
  OrderMode,
} from "../types";
import { getCourseNumber, getItemStationId } from "../types";

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
  | { type: "CANCEL_KOT"; kotId: string }
  | { type: "RUSH_KOT"; kotId: string }
  | { type: "SET_ORDER_MODE"; orderId: string; oldMode: OrderMode; newMode: OrderMode }
  | { type: "MODIFY_KOT"; kotId: string; modifications: KotModificationPayload["modifications"] }
  | { type: "UPDATE_STATUS"; kotId: string; status: KDSKot["status"] }
  | { type: "COMPLETE_KOT"; kotId: string }
  | { type: "RECALL_KOT"; kotId: string; stationId?: string }
  | { type: "SET_READY_STATIONS"; kotId: string; readyStations: string[] }
  | { type: "STATION_COMPLETE"; kotId: string; stationId: string };

// ─── Reducer ───

function kotReducer(state: KOTState, action: KOTAction): KOTState {
  switch (action.type) {
    case "HYDRATE": {
      // Deduplicate by kotId — hydration can receive overlapping data
      const seen = new Set<string>();
      const uniqueKots = action.kots.filter((k) => {
        if (seen.has(k.kotId)) return false;
        seen.add(k.kotId);
        return true;
      });
      // Server doesn't track "mode changed after firing" — keep that marker
      const prevMode = new Map(state.kots.map((k) => [k.kotId, k.previousOrderMode]));
      const merged = uniqueKots.map((k) =>
        prevMode.get(k.kotId) ? { ...k, previousOrderMode: prevMode.get(k.kotId) } : k
      );
      return { ...state, kots: sortByCreatedAt(merged) };
    }

    case "ADD_KOT": {
      // Deduplicate — if KOT already exists, skip
      if (state.kots.some((k) => k.kotId === action.kot.kotId)) return state;
      return { ...state, kots: sortByCreatedAt([...state.kots, action.kot]) };
    }

    case "REMOVE_KOT":
    case "CANCEL_KOT":
      return { ...state, kots: state.kots.filter((k) => k.kotId !== action.kotId) };

    case "SET_ORDER_MODE": {
      const patch = (k: KDSKot): KDSKot =>
        k.orderId !== action.orderId
          ? k
          : {
              ...k,
              orderMode: action.newMode,
              platform: action.newMode === "ONLINE" ? k.platform : null,
              // Old table no longer applies once it leaves dine-in
              tableName: action.newMode === "DINE_IN" ? k.tableName : undefined,
              previousOrderMode: action.oldMode === action.newMode ? k.previousOrderMode : action.oldMode,
            };
      return {
        kots: state.kots.map(patch),
        completedKots: state.completedKots.map((k) => ({ ...patch(k), completedAt: k.completedAt })),
      };
    }

    case "RUSH_KOT":
      return {
        ...state,
        kots: sortByCreatedAt(
          state.kots.map((k) => (k.kotId === action.kotId ? { ...k, isRush: true } : k))
        ),
      };

    case "MODIFY_KOT": {
      return {
        ...state,
        kots: state.kots
          .map((k) => {
            if (k.kotId !== action.kotId) return k;

            // Apply item modifications
            const updatedItems = k.items
              .map((item) => {
                const mod = action.modifications.find((m) => m.itemName === item.name);
                if (!mod) return item;

                if (mod.changeType === "QUANTITY_CHANGE") {
                  // Check if full cancellation
                  if (mod.newValue?.startsWith("CANCELLED")) {
                    return null;
                  }
                  const parsed = parseInt(mod.newValue || "", 10);
                  const newQty = !isNaN(parsed) && parsed > 0 ? parsed : item.quantity;
                  const modNote = `[QUANTITY_CHANGE] ${mod.oldValue ?? item.quantity} → ${mod.newValue ?? newQty}`;
                  return {
                    ...item,
                    quantity: newQty,
                    notes: mod.newValue ? modNote : item.notes,
                  };
                }

                if (mod.changeType === "NOTE_CHANGE") {
                  return {
                    ...item,
                    notes: mod.newValue || item.notes,
                  };
                }

                return item;
              })
              .filter((i): i is NonNullable<typeof i> => i !== null);

            return {
              ...k,
              items: updatedItems,
            };
          })
          .filter((k) => k.items.length > 0),
      };
    }

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

      // Finished via a station bump on this screen → that entry is already in history
      if (state.completedKots.some((k) => k.kotId === action.kotId && k.stationId)) {
        return { ...state, kots: state.kots.filter((k) => k.kotId !== action.kotId) };
      }

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

    case "SET_READY_STATIONS":
      return {
        ...state,
        kots: state.kots.map((k) =>
          k.kotId === action.kotId ? { ...k, readyStations: action.readyStations } : k
        ),
      };

    case "STATION_COMPLETE": {
      // One station finished its part: hide it from that station, log it in history
      const kot = state.kots.find((k) => k.kotId === action.kotId);
      if (!kot) return state;
      const readyStations = Array.from(new Set([...(kot.readyStations ?? []), action.stationId]));
      const pinned = kot.station?.toLowerCase() === action.stationId;
      const entry: CompletedKot = {
        ...kot,
        // History shows only what this station made
        items: pinned ? kot.items : kot.items.filter((i) => getItemStationId(i) === action.stationId),
        readyStations,
        stationId: action.stationId,
        completedAt: new Date().toISOString(),
      };
      return {
        kots: state.kots.map((k) => (k.kotId === action.kotId ? { ...k, readyStations } : k)),
        completedKots: [
          entry,
          ...state.completedKots.filter(
            (k) => !(k.kotId === action.kotId && k.stationId === action.stationId)
          ),
        ].slice(0, MAX_COMPLETED_KOTS),
      };
    }

    case "RECALL_KOT": {
      const completedKot = state.completedKots.find(
        (k) => k.kotId === action.kotId && (k.stationId ?? undefined) === action.stationId
      );
      if (!completedKot) return state;

      if (action.stationId) {
        // Station-level recall: only that station's part goes back on the line
        const stationId = action.stationId;
        const remainingHistory = state.completedKots.filter((k) => k !== completedKot);
        const live = state.kots.find((k) => k.kotId === action.kotId);
        const { completedAt: _c, stationId: _s, ...restored } = completedKot;
        const base = live ?? { ...restored, status: "IN_PROGRESS" as const };
        const updated: KDSKot = {
          ...base,
          status: base.status === "READY" || base.status === "SERVED" ? "IN_PROGRESS" : base.status,
          readyStations: (base.readyStations ?? []).filter((s) => s !== stationId),
        };
        return {
          kots: sortByCreatedAt([...state.kots.filter((k) => k.kotId !== action.kotId), updated]),
          completedKots: remainingHistory,
        };
      }

      // Restore to active with IN_PROGRESS status
      const { completedAt: _, ...restoredKot } = completedKot;
      // Whole ticket back on the line — server clears per-station marks too
      const kot: KDSKot = { ...restoredKot, status: "IN_PROGRESS", readyStations: [] };

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

/** Rush KOTs first, then oldest first. */
function sortByCreatedAt(kots: KDSKot[]): KDSKot[] {
  return [...kots].sort(
    (a, b) =>
      Number(!!b.isRush) - Number(!!a.isRush) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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
    orderMode: payload.orderMode,
    platform: payload.platform ?? null,
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
    isRush: !!item.isRush,
    readyStations: item.readyStations ?? [],
    orderMode: item.orderMode,
    platform: item.platform ?? null,
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

  const cancelKOT = useCallback((kotId: string) => {
    dispatch({ type: "CANCEL_KOT", kotId });
  }, []);

  const setOrderMode = useCallback((orderId: string, oldMode: OrderMode, newMode: OrderMode) => {
    dispatch({ type: "SET_ORDER_MODE", orderId, oldMode, newMode });
  }, []);

  const rushKOT = useCallback((kotId: string) => {
    dispatch({ type: "RUSH_KOT", kotId });
  }, []);

  const modifyKOT = useCallback(
    (kotId: string, modifications: KotModificationPayload["modifications"]) => {
      dispatch({ type: "MODIFY_KOT", kotId, modifications });
    },
    []
  );

  const updateStatus = useCallback(
    (kotId: string, status: KDSKot["status"]) => {
      dispatch({ type: "UPDATE_STATUS", kotId, status });
    },
    []
  );

  const completeKOT = useCallback((kotId: string) => {
    dispatch({ type: "COMPLETE_KOT", kotId });
  }, []);

  const recallKOT = useCallback((kotId: string, stationId?: string) => {
    dispatch({ type: "RECALL_KOT", kotId, stationId });
  }, []);

  const setReadyStations = useCallback((kotId: string, readyStations: string[]) => {
    dispatch({ type: "SET_READY_STATIONS", kotId, readyStations });
  }, []);

  const completeStation = useCallback((kotId: string, stationId: string) => {
    dispatch({ type: "STATION_COMPLETE", kotId, stationId });
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
    cancelKOT,
    rushKOT,
    setOrderMode,
    modifyKOT,
    updateStatus,
    completeKOT,
    recallKOT,
    setReadyStations,
    completeStation,
  };
}
