import React, { useState } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

export const SplitBillModal: React.FC = () => {
  const { getTotals, paxCount } = useCartStore();
  const { activeModal, closeModal, showNotification } = useUIStore();

  const totals = getTotals();
  const [splitWays, setSplitWays] = useState<number>(Math.max(2, paxCount));

  if (activeModal !== "SPLIT_BILL") return null;

  const perPerson = Math.round((totals.grandTotal / splitWays) * 100) / 100;

  const handleConfirm = () => {
    closeModal();
    showNotification(`✂️ Printed ${splitWays} equal split receipts (₹${perPerson} per guest).`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <span>✂️ SPLIT & MERGE BILL</span>
              <span className="text-[10px] font-mono bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded border border-orange-500/30">
                F6
              </span>
            </h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              Equal split calculation or separate item checks
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400 font-mono">Current Grand Total:</div>
              <div className="text-2xl font-black font-mono text-white mt-0.5">₹{totals.grandTotal}</div>
            </div>
            <div className="text-right text-xs text-gray-400 font-mono">
              Total Items: {totals.itemCount}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-2 font-mono">
              Number of Guests / Split Slips:
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSplitWays(Math.max(2, splitWays - 1))}
                className="w-10 h-10 bg-gray-800 hover:bg-gray-700 rounded-xl text-lg font-bold text-white flex items-center justify-center"
              >
                -
              </button>
              <div className="flex-1 bg-gray-950 border border-gray-700 rounded-xl py-2 text-center font-mono font-bold text-lg text-orange-400">
                {splitWays} Ways
              </div>
              <button
                onClick={() => setSplitWays(splitWays + 1)}
                className="w-10 h-10 bg-gray-800 hover:bg-gray-700 rounded-xl text-lg font-bold text-white flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>

          <div className="bg-orange-600/10 border border-orange-500/30 rounded-xl p-4 text-center">
            <div className="text-xs text-orange-300 font-mono">Amount Per Person:</div>
            <div className="text-3xl font-black font-mono text-orange-400 mt-1">
              ₹{perPerson}
            </div>
            <div className="text-[11px] text-gray-400 font-mono mt-1">
              {splitWays} separate slips will be printed via thermal printer
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-950 px-6 py-4 border-t border-gray-800 flex items-center justify-between gap-3">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded-xl text-xs font-bold border border-gray-700"
          >
            Cancel [Esc]
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-2.5 rounded-xl text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center gap-1.5"
          >
            <span>PRINT SPLIT SLIPS</span>
            <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-orange-500/40">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
