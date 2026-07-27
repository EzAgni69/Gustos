import React from "react";
import { useMenuStore, type POSMenuItem } from "../../store/useMenuStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

export const MenuItemGrid: React.FC = () => {
  const { getFilteredItems, searchQuery, resetSearch } = useMenuStore();
  const { addItem } = useCartStore();
  const { openModal } = useUIStore();

  const filteredItems = getFilteredItems();

  const handleItemClick = (item: POSMenuItem) => {
    addItem(item);
  };

  return (
    <main className="flex-1 bg-gray-950 flex flex-col h-full overflow-hidden select-none">
      {/* Search Filter Header if active */}
      {searchQuery && (
        <div className="bg-orange-600/10 border-b border-orange-500/30 px-4 py-2 flex items-center justify-between text-xs text-orange-300">
          <div className="flex items-center gap-2">
            <span className="font-bold">⚡ Active Search Filter:</span>
            <span className="bg-orange-600/30 font-mono px-2 py-0.5 rounded text-white border border-orange-500/40">
              "{searchQuery}"
            </span>
            <span className="text-gray-400">({filteredItems.length} results)</span>
          </div>
          <button
            onClick={resetSearch}
            className="text-gray-400 hover:text-white underline text-[11px] flex items-center gap-1"
          >
            <span>Clear [Esc]</span>
          </button>
        </div>
      )}

      {/* Grid container */}
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 content-start">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            onClick={() => handleItemClick(item)}
            className="group relative bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-orange-500/60 rounded-xl p-3 flex flex-col justify-between transition-all duration-150 cursor-pointer active:scale-[0.98] shadow-sm hover:shadow-md min-h-[105px]"
          >
            {/* Top Row: Veg Indicator & Short-Code Badge */}
            <div className="flex items-start justify-between gap-1 mb-1.5">
              {/* Indian Veg / Non-Veg symbol */}
              <div
                className={`w-4 h-4 border flex items-center justify-center p-0.5 rounded-[3px] shrink-0 ${
                  item.isVeg ? "border-emerald-500" : "border-rose-500"
                }`}
                title={item.isVeg ? "100% Vegetarian" : "Non-Vegetarian"}
              >
                <div
                  className={`w-2 h-2 rounded-full ${item.isVeg ? "bg-emerald-500" : "bg-rose-500"}`}
                />
              </div>

              {/* Short-Code Badge */}
              <div className="bg-gray-800 group-hover:bg-orange-600/20 text-gray-300 group-hover:text-orange-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border border-gray-700 group-hover:border-orange-500/40 transition-colors">
                {item.shortCode}
              </div>
            </div>

            {/* Item Name */}
            <div className="text-xs font-bold text-gray-100 group-hover:text-white line-clamp-2 leading-snug flex-1 mb-2">
              {item.name}
            </div>

            {/* Bottom Row: Price & Modifiers Tag */}
            <div className="flex items-center justify-between border-t border-gray-800/80 pt-1.5 mt-auto">
              <div className="text-sm font-extrabold text-orange-400 font-mono">
                ₹{item.price}
              </div>

              {item.availableModifiers && item.availableModifiers.length > 0 ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // First add item, then immediately open modifiers for the latest cart item
                    addItem(item);
                    // Use zero timeout so store state updates first
                    setTimeout(() => {
                      const latestCartItems = useCartStore.getState().items;
                      const added = latestCartItems[latestCartItems.length - 1];
                      if (added) openModal("MODIFIERS", added.cartItemId);
                    }, 0);
                  }}
                  className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white px-1.5 py-0.5 rounded border border-gray-700 font-sans font-medium transition-colors"
                  title="Customize options (Extra Spicy, Less Oil, etc.)"
                >
                  +Mods
                </button>
              ) : (
                <span className="text-[10px] text-gray-600 font-mono group-hover:text-gray-400">
                  Tap to add
                </span>
              )}
            </div>
          </div>
        ))}

        {filteredItems.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-center text-gray-500">
            <div className="text-3xl mb-2">🍽️</div>
            <p className="text-sm font-semibold text-gray-400">No items found matching "{searchQuery}"</p>
            <p className="text-xs text-gray-600 mt-1">Try another keyword or press Esc to clear search</p>
            <button
              onClick={resetSearch}
              className="mt-4 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium border border-gray-700"
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>
    </main>
  );
};
