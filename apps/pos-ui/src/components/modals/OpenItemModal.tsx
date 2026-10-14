import React, { useState } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import type { POSMenuItem } from "../../store/useMenuStore";
import type { GSTRate } from "@gusto/core-logic";

export const OpenItemModal: React.FC = () => {
  const { addItem } = useCartStore();
  const { activeModal, closeModal, showNotification } = useUIStore();

  const [name, setName] = useState("");
  const [price, setPrice] = useState<number>(50);
  const [gstRate, setGstRate] = useState<GSTRate>("5");
  const [isVeg, setIsVeg] = useState(true);

  if (activeModal !== "OPEN_ITEM") return null;

  const handleAdd = () => {
    if (!name.trim() || price <= 0) {
      showNotification("⚠️ Please enter valid open item name and price.");
      return;
    }

    const openItem: POSMenuItem = {
      id: `open-item-${Date.now()}`,
      categoryId: "open",
      name: name.trim() + " (Misc)",
      shortCode: "MISC",
      price,
      gstRate,
      isVeg,
      isAvailable: true,
    };

    addItem(openItem);
    closeModal();
    showNotification(`➕ Added open item: ${name.trim()} (₹${price})`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-background px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-text-inverse flex items-center gap-2">
              <span>➕ OPEN ITEM / MISC CHARGE</span>
              <span className="text-[10px] font-mono bg-primary/20 text-primary-hover px-2 py-0.5 rounded border border-primary">
                F8
              </span>
            </h2>
            <p className="text-xs text-text-muted font-mono mt-0.5">
              Add custom non-menu item, packaging fee, or service charge
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-main mb-1 font-mono">
              Item / Charge Description:
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Special Cake Charge / Extra Packaging"
              autoFocus
              className="w-full bg-background border border-border-hover focus:border-primary rounded-xl px-4 py-2.5 text-sm text-text-main focus:outline-none font-sans"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-text-main mb-1 font-mono">
                Amount / Price (₹):
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
                className="w-full bg-background border border-border-hover focus:border-primary rounded-xl px-4 py-2 text-base font-mono font-bold text-text-main focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-text-main mb-1 font-mono">
                GST Tax Slab:
              </label>
              <select
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value as GSTRate)}
                className="w-full bg-background border border-border-hover focus:border-primary rounded-xl px-3 py-2.5 text-sm font-mono text-text-main focus:outline-none"
              >
                <option value="0">0% (No GST)</option>
                <option value="5">5% GST (Food)</option>
                <option value="12">12% GST</option>
                <option value="18">18% GST (Services)</option>
                <option value="28">28% GST</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setIsVeg(!isVeg)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                isVeg
                  ? "bg-secondary/20 border-emerald-500 text-emerald-300"
                  : "bg-rose-500/20 border-rose-500 text-rose-300"
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${isVeg ? "bg-secondary-hover" : "bg-rose-400"}`} />
              <span>{isVeg ? "100% Veg Item" : "Non-Veg Item"}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-background px-6 py-4 border-t border-border flex items-center justify-between gap-3">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl text-xs font-bold border border-border-hover"
          >
            Cancel [Esc]
          </button>
          <button
            onClick={handleAdd}
            className="flex-1 bg-primary hover:bg-primary-hover text-text-inverse font-black py-2.5 rounded-xl text-xs shadow-lg shadow-primary/30 flex items-center justify-center gap-1.5"
          >
            <span>ADD TO BILL</span>
            <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-primary">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
