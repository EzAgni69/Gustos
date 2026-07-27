/**
 * KDS-TV — Timer Hook
 *
 * Ticks every second to compute elapsed time for each KOT.
 * Returns a Map of kotId → elapsedSeconds so components can
 * derive their timer status and display.
 */

import { useState, useEffect, useRef } from "react";
import type { KDSKot } from "../types";

export function useTimers(kots: KDSKot[]) {
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Compute elapsed seconds for each KOT
  const elapsedMap = new Map<string, number>();
  const now = Date.now();

  for (const kot of kots) {
    const createdMs = new Date(kot.createdAt).getTime();
    const elapsed = Math.max(0, Math.floor((now - createdMs) / 1000));
    elapsedMap.set(kot.kotId, elapsed);
  }

  // Suppress unused variable warning — tick drives re-renders
  void tick;

  return elapsedMap;
}
