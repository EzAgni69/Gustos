/**
 * KDS-TV — Empty State Component
 *
 * Full-width placeholder displayed when no active KOTs exist.
 * Features a subtle animation to indicate the system is live and waiting.
 */

export function EmptyState() {
  return (
    <div className="kds-empty-state" id="empty-state">
      <div className="kds-empty-state-content">
        <div className="kds-empty-state-icon">
          <span className="kds-empty-state-emoji">👨‍🍳</span>
          <div className="kds-empty-state-pulse" />
        </div>
        <h2 className="kds-empty-state-title">All caught up!</h2>
        <p className="kds-empty-state-subtitle">
          Kitchen is clear — waiting for new orders...
        </p>
        <div className="kds-empty-state-dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      </div>
    </div>
  );
}
