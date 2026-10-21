/**
 * KDS-TV — Main Application Component
 *
 * Composes all hooks and components into the Kitchen Display System:
 * - Socket.IO connection for real-time KOT events
 * - KOT state management with reducer (active + completed history)
 * - Timer computation (green/yellow/red)
 * - Audio alerts for new and overdue KOTs
 * - Station-based filtering
 * - Hold & Fire pacing for multi-course orders
 * - History panel for recall of accidentally bumped KOTs
 * - Offline bump queue for network resilience
 * - Android TV-optimized grid layout
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSocket } from "./hooks/useSocket";
import { useKOTStore } from "./hooks/useKOTStore";
import { useTimers } from "./hooks/useTimers";
import { useAudio } from "./hooks/useAudio";
import { Header } from "./components/Header";
import { KOTCard } from "./components/KOTCard";
import { EmptyState } from "./components/EmptyState";
import { ConnectionOverlay } from "./components/ConnectionOverlay";
import { HistoryPanel } from "./components/HistoryPanel";
import { getTimerStatus, TIMER_RED_THRESHOLD, getItemStationId, KDS_STATIONS } from "./types";

export function App() {
  const [selectedStation, setSelectedStation] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("kds-selected-station");
      if (stored && KDS_STATIONS.some((s) => s.id === stored)) {
        return stored;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const prevKotCountRef = useRef(0);
  const hadRedKotsRef = useRef(false);

  const handleStationChange = useCallback((station: string | null) => {
    setSelectedStation(station);
    try {
      if (station) {
        localStorage.setItem("kds-selected-station", station);
      } else {
        localStorage.removeItem("kds-selected-station");
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  // ─── State Management ───
  const {
    activeKots,
    completedKots,
    holdStatusMap,
    hydrate,
    addKOT,
    completeKOT,
    recallKOT,
    updateStatus,
  } = useKOTStore();

  // ─── Audio ───
  const { isMuted, toggleMute, playDing, startAlarm, stopAlarm } = useAudio();

  // ─── Socket.IO ───
  const handleNewKOT = useCallback(
    (kot: Parameters<typeof addKOT>[0]) => {
      addKOT(kot);
      playDing();
    },
    [addKOT, playDing]
  );

  const handleStatusUpdate = useCallback(
    (kotId: string, status: "PENDING" | "IN_PROGRESS" | "READY" | "SERVED") => {
      if (status === "READY" || status === "SERVED") {
        // Update status first for visual feedback, then move to history after delay
        updateStatus(kotId, status);
        setTimeout(() => completeKOT(kotId), 3000);
      } else {
        updateStatus(kotId, status);
      }
    },
    [updateStatus, completeKOT]
  );

  const {
    connectionStatus,
    markReady,
    markInProgress,
    recallKOT: recallKOTOnServer,
    serverUrl,
    setServerUrl,
    bumpQueueLength,
  } = useSocket({
    onNewKOT: handleNewKOT,
    onStatusUpdate: handleStatusUpdate,
    onHydrate: hydrate,
  });

  // ─── Timers ───
  const elapsedMap = useTimers(activeKots);

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
  const filteredKots = useMemo(() => {
    if (!selectedStation) return activeKots;

    return activeKots
      .map((kot) => {
        // If KOT is explicitly pinned to this station, keep all items
        if (kot.station && kot.station.toLowerCase() === selectedStation.toLowerCase()) {
          return kot;
        }

        // Filter items that match the selected station
        const stationItems = kot.items.filter(
          (item) => getItemStationId(item) === selectedStation
        );

        if (stationItems.length === 0) return null;

        return {
          ...kot,
          items: stationItems,
        };
      })
      .filter((kot): kot is typeof activeKots[0] => kot !== null);
  }, [activeKots, selectedStation]);

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

  // ─── Recall handler ───
  const handleRecall = useCallback(
    async (kotId: string) => {
      // Optimistically restore in local state
      recallKOT(kotId);
      // Sync back to server
      await recallKOTOnServer(kotId);
    },
    [recallKOT, recallKOTOnServer]
  );

  // ─── History toggle ───
  const toggleHistory = useCallback(() => {
    setIsHistoryOpen((prev) => !prev);
  }, []);

  return (
    <div className="kds-app">
      <Header
        connectionStatus={connectionStatus}
        activeCount={filteredKots.length}
        selectedStation={selectedStation}
        onStationChange={handleStationChange}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onToggleHistory={toggleHistory}
        completedCount={completedKots.length}
        bumpQueueLength={bumpQueueLength}
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
                holdStatus={holdStatusMap.get(kot.kotId)}
              />
            ))}
          </div>
        )}
      </main>

      <ConnectionOverlay
        status={connectionStatus}
        serverUrl={serverUrl}
        onUpdateServerUrl={setServerUrl}
      />

      <HistoryPanel
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        completedKots={completedKots}
        onRecall={handleRecall}
      />
    </div>
  );
}
