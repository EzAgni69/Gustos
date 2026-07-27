import React, { useState, useEffect } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import type { DiscountConfig } from "@gusto/core-logic";

export const DiscountModal: React.FC = () => {
  const { discount, setDiscount } = useCartStore();
  const { activeModal, closeModal, showNotification } = useUIStore();

  const [type, setType] = useState<"PERCENTAGE" | "FLAT">("PERCENTAGE");
  const [value, setValue] = useState<number>(10);

  useEffect(() => {
    if (activeModal === "DISCOUNT") {
      setType(discount?.type || "PERCENTAGE");
      setValue(discount?.value || 10);
    }
  }, [activeModal, discount]);

  if (activeModal !== "DISCOUNT") return null;

  const handleApply = () => {
    if (value <= 0) {
      setDiscount(undefined);
      showNotification("🏷️ Discount removed.");
    } else {
      const config: DiscountConfig = {
        type,
        value,
      };
      setDiscount(config);
      showNotification(`🏷️ Applied ${type === "PERCENTAGE" ? `${value}%` : `₹${value} flat`} discount.`);
    }
    closeModal();
  };

  const handleRemove = () => {
    setDiscount(undefined);
    closeModal();
    showNotification("🏷️ Discount removed from bill.");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
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
              <span>🏷️ APPLY BILL DISCOUNT</span>
              <span className="text-[10px] font-mono bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded border border-orange-500/30">
                F4
              </span>
            </h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              Select flat amount or percentage discount off subtotal
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
        <div className="p-6 space-y-4">
          {/* Type Switcher */}
          <div className="grid grid-cols-2 gap-2 bg-gray-950 p-1 rounded-xl border border-gray-800">
            <button
              onClick={() => setType("PERCENTAGE")}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                type === "PERCENTAGE"
                  ? "bg-orange-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Percentage (%)
            </button>
            <button
              onClick={() => setType("FLAT")}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                type === "FLAT" ? "bg-orange-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              Flat Amount (₹)
            </button>
          </div>

          {/* Value input */}
          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1 font-mono">
              Discount {type === "PERCENTAGE" ? "Rate (%)" : "Amount (₹)"}:
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
              autoFocus
              className="w-full bg-gray-950 border border-gray-700 focus:border-orange-500 rounded-xl px-4 py-3 text-xl font-mono font-bold text-white focus:outline-none"
            />
          </div>

          {/* Quick Presets */}
          <div>
            <div className="text-xs text-gray-400 mb-2 font-mono">Quick Preset Options:</div>
            <div className="flex flex-wrap gap-2">
              {type === "PERCENTAGE" ? (
                <>
                  {[5, 10, 15, 20, 25].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setValue(preset)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold ${
                        value === preset
                          ? "bg-orange-600/20 border-orange-500 text-orange-300"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                      }`}
                    >
                      {preset}% Off
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {[50, 100, 150, 200, 500].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setValue(preset)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold ${
                        value === preset
                          ? "bg-orange-600/20 border-orange-500 text-orange-300"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                      }`}
                    >
                      ₹{preset} Off
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {discount && (
            <button
              onClick={handleRemove}
              className="w-full py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/40 text-rose-300 rounded-xl text-xs font-bold transition-colors"
            >
              Remove Active Discount
            </button>
          )}
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
            onClick={handleApply}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-2.5 rounded-xl text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center gap-1.5"
          >
            <span>APPLY DISCOUNT</span>
            <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-orange-500/40">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
