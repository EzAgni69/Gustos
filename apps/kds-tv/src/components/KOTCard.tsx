/**
 * KDS-TV — KOT Card Component
 *
 * Displays a single Kitchen Order Ticket with:
 * - Header: KOT number, table, order number
 * - Body: Itemized list with quantities, modifiers, notes
 * - Footer: Color-coded timer + large "READY ✓" button
 * - Border color animates with timer status
 */

import { useState, useCallback } from "react";
import type { KDSKot, TimerStatus } from "../types";
import { getTimerStatus, formatElapsed } from "../types";

interface KOTCardProps {
  kot: KDSKot;
  elapsedSeconds: number;
  onMarkReady: (kotId: string) => void;
  onMarkInProgress: (kotId: string) => void;
}

export function KOTCard({
  kot,
  elapsedSeconds,
  onMarkReady,
  onMarkInProgress,
}: KOTCardProps) {
  const [isMarking, setIsMarking] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const timerStatus = getTimerStatus(elapsedSeconds);
  const timeDisplay = formatElapsed(elapsedSeconds);
  const isReady = kot.status === "READY";

  const handleMarkReady = useCallback(async () => {
    if (isMarking || isReady) return;
    setIsMarking(true);
    await onMarkReady(kot.kotId);
    setIsFadingOut(true);
  }, [kot.kotId, isMarking, isReady, onMarkReady]);

  const handleMarkInProgress = useCallback(async () => {
    if (kot.status !== "PENDING") return;
    await onMarkInProgress(kot.kotId);
  }, [kot.kotId, kot.status, onMarkInProgress]);

  return (
    <div
      className={`kot-card ${timerStatus} ${isFadingOut ? "fade-out" : ""} ${isReady ? "is-ready" : ""}`}
      id={`kot-${kot.kotId}`}
    >
      {/* ─── Card Header ─── */}
      <div className="kot-card-header">
        <div className="kot-card-header-left">
          <span className="kot-number">KOT #{kot.kotNumber}</span>
          {kot.tableName && <span className="kot-table">{kot.tableName}</span>}
        </div>
        <div className="kot-card-header-right">
          <span className={`kot-timer ${timerStatus}`}>{timeDisplay}</span>
        </div>
      </div>

      {/* ─── Order Info Bar ─── */}
      <div className="kot-info-bar">
        <span className="kot-order-number">Order #{kot.orderNumber}</span>
        {kot.waiterName && (
          <span className="kot-waiter">👤 {kot.waiterName}</span>
        )}
        {kot.station && (
          <span className="kot-station">📍 {kot.station}</span>
        )}
      </div>

      {/* ─── Items List ─── */}
      <div className="kot-items">
        {kot.items.map((item, idx) => (
          <div key={idx} className="kot-item">
            <div className="kot-item-main">
              <span className="kot-item-qty">{item.quantity}×</span>
              <span className="kot-item-name">{item.name}</span>
            </div>
            {item.modifiers && item.modifiers.length > 0 && (
              <div className="kot-item-modifiers">
                {item.modifiers.map((mod, i) => (
                  <span key={i} className="kot-item-modifier">
                    {mod}
                  </span>
                ))}
              </div>
            )}
            {item.notes && (
              <div className="kot-item-notes">📝 {item.notes}</div>
            )}
          </div>
        ))}
      </div>

      {/* ─── Card Footer / Actions ─── */}
      <div className="kot-card-footer">
        {kot.status === "PENDING" && (
          <button
            className="kot-btn kot-btn-start"
            onClick={handleMarkInProgress}
            id={`btn-start-${kot.kotId}`}
          >
            🔥 START
          </button>
        )}
        <button
          className={`kot-btn kot-btn-ready ${isMarking ? "marking" : ""}`}
          onClick={handleMarkReady}
          disabled={isMarking || isReady}
          id={`btn-ready-${kot.kotId}`}
        >
          {isMarking ? "Marking..." : "READY ✓"}
        </button>
      </div>

      {/* ─── Status Badge ─── */}
      <div className={`kot-status-badge ${kot.status.toLowerCase()}`}>
        {kot.status === "PENDING" && "NEW"}
        {kot.status === "IN_PROGRESS" && "COOKING"}
        {kot.status === "READY" && "READY"}
      </div>
    </div>
  );
}
