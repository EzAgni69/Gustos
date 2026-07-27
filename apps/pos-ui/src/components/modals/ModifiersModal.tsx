import React, { useState, useEffect } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useMenuStore } from "../../store/useMenuStore";
import { useUIStore } from "../../store/useUIStore";

export const ModifiersModal: React.FC = () => {
  const { items, setItemModifiers } = useCartStore();
  const { items: menuItems } = useMenuStore();
  const { activeModal, selectedCartItemIdForModifiers, closeModal, showNotification } = useUIStore();

  const cartItem = items.find((i) => i.cartItemId === selectedCartItemIdForModifiers);
  const menuItem = menuItems.find((m) => m.id === cartItem?.menuItemId);

  const [selectedMods, setSelectedMods] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState<string>("");

  useEffect(() => {
    if (activeModal === "MODIFIERS" && cartItem) {
      setSelectedMods(cartItem.modifiers || []);
      setCustomNotes(cartItem.notes || "");
    }
  }, [activeModal, cartItem]);

  if (activeModal !== "MODIFIERS" || !cartItem) return null;

  const availableMods = menuItem?.availableModifiers || [
    "Extra Spicy",
    "Less Spicy",
    "Less Oil",
    "Jain Preparation",
    "Served Hot",
  ];

  const handleToggleMod = (mod: string) => {
    if (selectedMods.includes(mod)) {
      setSelectedMods(selectedMods.filter((m) => m !== mod));
    } else {
      setSelectedMods([...selectedMods, mod]);
    }
  };

  const handleSave = () => {
    setItemModifiers(cartItem.cartItemId, selectedMods, customNotes);
    closeModal();
    showNotification(`🏷️ Modifiers updated for ${cartItem.menuItemName}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
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
              <span>🏷️ ITEM MODIFIERS & NOTES</span>
              <span className="text-[10px] font-mono bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded border border-orange-500/30">
                Alt+M
              </span>
            </h2>
            <p className="text-xs text-orange-300 font-bold mt-0.5">{cartItem.menuItemName}</p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Modifiers Grid */}
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs font-bold text-gray-300 mb-2 font-mono">
              Select Kitchen Modifiers / Preparation Notes:
            </div>
            <div className="flex flex-wrap gap-2">
              {availableMods.map((mod) => {
                const isSelected = selectedMods.includes(mod);
                return (
                  <button
                    key={mod}
                    onClick={() => handleToggleMod(mod)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      isSelected
                        ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-600/20 font-bold"
                        : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-750 hover:text-white"
                    }`}
                  >
                    <span>{isSelected ? "✓ " : "+ "}</span>
                    <span>{mod}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Notes */}
          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5 font-mono">
              Custom Chef Instructions / Allergies:
            </label>
            <textarea
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="e.g. Cut into 4 slices, No onions or garlic..."
              rows={3}
              className="w-full bg-gray-950 border border-gray-700 focus:border-orange-500 rounded-xl p-3 text-xs text-white placeholder-gray-500 focus:outline-none font-sans"
            />
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
            onClick={handleSave}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-2.5 rounded-xl text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center gap-1.5"
          >
            <span>APPLY MODIFIERS</span>
            <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-orange-500/40">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
