/**
 * KDS-TV — Connection Overlay Component
 *
 * Full-screen overlay displayed when the KDS is disconnected
 * from the POS server. Prevents interaction with stale data
 * and allows configuring the POS server address directly.
 */

import { useState, useEffect } from "react";
import type { ConnectionStatus } from "../types";

interface ConnectionOverlayProps {
  status: ConnectionStatus;
  serverUrl: string;
  onUpdateServerUrl?: (url: string) => void;
}

export function ConnectionOverlay({ status, serverUrl, onUpdateServerUrl }: ConnectionOverlayProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputUrl, setInputUrl] = useState(serverUrl);

  useEffect(() => {
    setInputUrl(serverUrl);
  }, [serverUrl]);

  if (status === "connected") return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl.trim() && onUpdateServerUrl) {
      onUpdateServerUrl(inputUrl.trim());
      setIsEditing(false);
    }
  };

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
            ? "Unable to reach the POS local server on port 8080."
            : "Restoring connection to the kitchen system..."}
        </p>

        {!isEditing ? (
          <div className="kds-connection-overlay-server">
            <span className="kds-connection-overlay-server-label">Target Server:</span>
            <code className="kds-connection-overlay-server-url">{serverUrl}</code>
            {onUpdateServerUrl && (
              <button
                type="button"
                className="kds-connection-change-btn"
                onClick={() => setIsEditing(true)}
              >
                Change Server
              </button>
            )}
          </div>
        ) : (
          <form className="kds-connection-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="kds-connection-input"
              autoFocus
            />
            <div className="kds-connection-form-actions">
              <button type="submit" className="kds-btn-primary">
                Save & Connect
              </button>
              <button
                type="button"
                className="kds-btn-secondary"
                onClick={() => {
                  setInputUrl("http://localhost:8080");
                  if (onUpdateServerUrl) onUpdateServerUrl("http://localhost:8080");
                  setIsEditing(false);
                }}
              >
                Reset to :8080
              </button>
              <button
                type="button"
                className="kds-btn-secondary"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

