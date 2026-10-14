import React from "react";
import { type POSMenuItem } from "../../store/useMenuStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

interface MenuItemCardProps {
  item: POSMenuItem;
}

export const MenuItemCard: React.FC<MenuItemCardProps> = React.memo(({ item }) => {
  const { addItem } = useCartStore();
  const { openModal, openItemCustomizer } = useUIStore();

  // Items with variants (8"/12" sizes) or categories with add-ons should open the customizer
  const hasVariants = item.variants != null;
  const hasAddOns = [
    "cat-pizza-reg", "cat-pizza-prem", "cat-starters",
    "cat-sandwiches", "cat-calzones", "cat-pasta", "cat-combos",
  ].includes(item.categoryId);
  const needsCustomizer = hasVariants || hasAddOns;

  const handleItemClick = () => {
    if (needsCustomizer) {
      openItemCustomizer(item.id);
    } else {
      addItem(item);
    }
  };

  return (
    <div
      onClick={handleItemClick}
      className="group relative bg-surface hover:bg-surface-hover border border-border hover:border-primary rounded-xl p-3 flex flex-col justify-between transition-all duration-150 cursor-pointer active:scale-[0.98] shadow-sm hover:shadow-md h-full min-h-[105px]"
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
            className={`w-2 h-2 rounded-full ${item.isVeg ? "bg-secondary" : "bg-rose-500"}`}
          />
        </div>

        <div className="flex items-center gap-1">
          {/* Customizer indicator badge */}
          {needsCustomizer && (
            <div className="bg-primary/15 text-primary-hover text-[9px] font-bold px-1 py-0.5 rounded border border-primary/30">
              {hasVariants ? "8\"/12\"" : "+Opts"}
            </div>
          )}
          {/* Short-Code Badge */}
          <div className="bg-surface-hover group-hover:bg-primary/20 text-text-main group-hover:text-primary-hover font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border border-border-hover group-hover:border-primary transition-colors">
            {item.shortCode}
          </div>
        </div>
      </div>

      {/* Item Name */}
      <div className="text-xs font-bold text-text-main group-hover:text-text-inverse line-clamp-2 leading-snug flex-1 mb-2">
        {item.name}
      </div>

      {/* Bottom Row: Price & Modifiers Tag */}
      <div className="flex items-center justify-between border-t border-border/80 pt-1.5 mt-auto">
        <div className="text-sm font-extrabold text-primary-hover font-mono">
          ₹{item.price}
        </div>

        {needsCustomizer ? (
          <span className="text-[10px] text-primary-hover font-mono group-hover:text-text-muted">
            Tap to customize
          </span>
        ) : item.availableModifiers && item.availableModifiers.length > 0 ? (
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
            className="text-[10px] bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main px-1.5 py-0.5 rounded border border-border-hover font-sans font-medium transition-colors"
            title="Customize options (Extra Spicy, Less Oil, etc.)"
          >
            +Mods
          </button>
        ) : (
          <span className="text-[10px] text-gray-600 font-mono group-hover:text-text-muted">
            Tap to add
          </span>
        )}
      </div>
    </div>
  );
});
