/**
 * KDS-TV — Header Component
 *
 * Top bar for the Kitchen Display System:
 * - Kitchen title with branding
 * - Live clock
 * - Connection status indicator
 * - Station filter tabs
 * - Active KOT count
 * - Audio mute toggle
 * - History panel toggle
 * - Bump queue badge (pending offline bumps)
 */

import { useState, useEffect } from "react";
import type { ConnectionStatus } from "../types";
import { KDS_STATIONS } from "../types";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  activeCount: number;
  selectedStation: string | null;
  onStationChange: (station: string | null) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onToggleHistory: () => void;
  completedCount: number;
  bumpQueueLength: number;
}

export function Header({
  connectionStatus,
  activeCount,
  selectedStation,
  onStationChange,
  isMuted,
  onToggleMute,
  onToggleHistory,
  completedCount,
  bumpQueueLength,
}: HeaderProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = time.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const formattedDate = time.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <header className="kds-header">
      {/* ─── Left: Logo + Title ─── */}
      <div className="kds-header-left">
        <h1 className="kds-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img
            src="/logo.png"
            alt="Gusto's"
            style={{
              height: "36px",
              width: "36px",
              objectFit: "contain",
              background: "white",
              padding: "3px",
              borderRadius: "8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
          />
          <span className="kds-title-text">Gusto's Kitchen</span>
        </h1>
        <div className="kds-active-count">
          <span className="kds-active-count-number">{activeCount}</span>
          <span className="kds-active-count-label">Active</span>
        </div>
      </div>

      {/* ─── Center: Station Filters ─── */}
      <nav className="kds-station-filters">
        <button
          className={`kds-station-tab ${selectedStation === null ? "active" : ""}`}
          onClick={() => onStationChange(null)}
          id="station-filter-all"
        >
          ALL
        </button>
        {KDS_STATIONS.map((station) => (
          <button
            key={station.id}
            className={`kds-station-tab ${selectedStation === station.id ? "active" : ""}`}
            onClick={() => onStationChange(station.id)}
            id={`station-filter-${station.id}`}
          >
            <span style={{ marginRight: "6px" }}>{station.icon}</span>
            {station.shortName}
          </button>
        ))}
      </nav>

      {/* ─── Right: History + Mute + Queue Badge + Clock + Status ─── */}
      <div className="kds-header-right">
        {/* History Toggle */}
        <button
          className="kds-history-toggle-btn"
          onClick={onToggleHistory}
          title="View completed KOTs"
          id="btn-history-toggle"
        >
          📋
          {completedCount > 0 && (
            <span className="kds-history-badge">{completedCount}</span>
          )}
        </button>

        <button
          className={`kds-mute-btn ${isMuted ? "muted" : ""}`}
          onClick={onToggleMute}
          title={isMuted ? "Unmute audio alerts" : "Mute audio alerts"}
          id="btn-mute-toggle"
        >
          {isMuted ? "🔇" : "🔊"}
        </button>

        <div className={`kds-connection-status ${connectionStatus}`}>
          <span className="kds-connection-dot" />
          <span className="kds-connection-label">
            {connectionStatus === "connected" && "Live"}
            {connectionStatus === "disconnected" && "Offline"}
            {connectionStatus === "reconnecting" && "Reconnecting..."}
          </span>
          {/* Bump queue badge — shown next to connection when items are pending */}
          {bumpQueueLength > 0 && (
            <span className="kds-bump-queue-badge" title={`${bumpQueueLength} bumps queued offline`}>
              ⏳ {bumpQueueLength}
            </span>
          )}
        </div>

        <div className="kds-clock">
          <div className="kds-clock-time">{formattedTime}</div>
          <div className="kds-clock-date">{formattedDate}</div>
        </div>
      </div>
    </header>
  );
}
