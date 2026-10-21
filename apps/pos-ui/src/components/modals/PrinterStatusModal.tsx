import React, { useEffect } from "react";
import { useUIStore } from "../../store/useUIStore";
import { usePrinterStore } from "../../store/usePrinterStore";

export const PrinterStatusModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();
  const { status, isRetrying, fetchQueueStatus, retryFailedJobs, startPolling, stopPolling } = usePrinterStore();

  useEffect(() => {
    if (activeModal === "PRINTER") {
      fetchQueueStatus();
      startPolling();
    } else {
      stopPolling();
    }
  }, [activeModal, fetchQueueStatus, startPolling, stopPolling]);

  if (activeModal !== "PRINTER") return null;

  const failedCount = status?.failed ?? 0;
  const pendingCount = status?.pending ?? 0;
  const printingCount = status?.printing ?? 0;
  const completedCount = status?.completed ?? 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none">
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col animate-[scaleIn_0.15s_ease-out]">
        
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-border bg-background">
          <div>
            <h2 className="text-base font-black text-text-main flex items-center gap-2">
              <span>🖨️</span>
              <span>Printer Queue Status</span>
            </h2>
            <p className="text-[11px] text-text-muted font-mono mt-0.5">
              ESC/POS Thermal Print Spooler
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-surface-hover hover:bg-border text-text-muted hover:text-text-main transition-colors font-bold text-sm"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {!status ? (
            <div className="text-text-muted text-center py-8 font-mono text-xs">
              ⏳ Fetching print queue telemetry...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Pending */}
                <div className="bg-background border border-border rounded-xl p-3.5 flex flex-col items-center justify-center shadow-xs">
                  <span className="text-3xl font-black text-text-main font-mono">{pendingCount}</span>
                  <span className="text-[11px] font-bold tracking-wider text-text-muted uppercase mt-1">Pending</span>
                  <span className="text-[10px] text-text-muted/70 font-mono">In queue</span>
                </div>
                
                {/* Printing */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex flex-col items-center justify-center shadow-xs">
                  <span className="text-3xl font-black text-amber-700 font-mono flex items-center gap-1.5">
                    {printingCount}
                    {printingCount > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />}
                  </span>
                  <span className="text-[11px] font-bold tracking-wider text-amber-700 uppercase mt-1">Printing</span>
                  <span className="text-[10px] text-amber-600/80 font-mono">Sending data</span>
                </div>
                
                {/* Failed */}
                <div className={`rounded-xl p-3.5 flex flex-col items-center justify-center shadow-xs border ${
                  failedCount > 0 ? "bg-rose-500/15 border-rose-500/40" : "bg-rose-500/5 border-rose-500/20"
                }`}>
                  <span className={`text-3xl font-black font-mono ${failedCount > 0 ? "text-rose-600 animate-pulse" : "text-rose-500"}`}>
                    {failedCount}
                  </span>
                  <span className="text-[11px] font-bold tracking-wider text-rose-700 uppercase mt-1">Failed</span>
                  <span className="text-[10px] text-rose-600/80 font-mono">
                    {failedCount > 0 ? "Needs retry" : "No errors"}
                  </span>
                </div>
                
                {/* Completed */}
                <div className="bg-secondary/10 border border-emerald-500/25 rounded-xl p-3.5 flex flex-col items-center justify-center shadow-xs">
                  <span className="text-3xl font-black text-secondary font-mono">{completedCount}</span>
                  <span className="text-[11px] font-bold tracking-wider text-secondary-hover uppercase mt-1">Completed</span>
                  <span className="text-[10px] text-secondary/80 font-mono">Printed & cut</span>
                </div>
              </div>

              {/* Status Alert Banner */}
              {failedCount > 0 ? (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 leading-relaxed mb-4">
                  <span className="text-sm shrink-0">⚠️</span>
                  <div>
                    <div className="font-bold">Printer communication error</div>
                    <p className="text-[11px] text-rose-800 mt-0.5">
                      {failedCount} print job(s) failed. Check thermal printer power, USB/LAN cable, and paper roll. Auto-retries every 30s.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-surface-hover/70 border border-border rounded-xl flex items-center justify-center gap-2 text-xs text-text-muted font-medium mb-4">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Printers are online and jobs are processing normally.</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                {failedCount > 0 && (
                  <button
                    onClick={retryFailedJobs}
                    disabled={isRetrying}
                    className="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-text-inverse font-bold py-2 px-3 rounded-xl text-xs shadow-md shadow-primary/20 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  >
                    <span>🔄</span>
                    <span>{isRetrying ? "Retrying..." : "Retry Failed"}</span>
                  </button>
                )}
                <button
                  onClick={() => fetchQueueStatus()}
                  className="flex-1 bg-surface-hover hover:bg-border text-text-main font-bold py-2 px-3 rounded-xl text-xs border border-border-hover transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>🔄</span>
                  <span>Refresh</span>
                </button>
                <button
                  onClick={closeModal}
                  className="px-4 bg-surface hover:bg-surface-hover text-text-muted hover:text-text-main font-bold py-2 rounded-xl text-xs border border-border transition-colors"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
