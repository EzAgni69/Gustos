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
import { ExpoBoard } from "./components/ExpoBoard";
import { getTimerStatus, TIMER_RED_THRESHOLD, getItemStationId, KDS_STATIONS, EXPO_STATION_ID } from "./types";
import type { KotStationStatusPayload } from "./types";

export function App() {
  const [selectedStation, setSelectedStation] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("kds-selected-station");
      if (stored && (stored === EXPO_STATION_ID || KDS_STATIONS.some((s) => s.id === stored))) {
        return stored;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const isExpo = selectedStation === EXPO_STATION_ID;
  // Bumped on every kitchen event so the Expo board refetches its checklist
  const [expoRefreshKey, setExpoRefreshKey] = useState(0);
  const [expoCount, setExpoCount] = useState(0);
  const refreshExpo = useCallback(() => setExpoRefreshKey((k) => k + 1), []);
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
    cancelKOT,
    rushKOT,
    setOrderMode,
    modifyKOT,
    completeKOT,
    recallKOT,
    updateStatus,
    setReadyStations,
    completeStation,
  } = useKOTStore();
  const activeKotsRef = useRef(activeKots);
  activeKotsRef.current = activeKots;

  // ─── Audio ───
  const { isMuted, toggleMute, playDing, playRush, startAlarm, stopAlarm } = useAudio();

  // ─── Socket.IO ───
  const handleNewKOT = useCallback(
    (kot: Parameters<typeof addKOT>[0]) => {
      addKOT(kot);
      playDing();
    },
    [addKOT, playDing]
  );

  const handleCancelKOT = useCallback(
    (payload: { kotId: string }) => {
      cancelKOT(payload.kotId);
      playDing();
    },
    [cancelKOT, playDing]
  );

  const handleRushKOT = useCallback(
    (payload: { kotId: string }) => {
      rushKOT(payload.kotId);
      playRush();
    },
    [rushKOT, playRush]
  );

  const handleOrderModeChanged = useCallback(
    (payload: { orderId: string; oldMode: Parameters<typeof setOrderMode>[1]; newMode: Parameters<typeof setOrderMode>[2] }) => {
      if (payload.oldMode === payload.newMode) return;
      setOrderMode(payload.orderId, payload.oldMode, payload.newMode);
      // Only chime if this kitchen actually has tickets for the order
      if (activeKotsRef.current.some((k) => k.orderId === payload.orderId)) playDing();
    },
    [setOrderMode, playDing]
  );

  const handleModifyKOT = useCallback(
    (payload: { kotId: string; modifications: any[] }) => {
      modifyKOT(payload.kotId, payload.modifications);
      playDing();
    },
    [modifyKOT, playDing]
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
      refreshExpo();
    },
    [updateStatus, completeKOT, refreshExpo]
  );

  const handleStationStatus = useCallback(
    (payload: KotStationStatusPayload) => {
      setReadyStations(payload.kotId, payload.readyStations);
      refreshExpo();
    },
    [setReadyStations, refreshExpo]
  );

  const {
    connectionStatus,
    markReady,
    markInProgress,
    recallKOT: recallKOTOnServer,
    markStationReady,
    recallStation: recallStationOnServer,
    refresh: refreshKots,
    serverUrl,
    setServerUrl,
    bumpQueueLength,
  } = useSocket({
    onNewKOT: (kot) => {
      handleNewKOT(kot);
      refreshExpo();
    },
    onStatusUpdate: handleStatusUpdate,
    onHydrate: (kots) => {
      hydrate(kots);
      refreshExpo();
    },
    onCancelKOT: (payload) => {
      handleCancelKOT(payload);
      refreshExpo();
    },
    onModifyKOT: (payload) => {
      handleModifyKOT(payload);
      refreshExpo();
    },
    onRushKOT: (payload) => {
      handleRushKOT(payload);
      refreshExpo();
    },
    onOrderModeChanged: (payload) => {
      handleOrderModeChanged(payload);
      refreshExpo();
    },
    onStationStatus: handleStationStatus,
    onExpoEvent: refreshExpo,
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
    if (isExpo) return [];
    if (!selectedStation) return activeKots;

    return activeKots
      .map((kot) => {
        // This station already finished its part — other stations may still be cooking
        if (kot.readyStations?.includes(selectedStation)) return null;

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
  }, [activeKots, selectedStation, isExpo]);

  // ─── Mark Ready handler ───
  // On a station screen only that station's part is bumped; the KOT turns
  // READY on the server once every station on it is done. "ALL" bumps the KOT.
  const handleMarkReady = useCallback(
    async (kotId: string) => {
      if (selectedStation && !isExpo) {
        completeStation(kotId, selectedStation);
        await markStationReady(kotId, selectedStation);
      } else {
        await markReady(kotId);
      }
    },
    [selectedStation, isExpo, completeStation, markStationReady, markReady]
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
    async (kotId: string, stationId?: string) => {
      // Optimistically restore in local state
      recallKOT(kotId, stationId);
      // Sync back to server
      if (stationId) {
        await recallStationOnServer(kotId, stationId);
        // The KOT may already have left this screen entirely — reload the full ticket
        await refreshKots();
      } else {
        await recallKOTOnServer(kotId);
      }
    },
    [recallKOT, recallKOTOnServer, recallStationOnServer, refreshKots]
  );

  // ─── History toggle ───
  const toggleHistory = useCallback(() => {
    setIsHistoryOpen((prev) => !prev);
  }, []);

  return (
    <div className="kds-app">
      <Header
        connectionStatus={connectionStatus}
        activeCount={isExpo ? expoCount : filteredKots.length}
        selectedStation={selectedStation}
        onStationChange={handleStationChange}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onToggleHistory={toggleHistory}
        completedCount={completedKots.length}
        bumpQueueLength={bumpQueueLength}
      />

      <main className="kds-main">
        {isExpo ? (
          <ExpoBoard
            serverUrl={serverUrl}
            refreshKey={expoRefreshKey}
            onCountChange={setExpoCount}
            onOrderReady={playDing}
          />
        ) : filteredKots.length === 0 ? (
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
