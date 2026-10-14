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
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-background px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-text-inverse flex items-center gap-2">
              <span>🏷️ ITEM MODIFIERS & NOTES</span>
              <span className="text-[10px] font-mono bg-primary/20 text-primary-hover px-2 py-0.5 rounded border border-primary">
                Alt+M
              </span>
            </h2>
            <p className="text-xs text-primary-hover font-bold mt-0.5">{cartItem.menuItemName}</p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Modifiers Grid */}
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs font-bold text-text-main mb-2 font-mono">
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
                        ? "bg-primary text-text-inverse border-primary shadow-md shadow-primary/30 font-bold"
                        : "bg-surface-hover text-text-main border-border-hover hover:bg-surface-hover hover:text-text-main"
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
            <label className="block text-xs font-bold text-text-main mb-1.5 font-mono">
              Custom Chef Instructions / Allergies:
            </label>
            <textarea
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="e.g. Cut into 4 slices, No onions or garlic..."
              rows={3}
              className="w-full bg-background border border-border-hover focus:border-primary rounded-xl p-3 text-xs text-text-main placeholder-gray-500 focus:outline-none font-sans"
            />
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
            onClick={handleSave}
            className="flex-1 bg-primary hover:bg-primary-hover text-text-inverse font-black py-2.5 rounded-xl text-xs shadow-lg shadow-primary/30 flex items-center justify-center gap-1.5"
          >
            <span>APPLY MODIFIERS</span>
            <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-primary">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
