/**
 * KDS-TV — Connection Overlay Component
 *
 * Full-screen overlay displayed when the KDS is disconnected
 * from the POS server. Prevents interaction with stale data
 * and shows reconnection status.
 */

import type { ConnectionStatus } from "../types";

interface ConnectionOverlayProps {
  status: ConnectionStatus;
  serverUrl: string;
}

export function ConnectionOverlay({ status, serverUrl }: ConnectionOverlayProps) {
  if (status === "connected") return null;

  return (
    <div className="kds-connection-overlay" id="connection-overlay">
      <div className="kds-connection-overlay-content">
        <div className="kds-connection-overlay-spinner">
          {status === "reconnecting" ? (
            <div className="spinner" />
          ) : (
            <span className="kds-connection-overlay-icon">⚡</span>
          )}
        </div>

        <h2 className="kds-connection-overlay-title">
          {status === "disconnected"
            ? "Connection Lost"
            : "Reconnecting..."}
        </h2>

        <p className="kds-connection-overlay-subtitle">
          {status === "disconnected"
            ? "Unable to reach the POS server. Attempting to reconnect..."
            : "Restoring connection to the kitchen system..."}
        </p>

        <div className="kds-connection-overlay-server">
          <span className="kds-connection-overlay-server-label">Server:</span>
          <code className="kds-connection-overlay-server-url">{serverUrl}</code>
        </div>
      </div>
    </div>
  );
}
