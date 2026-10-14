import React, { useState, useEffect } from "react";
import { useUIStore } from "../../store/useUIStore";
import { useShiftStore } from "../../store/useShiftStore";
import { useAuthStore } from "../../store/useAuthStore";

export const ShiftManagementModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();
  const { activeShift, openShift, closeShift, generateXReport, isLoading, error } = useShiftStore();
  const { user } = useAuthStore();

  const [openingFloat, setOpeningFloat] = useState("0");
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [view, setView] = useState<"MAIN" | "CLOSE_CONFIRM" | "SUMMARY">("MAIN");
  const [reportSummary, setReportSummary] = useState<any>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (activeModal === "SHIFT") {
      setOpeningFloat("0");
      setActualCash("");
      setNotes("");
      setView("MAIN");
      setReportSummary(null);
    }
  }, [activeModal]);

  if (activeModal !== "SHIFT") return null;

  const handleOpenShift = async () => {
    if (!user) return;
    try {
      await openShift(user.id, user.name, Number(openingFloat));
    } catch (err) {
      console.error(err);
    }
  };

  const handleCloseShift = async () => {
    try {
      const report = await closeShift(Number(actualCash), notes);
      setReportSummary(report);
      setView("SUMMARY");
    } catch (err) {
      console.error(err);
    }
  };

  const handleXReport = async () => {
    try {
      await generateXReport();
      closeModal();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface/50">
          <h2 className="text-lg font-bold text-text-inverse flex items-center gap-2">
            <span>👤</span>
            {activeShift ? "Shift Management" : "Open Shift"}
          </h2>
          <button
            onClick={closeModal}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-hover text-text-muted hover:bg-surface-hover hover:text-text-main transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
              {error}
            </div>
          )}

          {!activeShift ? (
            // ─── OPEN SHIFT VIEW ───
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl mb-6">
                <p className="text-sm text-blue-300">
                  You are opening a new shift as <strong className="text-blue-100">{user?.name}</strong>.
                  Please count the cash drawer float and enter it below.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                  Opening Float (Cash in Drawer)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-bold">₹</span>
                  <input
                    type="number"
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(e.target.value)}
                    className="w-full bg-background border border-border-hover focus:border-blue-500 rounded-xl pl-10 pr-4 py-3 text-text-main text-lg font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <button
                onClick={handleOpenShift}
                disabled={isLoading}
                className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-text-inverse rounded-xl font-bold shadow-lg transition-all"
              >
                {isLoading ? "Opening..." : "Open Shift"}
              </button>
            </div>
          ) : view === "MAIN" ? (
            // ─── ACTIVE SHIFT MAIN VIEW ───
            <div className="space-y-6">
              {activeShift.cashierId !== user?.id && (
                <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl mb-4 animate-pulse">
                  <p className="text-sm font-bold text-rose-400">
                    ⚠️ Ghost Shift Detected
                  </p>
                  <p className="text-xs text-rose-300 mt-1">
                    {activeShift.cashierName} left their shift open. You cannot open a new shift until this one is closed (Z-Report).
                  </p>
                </div>
              )}

              <div className="bg-background p-4 rounded-xl border border-border">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-text-muted mb-1">Cashier</div>
                    <div className="font-bold text-text-inverse">{activeShift.cashierName}</div>
                  </div>
                  <div>
                    <div className="text-text-muted mb-1">Opened At</div>
                    <div className="font-bold text-text-inverse">
                      {new Date(activeShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted mb-1">Opening Float</div>
                    <div className="font-bold text-secondary-hover font-mono">₹{activeShift.openingFloat.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-text-muted mb-1">Status</div>
                    <div className="font-bold text-blue-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                      ACTIVE
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={handleXReport}
                  disabled={isLoading}
                  className="w-full py-3 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl font-bold border border-border-hover transition-all flex items-center justify-center gap-2"
                >
                  📄 Print X-Report (Mid-Shift)
                </button>
                <button
                  onClick={() => setView("CLOSE_CONFIRM")}
                  className="w-full py-3 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  🛑 Close Shift (Z-Report)
                </button>
              </div>
            </div>
          ) : view === "CLOSE_CONFIRM" ? (
            // ─── CLOSE SHIFT CONFIRMATION VIEW ───
            <div className="space-y-4">
              <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl mb-6">
                <p className="text-sm text-rose-300">
                  You are closing this shift. This will print the final Z-Report and reset the active shift.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                  Actual Cash In Drawer
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-bold">₹</span>
                  <input
                    type="number"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    className="w-full bg-background border border-border-hover focus:border-rose-500 rounded-xl pl-10 pr-4 py-3 text-text-main text-lg font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-rose-500 transition-all"
                    placeholder="0.00"
                  />
                </div>
                <p className="text-[10px] text-text-muted mt-2">
                  * Blind close enabled: Enter the actual cash you counted. The variance will be calculated automatically.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                  Notes / Explanation (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-background border border-border-hover rounded-xl p-3 text-text-main text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500 transition-all"
                  rows={2}
                  placeholder="E.g. Paid ₹50 for water from drawer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 mt-6">
                <button
                  onClick={() => setView("MAIN")}
                  className="py-3 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseShift}
                  disabled={isLoading || actualCash === ""}
                  className="py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-text-inverse rounded-xl font-bold shadow-lg transition-all"
                >
                  {isLoading ? "Closing..." : "Close & Print"}
                </button>
              </div>
            </div>
          ) : view === "SUMMARY" && reportSummary ? (
            // ─── Z-REPORT SUMMARY VIEW ───
            <div className="space-y-6">
              <div className="bg-secondary/10 border border-emerald-500/20 p-4 rounded-xl mb-4">
                <h3 className="text-secondary-hover font-bold text-center mb-1">✅ Shift Closed Successfully</h3>
                <p className="text-xs text-emerald-300 text-center">
                  Z-Report has been queued for printing.
                </p>
              </div>

              <div className="bg-background p-5 rounded-xl border border-border space-y-3 font-mono text-sm">
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-text-muted">Total Sales</span>
                  <span className="font-bold text-text-inverse">₹{((reportSummary.totalCashSales || 0) + (reportSummary.totalCardSales || 0) + (reportSummary.totalUpiSales || 0) + (reportSummary.totalOnlineSales || 0) + (reportSummary.totalSplitSales || 0)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Expected Cash</span>
                  <span className="font-bold text-text-inverse">₹{(reportSummary.expectedCashInDrawer || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Actual Cash</span>
                  <span className="font-bold text-text-inverse">₹{(reportSummary.actualCashInDrawer || 0).toFixed(2)}</span>
                </div>
                <div className={`flex justify-between pt-2 border-t border-border font-bold ${
                  (reportSummary.cashVariance || 0) < 0 ? "text-rose-400" : (reportSummary.cashVariance || 0) > 0 ? "text-secondary-hover" : "text-text-inverse"
                }`}>
                  <span>Variance</span>
                  <span>₹{(reportSummary.cashVariance || 0).toFixed(2)}</span>
                </div>
              </div>

              <button
                onClick={closeModal}
                className="w-full py-3 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl font-bold transition-all"
              >
                Done
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
