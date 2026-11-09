/**
 * KDS-TV — Expo (Pass) Board
 *
 * The expediter's view: whole table orders instead of station tickets, each
 * with a live per-station checklist ("✓ Pizza Oven Ready", "⏳ Pasta Cooking").
 * When every station is done the order lights up and the pass bumps it, which
 * notifies the waiter on the Captain app / POS that food is ready for pickup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpoOrder, ExpoRecentBump } from "../types";
import { formatElapsed, getTimerStatus } from "../types";
import { kdsFetch } from "../hooks/useSocket";
import { getOrderModeBadge } from "./OrderModeBadge";

interface ExpoBoardProps {
  serverUrl: string;
  /** Bumped by the parent on any kitchen socket event → refetch */
  refreshKey: number;
  onCountChange: (count: number) => void;
  /** Chime when an order becomes fully ready at the pass */
  onOrderReady: () => void;
}

const POLL_MS = 15_000;
const FORCE_ARM_MS = 4_000;

const STATE_LABEL = { READY: "Ready", COOKING: "Cooking", QUEUED: "Queued" } as const;
const STATE_ICON = { READY: "✓", COOKING: "⏳", QUEUED: "•" } as const;

export function ExpoBoard({ serverUrl, refreshKey, onCountChange, onOrderReady }: ExpoBoardProps) {
  const [orders, setOrders] = useState<ExpoOrder[]>([]);
  const [recent, setRecent] = useState<ExpoRecentBump[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armedForce, setArmedForce] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [now, setNow] = useState(Date.now());

  const readyIdsRef = useRef<Set<string> | null>(null);
  const onOrderReadyRef = useRef(onOrderReady);
  onOrderReadyRef.current = onOrderReady;

  const showToast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    setToast({ text, kind });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const [board, sent] = await Promise.all([
        kdsFetch<ExpoOrder[]>(serverUrl, "/api/expo/orders"),
        kdsFetch<ExpoRecentBump[]>(serverUrl, "/api/expo/recent?limit=8"),
      ]);
      // Chime for orders that just became complete (not on first load)
      const readyNow = new Set(board.filter((o) => o.allReady).map((o) => o.orderId));
      if (readyIdsRef.current && [...readyNow].some((id) => !readyIdsRef.current!.has(id))) {
        onOrderReadyRef.current();
      }
      readyIdsRef.current = readyNow;
      setOrders(board);
      setRecent(sent);
      setLoaded(true);
    } catch (err) {
      console.error("[Expo] Failed to load board:", err);
    }
  }, [serverUrl]);

  // Refetch on kitchen events (debounced — a bump fires several events)
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  // Fallback poll + 1s ticker for timers
  useEffect(() => {
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => onCountChange(orders.length), [orders.length, onCountChange]);

  // Ready orders need action → first; otherwise keep server order (rush, oldest)
  const sorted = useMemo(
    () => [...orders].sort((a, b) => Number(b.allReady) - Number(a.allReady)),
    [orders]
  );

  const bump = useCallback(
    async (order: ExpoOrder, force = false) => {
      setBusyId(order.orderId);
      setArmedForce(null);
      try {
        await kdsFetch(serverUrl, `/api/expo/orders/${order.orderId}/bump`, {
          method: "POST",
          body: JSON.stringify({ force }),
        });
        showToast(`🛎️ ${order.tableName ?? `#${order.orderNumber}`} sent — ${order.waiterName ?? "runner"} notified`);
        await load();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Bump failed", "err");
      } finally {
        setBusyId(null);
      }
    },
    [serverUrl, load, showToast]
  );

  const handleForce = useCallback(
    (order: ExpoOrder) => {
      if (armedForce === order.orderId) {
        bump(order, true);
        return;
      }
      setArmedForce(order.orderId);
      setTimeout(() => setArmedForce((id) => (id === order.orderId ? null : id)), FORCE_ARM_MS);
    },
    [armedForce, bump]
  );

  const recall = useCallback(
    async (entry: ExpoRecentBump) => {
      try {
        await kdsFetch(serverUrl, `/api/expo/orders/${entry.orderId}/recall`, { method: "POST" });
        showToast(`↩️ ${entry.tableName ?? `#${entry.orderNumber}`} back on the pass`);
        await load();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Recall failed", "err");
      }
    },
    [serverUrl, load, showToast]
  );

  return (
    <div className="expo-board">
      {!loaded ? (
        <div className="expo-empty">Loading pass…</div>
      ) : sorted.length === 0 ? (
        <div className="expo-empty">
          <span className="expo-empty-icon">🛎️</span>
          <p>Pass is clear</p>
          <p className="expo-empty-sub">Table orders appear here as soon as they are fired to the kitchen</p>
        </div>
      ) : (
        <div className="expo-grid">
          {sorted.map((order) => {
            const elapsed = Math.max(0, Math.floor((now - new Date(order.firstFiredAt).getTime()) / 1000));
            const timer = getTimerStatus(elapsed);
            const badge = getOrderModeBadge({ orderMode: order.orderMode, platform: order.platform, tableName: order.tableName ?? undefined });
            const waiting = order.stations.filter((s) => s.state !== "READY");
            const isBusy = busyId === order.orderId;

            return (
              <article
                key={order.orderId}
                className={`expo-card ${order.allReady ? "expo-card-ready" : ""} ${order.isRush ? "expo-card-rush" : ""} timer-${timer}`}
                id={`expo-${order.orderId}`}
              >
                {order.isRush && <div className="expo-rush">🚨 RUSH</div>}

                <header className="expo-card-header">
                  <div>
                    <div className="expo-card-title">
                      {order.tableName ?? (badge ? badge.label : `#${order.orderNumber}`)}
                    </div>
                    <div className="expo-card-sub">
                      #{order.orderNumber} · KOT {order.kotNumbers.join(", ")}
                      {order.waiterName && ` · 👤 ${order.waiterName}`}
                    </div>
                  </div>
                  <span className={`expo-timer ${timer}`}>{formatElapsed(elapsed)}</span>
                </header>

                {badge && (
                  <div className={`kot-mode-badge kot-mode-${badge.variant}`}>
                    <span className="kot-mode-icon" aria-hidden="true">{badge.icon}</span>
                    <span className="kot-mode-label">{badge.label}</span>
                    <span className="kot-mode-instruction">{badge.instruction}</span>
                  </div>
                )}

                <ul className="expo-checklist" aria-label="Station status">
                  {order.stations.map((st) => (
                    <li key={st.stationId} className={`expo-station expo-station-${st.state.toLowerCase()}`}>
                      <div className="expo-station-row">
                        <span className="expo-station-mark" aria-hidden="true">{STATE_ICON[st.state]}</span>
                        <span className="expo-station-name">
                          {st.icon} {st.name}
                        </span>
                        <span className="expo-station-state">
                          {STATE_LABEL[st.state]}
                          {st.totalKots > 1 && ` ${st.readyKots}/${st.totalKots}`}
                        </span>
                      </div>
                      <div className="expo-station-items">
                        {st.items.map((item, idx) => (
                          <span key={idx} className={`expo-item ${item.ready ? "expo-item-ready" : ""}`}>
                            {item.quantity}× {item.name}
                            {item.variantName ? ` ${item.variantName}` : ""}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>

                <footer className="expo-card-footer">
                  {order.allReady ? (
                    <button
                      className="expo-bump-btn"
                      onClick={() => bump(order)}
                      disabled={isBusy}
                      id={`btn-expo-bump-${order.orderId}`}
                    >
                      {isBusy ? "Sending…" : "🛎️ SEND OUT · CALL RUNNER"}
                    </button>
                  ) : (
                    <>
                      <div className="expo-waiting">
                        Waiting on {waiting.map((s) => s.name).join(" & ")}
                        <span className="expo-progress">
                          {order.readyStations}/{order.stations.length} stations
                        </span>
                      </div>
                      <button
                        className={`expo-force-btn ${armedForce === order.orderId ? "armed" : ""}`}
                        onClick={() => handleForce(order)}
                        disabled={isBusy}
                        title="Send out even though a station hasn't bumped"
                      >
                        {armedForce === order.orderId ? "Tap again to force" : "Force"}
                      </button>
                    </>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <div className="expo-recent" aria-label="Recently sent">
          <span className="expo-recent-label">Sent</span>
          {recent.map((r) => (
            <button
              key={`${r.orderId}-${r.bumpedAt}`}
              className="expo-recent-chip"
              onClick={() => recall(r)}
              title="Recall to the pass"
            >
              {r.tableName ?? `#${r.orderNumber}`}
              <span className="expo-recent-time">{formatElapsed(Math.max(0, Math.floor((now - new Date(r.bumpedAt).getTime()) / 1000)))}</span>
              <span className="expo-recent-recall">↩</span>
            </button>
          ))}
        </div>
      )}

      {toast && <div className={`expo-toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
