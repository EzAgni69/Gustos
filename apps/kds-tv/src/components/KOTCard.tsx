/**
 * KDS-TV — KOT Card Component
 *
 * Displays a single Kitchen Order Ticket with:
 * - Header: KOT number, table, order number
 * - Hold/Fire banner for multi-course pacing
 * - Body: Itemized list with quantities, modifiers, notes, and item-ready checkboxes
 * - Footer: Color-coded timer + large "READY ✓" button
 * - Border color animates with timer status
 */

import { useState, useCallback } from "react";
import type { KDSKot, HoldStatus } from "../types";
import { getTimerStatus, formatElapsed } from "../types";

interface KOTCardProps {
  kot: KDSKot;
  elapsedSeconds: number;
  onMarkReady: (kotId: string) => void;
  onMarkInProgress: (kotId: string) => void;
  holdStatus?: HoldStatus;
}

export function KOTCard({
  kot,
  elapsedSeconds,
  onMarkReady,
  onMarkInProgress,
  holdStatus,
}: KOTCardProps) {
  const [isMarking, setIsMarking] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [readyCounts, setReadyCounts] = useState<Record<number, number>>({});

  const timerStatus = getTimerStatus(elapsedSeconds);
  const timeDisplay = formatElapsed(elapsedSeconds);
  const isReady = kot.status === "READY";
  const allItemsReady =
    kot.items.length > 0 &&
    (isReady || kot.items.every((item, idx) => (readyCounts[idx] || 0) === item.quantity));

  const incrementItemReady = useCallback((idx: number, maxQty: number) => {
    setReadyCounts((prev) => {
      const current = prev[idx] || 0;
      const next = { ...prev };
      if (current >= maxQty) {
        next[idx] = 0;
      } else {
        next[idx] = current + 1;
      }
      return next;
    });
  }, []);

  const toggleAllItemReady = useCallback((idx: number, maxQty: number) => {
    setReadyCounts((prev) => {
      const current = prev[idx] || 0;
      const next = { ...prev };
      if (current >= maxQty) {
        next[idx] = 0;
      } else {
        next[idx] = maxQty;
      }
      return next;
    });
  }, []);

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
      className={`kot-card ${timerStatus} ${isFadingOut ? "fade-out" : ""} ${isReady ? "is-ready" : ""} ${holdStatus === "HOLD" ? "kot-held" : ""}`}
      id={`kot-${kot.kotId}`}
    >
      {/* ─── Hold / Fire Banner ─── */}
      {holdStatus === "HOLD" && (
        <div className="kot-hold-banner">
          <span className="kot-hold-banner-icon">⏸</span>
          <span className="kot-hold-banner-text">
            HOLD — Awaiting earlier courses
          </span>
        </div>
      )}
      {holdStatus === "FIRE" && (
        <div className="kot-fire-banner">
          <span className="kot-fire-banner-icon">🔥</span>
          <span className="kot-fire-banner-text">
            FIRE — Earlier courses ready!
          </span>
        </div>
      )}

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
        {kot.items.map((item, idx) => {
          const readyCount = readyCounts[idx] || 0;
          const isItemReady = isReady || readyCount === item.quantity;
          const displayQty = isItemReady ? item.quantity : item.quantity - readyCount;

          // Detect size variant from variantName or item name
          const variant =
            item.variantName ||
            (item.name.includes('12"') ? '12"' : item.name.includes('8"') ? '8"' : null);
          const cleanName = item.variantName
            ? item.name.replace(`(${item.variantName})`, "").trim()
            : item.name;

          return (
            <div
              key={idx}
              className={`kot-item ${isItemReady ? "kot-item-done" : ""}`}
              onClick={() => incrementItemReady(idx, item.quantity)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  incrementItemReady(idx, item.quantity);
                }
              }}
            >
              <div className="kot-item-main">
                <label
                  className="kot-item-checkbox-wrapper"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="kot-item-checkbox-input"
                    checked={isItemReady}
                    onChange={() => toggleAllItemReady(idx, item.quantity)}
                    aria-label={`Mark ${item.name} ready`}
                  />
                  <span className="kot-item-custom-checkbox">
                    {isItemReady && <span className="kot-checkmark">✓</span>}
                    {!isItemReady && readyCount > 0 && (
                      <span className="kot-partial-mark" style={{ fontSize: "10px", color: "#666" }}>
                        {readyCount}
                      </span>
                    )}
                  </span>
                </label>
                <span className="kot-item-qty">{displayQty}×</span>
                <span className="kot-item-name">{cleanName}</span>
                {variant && (
                  <span
                    className={`kot-size-badge ${
                      variant.includes("12") ? "size-12" : "size-8"
                    }`}
                  >
                    {variant.includes("12") ? '12" LARGE' : '8" REG'}
                  </span>
                )}
                {isItemReady && <span className="kot-item-done-tag">READY</span>}
              </div>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="kot-item-modifiers">
                  {item.modifiers.map((mod, i) => {
                    const lower = mod.toLowerCase();
                    const isSpicy =
                      lower.includes("spicy") || lower.includes("chilli") || lower.includes("pepper");
                    const isDietary =
                      lower.includes("jain") ||
                      lower.includes("garlic") ||
                      lower.includes("onion") ||
                      lower.includes("swaminarayan");
                    const isCombo =
                      lower.includes("l:") ||
                      lower.includes("r:") ||
                      lower.includes("pizza:") ||
                      lower.includes("drink:");

                    const modClass = isSpicy
                      ? "is-spicy"
                      : isDietary
                      ? "is-dietary"
                      : isCombo
                      ? "is-combo"
                      : "";

                    const icon = isSpicy
                      ? "🌶️"
                      : isDietary
                      ? "🌿"
                      : isCombo
                      ? "🌓"
                      : "•";

                    return (
                      <span key={i} className={`kot-item-modifier ${modClass}`}>
                        <span style={{ marginRight: "4px" }}>{icon}</span>
                        {mod}
                      </span>
                    );
                  })}
                </div>
              )}
              {item.notes && <div className="kot-item-notes">📝 {item.notes}</div>}
            </div>
          );
        })}
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
          className={`kot-btn kot-btn-ready ${isMarking ? "marking" : ""} ${allItemsReady ? "all-ready" : ""} ${holdStatus === "HOLD" ? "kot-btn-held" : ""}`}
          onClick={handleMarkReady}
          disabled={isMarking || isReady}
          id={`btn-ready-${kot.kotId}`}
        >
          {isMarking ? "Marking..." : allItemsReady ? "COMPLETE ALL ✓" : "READY ✓"}
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
