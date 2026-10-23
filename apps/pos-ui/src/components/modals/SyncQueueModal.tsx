import React, { useEffect, useState } from "react";
import { useUIStore } from "../../store/useUIStore";
import { apiClient } from "../../api/client";

interface SyncEvent {
  id: string;
  eventType: string;
  payload: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
}

export const SyncQueueModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const fetchQueue = async () => {
      try {
        setLoading(true);
        const res = await apiClient("/sync/queue") as { success: boolean; data: SyncEvent[] };
        if (res.success) {
          setEvents(res.data);
        }
      } catch (err) {
        console.error("Failed to fetch sync queue:", err);
      } finally {
        setLoading(false);
      }
    };

    if (activeModal === "SYNC_QUEUE") {
      fetchQueue();
      interval = setInterval(fetchQueue, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeModal]);

  if (activeModal !== "SYNC_QUEUE") return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-2xl max-h-[80vh] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface/50 shrink-0">
          <h2 className="text-lg font-bold text-text-main flex items-center gap-2">
            <span>🔄</span>
            Cloud Sync Queue
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium bg-surface-hover px-3 py-1 rounded-full text-text-main border border-border">
              {events.length} Pending
            </span>
            <button
              onClick={closeModal}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-hover text-text-muted hover:bg-surface-hover hover:text-text-main transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1">
          {loading && events.length === 0 ? (
            <div className="text-text-muted text-center py-8">Loading queue...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 flex flex-col items-center gap-2">
              <span className="text-4xl">✅</span>
              <p className="text-text-main font-bold">All caught up!</p>
              <p className="text-text-muted text-sm">No pending changes to sync to the cloud.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="bg-background border border-border rounded-xl p-4 flex flex-col gap-2"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded font-bold">
                        {event.eventType}
                      </span>
                      <span className="text-xs text-text-muted ml-2">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {event.retryCount > 0 && (
                      <span className="text-xs font-bold bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded">
                        Retries: {event.retryCount}
                      </span>
                    )}
                  </div>

                  <div className="text-xs font-mono text-text-muted bg-surface p-2 rounded max-h-20 overflow-y-auto">
                    {event.payload}
                  </div>

                  {event.lastError && (
                    <div className="text-xs font-medium text-rose-400 bg-rose-500/10 p-2 rounded mt-1 border border-rose-500/20">
                      ⚠️ {event.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
