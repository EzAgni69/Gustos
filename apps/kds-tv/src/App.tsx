/**
 * KDS-TV — Main Application Component
 *
 * Composes all hooks and components into the Kitchen Display System:
 * - Socket.IO connection for real-time KOT events
 * - KOT state management with reducer
 * - Timer computation (green/yellow/red)
 * - Audio alerts for new and overdue KOTs
 * - Station-based filtering
 * - Android TV-optimized grid layout
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSocket } from "./hooks/useSocket";
import { useKOTStore } from "./hooks/useKOTStore";
import { useTimers } from "./hooks/useTimers";
import { useAudio } from "./hooks/useAudio";
import { Header } from "./components/Header";
import { KOTCard } from "./components/KOTCard";
import { EmptyState } from "./components/EmptyState";
import { ConnectionOverlay } from "./components/ConnectionOverlay";
import { getTimerStatus, TIMER_RED_THRESHOLD } from "./types";

export function App() {
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const prevKotCountRef = useRef(0);
  const hadRedKotsRef = useRef(false);

  // ─── State Management ───
  const {
    activeKots,
    stations,
    hydrate,
    addKOT,
    removeKOT,
    updateStatus,
  } = useKOTStore();

  // ─── Audio ───
  const { isMuted, toggleMute, playDing, startAlarm, stopAlarm } = useAudio();

  // ─── Socket.IO ───
  const handleNewKOT = useCallback(
    (kot: Parameters<typeof addKOT>[0]) => {
      addKOT(kot);
    },
    [addKOT]
  );

  const handleStatusUpdate = useCallback(
    (kotId: string, status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED") => {
      if (status === "READY" || status === "SERVED") {
        // Delay removal for fade-out animation
        updateStatus(kotId, status);
        setTimeout(() => removeKOT(kotId), 3000);
      } else {
        updateStatus(kotId, status);
      }
    },
    [updateStatus, removeKOT]
  );

  const { connectionStatus, markReady, markInProgress, serverUrl } = useSocket({
    onNewKOT: handleNewKOT,
    onStatusUpdate: handleStatusUpdate,
    onHydrate: hydrate,
  });

  // ─── Timers ───
  const elapsedMap = useTimers(activeKots);

  // ─── Audio: Ding on new KOT ───
  useEffect(() => {
    if (activeKots.length > prevKotCountRef.current) {
      playDing();
    }
    prevKotCountRef.current = activeKots.length;
  }, [activeKots.length, playDing]);

  // ─── Audio: Alarm when any KOT goes red ───
  useEffect(() => {
    const hasRedKots = activeKots.some((kot) => {
      const elapsed = elapsedMap.get(kot.kotId) ?? 0;
      return elapsed >= TIMER_RED_THRESHOLD;
    });

    if (hasRedKots && !hadRedKotsRef.current) {
      startAlarm();
    } else if (!hasRedKots && hadRedKotsRef.current) {
      stopAlarm();
    }
    hadRedKotsRef.current = hasRedKots;
  }, [activeKots, elapsedMap, startAlarm, stopAlarm]);

  // ─── Station Filtering ───
  const filteredKots = selectedStation
    ? activeKots.filter((k) => k.station === selectedStation)
    : activeKots;

  // ─── Mark Ready handler ───
  const handleMarkReady = useCallback(
    async (kotId: string) => {
      await markReady(kotId);
    },
    [markReady]
  );

  // ─── Mark In Progress handler ───
  const handleMarkInProgress = useCallback(
    async (kotId: string) => {
      await markInProgress(kotId);
    },
    [markInProgress]
  );

  return (
    <div className="kds-app">
      <Header
        connectionStatus={connectionStatus}
        activeCount={activeKots.length}
        stations={stations}
        selectedStation={selectedStation}
        onStationChange={setSelectedStation}
        isMuted={isMuted}
        onToggleMute={toggleMute}
      />

      <main className="kds-main">
        {filteredKots.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="kds-grid">
            {filteredKots.map((kot) => (
              <KOTCard
                key={kot.kotId}
                kot={kot}
                elapsedSeconds={elapsedMap.get(kot.kotId) ?? 0}
                onMarkReady={handleMarkReady}
                onMarkInProgress={handleMarkInProgress}
              />
            ))}
          </div>
        )}
      </main>

      <ConnectionOverlay status={connectionStatus} serverUrl={serverUrl} />
    </div>
  );
}
