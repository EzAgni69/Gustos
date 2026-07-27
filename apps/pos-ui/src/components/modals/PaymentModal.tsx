import React, { useState, useEffect } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { useTableStore } from "../../store/useTableStore";

type TenderMode = "CASH" | "CARD" | "UPI" | "SPLIT";

export const PaymentModal: React.FC = () => {
  const { getTotals, clearCart, orderMode, tableId } = useCartStore();
  const { activeModal, closeModal, showNotification } = useUIStore();
  const { setTableStatus } = useTableStore();

  const totals = getTotals();
  const [tenderMode, setTenderMode] = useState<TenderMode>("CASH");
  const [tenderedAmount, setTenderedAmount] = useState<number>(totals.grandTotal);
  const [splitCash, setSplitCash] = useState<number>(Math.round(totals.grandTotal / 2));
  const [splitCard, setSplitCard] = useState<number>(totals.grandTotal - Math.round(totals.grandTotal / 2));

  useEffect(() => {
    if (activeModal === "PAYMENT") {
      setTenderedAmount(totals.grandTotal);
    }
  }, [activeModal, totals.grandTotal]);

  if (activeModal !== "PAYMENT") return null;

  const changeDue = Math.max(0, Math.round((tenderedAmount - totals.grandTotal) * 100) / 100);

  const handleSettle = () => {
    // If table was occupied, mark it as BILLED or VACANT after payment
    if (orderMode === "DINE_IN" && tableId) {
      setTableStatus(tableId, "VACANT");
    }

    clearCart();
    closeModal();
    showNotification(`✅ Order Settled via ${tenderMode}! Thermal Receipt & KOT printed.`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSettle();
    }
    if (e.key.toLowerCase() === "c") setTenderMode("CASH");
    if (e.key.toLowerCase() === "r") setTenderMode("CARD");
    if (e.key.toLowerCase() === "u") setTenderMode("UPI");
    if (e.key.toLowerCase() === "s") setTenderMode("SPLIT");
  };

  const cashDenominations = [
    totals.grandTotal,
    Math.ceil(totals.grandTotal / 100) * 100,
    Math.ceil(totals.grandTotal / 500) * 500,
    1000,
    2000,
  ].filter((v, i, self) => self.indexOf(v) === i && v >= totals.grandTotal);

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <span>💵 BILL SETTLEMENT</span>
              <span className="text-xs font-mono bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded border border-orange-500/30">
                F12
              </span>
            </h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              Order #OUT-20260715-0042 • Mode: {orderMode}
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Grand Total Display */}
        <div className="bg-gradient-to-r from-orange-900/40 via-gray-900 to-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-gray-400 tracking-wider uppercase">
              Total Payable Amount
            </div>
            <div className="text-3xl font-black text-orange-400 font-mono mt-0.5">
              ₹{totals.grandTotal}
            </div>
          </div>
          <div className="text-right text-xs text-gray-400 font-mono">
            <div>Items: {totals.itemCount}</div>
            <div>Tax (GST): ₹{totals.totalTax}</div>
          </div>
        </div>

        {/* Tender Mode Tabs */}
        <div className="p-4 grid grid-cols-4 gap-2 border-b border-gray-800 bg-gray-950/50">
          {(
            [
              { id: "CASH", label: "Cash", key: "C", icon: "💵" },
              { id: "CARD", label: "Card / POS", key: "R", icon: "💳" },
              { id: "UPI", label: "UPI / QR", key: "U", icon: "📱" },
              { id: "SPLIT", label: "Split", key: "S", icon: "✂️" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTenderMode(tab.id)}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all ${
                tenderMode === tab.id
                  ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-600/30 font-extrabold"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-750"
              }`}
            >
              <span className="text-xl mb-1">{tab.icon}</span>
              <span>{tab.label}</span>
              <span className="text-[10px] font-mono mt-0.5 opacity-80">[{tab.key}]</span>
            </button>
          ))}
        </div>

        {/* Dynamic Tender Content */}
        <div className="p-6 flex-1">
          {tenderMode === "CASH" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-300 mb-1.5">
                  Tendered Cash Amount (₹)
                </label>
                <input
                  type="number"
                  value={tenderedAmount}
                  onChange={(e) => setTenderedAmount(Number(e.target.value))}
                  autoFocus
                  className="w-full bg-gray-950 border border-gray-700 focus:border-orange-500 rounded-xl px-4 py-3 text-xl font-mono font-bold text-white focus:outline-none"
                />
              </div>

              {/* Denomination Quick Buttons */}
              <div>
                <div className="text-xs text-gray-400 mb-2 font-mono">Quick Denominations:</div>
                <div className="flex flex-wrap gap-2">
                  {cashDenominations.map((denom) => (
                    <button
                      key={denom}
                      onClick={() => setTenderedAmount(denom)}
                      className={`px-3.5 py-2 rounded-lg border text-xs font-mono font-bold transition-colors ${
                        tenderedAmount === denom
                          ? "bg-orange-600/20 border-orange-500 text-orange-300"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                      }`}
                    >
                      ₹{denom} {denom === totals.grandTotal ? "(Exact)" : ""}
                    </button>
                  ))}
                </div>
              </div>

              {/* Change Due Box */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-300">Change Due to Customer:</span>
                <span className="text-2xl font-black font-mono text-emerald-400">
                  ₹{changeDue}
                </span>
              </div>
            </div>
          )}

          {tenderMode === "CARD" && (
            <div className="text-center py-6 space-y-3">
              <div className="text-4xl">💳</div>
              <p className="text-sm font-bold text-white">Swipe or Dip Card on EDC Terminal</p>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Once approved on physical terminal (PineLabs / Paytm POS), click confirm or press Enter below.
              </p>
            </div>
          )}

          {tenderMode === "UPI" && (
            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              <div className="bg-white p-3 rounded-2xl shadow-md shrink-0">
                {/* Mock QR Container */}
                <div className="w-36 h-36 border-2 border-dashed border-gray-400 rounded-xl flex flex-col items-center justify-center bg-gray-50 text-gray-900 p-2 text-center">
                  <div className="text-3xl mb-1">📱</div>
                  <div className="text-[10px] font-bold font-mono">SCAN TO PAY</div>
                  <div className="text-[11px] font-black font-mono text-orange-600 mt-1">
                    ₹{totals.grandTotal}
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-left">
                <div className="text-sm font-bold text-white">UPI Dynamic QR Generated</div>
                <div className="text-xs text-gray-400 font-mono">VPA: gusto.store@icici</div>
                <div className="text-xs text-emerald-400 flex items-center gap-2 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>Listening for instant bank webhook...</span>
                </div>
                <div className="text-[11px] text-gray-500 pt-1">
                  Or press Enter if customer shows successful UPI payment confirmation screen.
                </div>
              </div>
            </div>
          )}

          {tenderMode === "SPLIT" && (
            <div className="space-y-4">
              <div className="text-xs font-bold text-gray-300">Split across Cash & Card / UPI:</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Cash Split (₹)</label>
                  <input
                    type="number"
                    value={splitCash}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSplitCash(val);
                      setSplitCard(Math.max(0, totals.grandTotal - val));
                    }}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Card / UPI Split (₹)</label>
                  <input
                    type="number"
                    value={splitCard}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSplitCard(val);
                      setSplitCash(Math.max(0, totals.grandTotal - val));
                    }}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
              </div>
              <div className="text-xs text-gray-400 font-mono">
                Total Allocated: ₹{splitCash + splitCard} / ₹{totals.grandTotal}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-gray-950 px-6 py-4 border-t border-gray-800 flex items-center justify-between gap-3">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded-xl text-xs font-bold border border-gray-700"
          >
            Cancel [Esc]
          </button>
          <button
            onClick={handleSettle}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-3 px-6 rounded-xl text-sm shadow-lg shadow-orange-600/30 flex items-center justify-center gap-2"
          >
            <span>CONFIRM & PRINT BILL</span>
            <span className="text-xs bg-orange-700/80 px-2 py-0.5 rounded font-mono border border-orange-500/40">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
