import React, { useEffect } from "react";
import { useUIStore } from "../../store/useUIStore";
import { usePrinterStore } from "../../store/usePrinterStore";

export const PrinterStatusModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();
  const { status, fetchQueueStatus, startPolling, stopPolling } = usePrinterStore();

  useEffect(() => {
    if (activeModal === "PRINTER") {
      fetchQueueStatus();
      startPolling();
    } else {
      stopPolling();
    }
  }, [activeModal, fetchQueueStatus, startPolling, stopPolling]);

  if (activeModal !== "PRINTER") return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface/50">
          <h2 className="text-lg font-bold text-text-inverse flex items-center gap-2">
            <span>🖨️</span>
            Printer Queue Status
          </h2>
          <button
            onClick={closeModal}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-hover text-text-muted hover:bg-surface-hover hover:text-text-main transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {!status ? (
            <div className="text-text-muted text-center py-4">Loading status...</div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-background border border-border rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-text-inverse">{status.pending}</span>
                <span className="text-xs font-bold tracking-widest text-text-muted uppercase mt-1">Pending</span>
              </div>
              
              <div className="bg-background border border-border rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-highlight-hover">{status.printing}</span>
                <span className="text-xs font-bold tracking-widest text-amber-500/50 uppercase mt-1">Printing</span>
              </div>
              
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-rose-500 animate-pulse">{status.failed}</span>
                <span className="text-xs font-bold tracking-widest text-rose-400 uppercase mt-1">Failed</span>
              </div>
              
              <div className="bg-secondary/10 border border-emerald-500/20 rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-emerald-500">{status.completed}</span>
                <span className="text-xs font-bold tracking-widest text-secondary-hover uppercase mt-1">Completed</span>
              </div>
            </div>
          )}

          <div className="mt-6 text-xs text-text-muted text-center">
            {status?.failed && status.failed > 0 ? (
              <span className="text-rose-400">⚠️ Failed jobs will be automatically retried every 30 seconds. Check thermal printer connection and paper.</span>
            ) : (
              <span>Printers are online and jobs are processing normally.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
