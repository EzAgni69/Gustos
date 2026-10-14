/**
 * KDS-TV — History Panel Component
 *
 * Slide-out drawer from the right side showing recently completed KOTs.
 * Each entry displays KOT details and a large RECALL button (80px+ for TV mouse).
 * Allows cooks to restore accidentally bumped orders back to the active grid.
 */

import { useCallback } from "react";
import type { CompletedKot } from "../types";

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  completedKots: CompletedKot[];
  onRecall: (kotId: string) => void;
}

export function HistoryPanel({
  isOpen,
  onClose,
  completedKots,
  onRecall,
}: HistoryPanelProps) {
  const handleRecall = useCallback(
    (kotId: string) => {
      onRecall(kotId);
    },
    [onRecall]
  );

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const getTimeSince = (isoString: string): string => {
    const diff = Math.floor(
      (Date.now() - new Date(isoString).getTime()) / 1000
    );
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="kds-history-backdrop"
          onClick={onClose}
          role="presentation"
        />
      )}

      {/* Panel */}
      <aside
        className={`kds-history-panel ${isOpen ? "open" : ""}`}
        aria-label="KOT History"
      >
        {/* Panel Header */}
        <div className="kds-history-header">
          <div className="kds-history-header-left">
            <span className="kds-history-icon">📋</span>
            <h2 className="kds-history-title">History</h2>
            <span className="kds-history-count">{completedKots.length}</span>
          </div>
          <button
            className="kds-history-close-btn"
            onClick={onClose}
            id="btn-history-close"
            aria-label="Close history panel"
          >
            ✕
          </button>
        </div>

        {/* Panel Body */}
        <div className="kds-history-body">
          {completedKots.length === 0 ? (
            <div className="kds-history-empty">
              <span className="kds-history-empty-icon">🍽️</span>
              <p className="kds-history-empty-text">
                No completed orders yet
              </p>
              <p className="kds-history-empty-subtext">
                Recently bumped KOTs will appear here
              </p>
            </div>
          ) : (
            <div className="kds-history-list">
              {completedKots.map((kot) => (
                <div
                  key={kot.kotId}
                  className="kds-history-item"
                  id={`history-${kot.kotId}`}
                >
                  {/* Item Header */}
                  <div className="kds-history-item-header">
                    <div className="kds-history-item-info">
                      <span className="kds-history-item-kot">
                        KOT #{kot.kotNumber}
                      </span>
                      {kot.tableName && (
                        <span className="kds-history-item-table">
                          {kot.tableName}
                        </span>
                      )}
                    </div>
                    <div className="kds-history-item-time">
                      <span className="kds-history-item-time-relative">
                        {getTimeSince(kot.completedAt)}
                      </span>
                      <span className="kds-history-item-time-absolute">
                        {formatTime(kot.completedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Item Meta */}
                  <div className="kds-history-item-meta">
                    <span>Order #{kot.orderNumber}</span>
                    {kot.station && <span>📍 {kot.station}</span>}
                    {kot.waiterName && <span>👤 {kot.waiterName}</span>}
                  </div>

                  {/* Items Summary */}
                  <div className="kds-history-item-items">
                    {kot.items.map((item, idx) => (
                      <div key={idx} className="kds-history-item-line">
                        <span className="kds-history-item-qty">
                          {item.quantity}×
                        </span>
                        <span className="kds-history-item-name">
                          {item.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Recall Button */}
                  <button
                    className="kds-history-recall-btn"
                    onClick={() => handleRecall(kot.kotId)}
                    id={`btn-recall-${kot.kotId}`}
                  >
                    🔄 RECALL
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
