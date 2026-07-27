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
 */

import { useState, useEffect } from "react";
import type { ConnectionStatus } from "../types";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  activeCount: number;
  stations: string[];
  selectedStation: string | null;
  onStationChange: (station: string | null) => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export function Header({
  connectionStatus,
  activeCount,
  stations,
  selectedStation,
  onStationChange,
  isMuted,
  onToggleMute,
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
    hour12: true,
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
        <h1 className="kds-title">
          <span className="kds-title-icon">🍳</span>
          <span className="kds-title-text">Gusto Kitchen</span>
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
        {stations.map((station) => (
          <button
            key={station}
            className={`kds-station-tab ${selectedStation === station ? "active" : ""}`}
            onClick={() => onStationChange(station)}
            id={`station-filter-${station.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {station.toUpperCase()}
          </button>
        ))}
      </nav>

      {/* ─── Right: Clock + Status + Mute ─── */}
      <div className="kds-header-right">
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
        </div>

        <div className="kds-clock">
          <div className="kds-clock-time">{formattedTime}</div>
          <div className="kds-clock-date">{formattedDate}</div>
        </div>
      </div>
    </header>
  );
}
