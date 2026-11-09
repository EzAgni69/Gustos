import React from "react";
import { createPortal } from "react-dom";
import { useMenuStore, type POSMenuItem } from "../../store/useMenuStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { useAuthStore } from "../../store/useAuthStore";

const LONG_PRESS_MS = 550;
const MANAGER_ROLES = ["MANAGER", "OWNER", "ADMIN", "SUPER_ADMIN"];

interface MenuItemCardProps {
  item: POSMenuItem;
}

export const MenuItemCard: React.FC<MenuItemCardProps> = React.memo(({ item }) => {
  const { addItem } = useCartStore();
  const { openModal, openItemCustomizer, showNotification } = useUIStore();
  const canManage = MANAGER_ROLES.includes(useAuthStore((s) => s.user?.role ?? ""));
  const soldOut = !item.isAvailable;

  // ─── 86 / availability toggle: right-click or long-press ───
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = React.useRef(false);

  const openAvailabilityMenu = () => {
    if (!canManage) {
      showNotification("🔒 Only a manager can mark items sold out (86).");
      return;
    }
    setConfirmOpen(true);
  };

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    longPressed.current = false;
    clearPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      openAvailabilityMenu();
    }, LONG_PRESS_MS);
  };

  React.useEffect(() => clearPress, []);

  const confirmToggle = async () => {
    setSaving(true);
    try {
      await useMenuStore.getState().toggleItemAvailability(item.id, soldOut);
      showNotification(soldOut ? `✅ ${item.name} is back on the menu.` : `🚫 ${item.name} marked SOLD OUT (86'd) on all terminals.`);
      setConfirmOpen(false);
    } catch (err) {
      showNotification(`⚠️ ${err instanceof Error ? err.message : "Could not update availability"}`);
    } finally {
      setSaving(false);
    }
  };

  // Items with variants (8"/12" sizes) or categories with add-ons should open the customizer
  const hasVariants = item.variants != null;
  const hasAddOns = [
    "cat-pizza-reg", "cat-pizza-prem", "cat-starters",
    "cat-sandwiches", "cat-calzones", "cat-pasta", "cat-combos",
  ].includes(item.categoryId);
  const needsCustomizer = hasVariants || hasAddOns;

  const handleItemClick = () => {
    if (longPressed.current) {
      // The press that opened the 86 dialog shouldn't also add the item
      longPressed.current = false;
      return;
    }
    if (soldOut) {
      showNotification(
        `🚫 ${item.name} is sold out (86'd).${canManage ? " Right-click or long-press to restore." : ""}`
      );
      return;
    }
    if (needsCustomizer) {
      openItemCustomizer(item.id);
    } else {
      addItem(item);
    }
  };

  return (
    <>
    <div
      onClick={handleItemClick}
      onContextMenu={(e) => {
        e.preventDefault();
        clearPress();
        openAvailabilityMenu();
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      aria-disabled={soldOut}
      title={canManage ? "Right-click or long-press to mark sold out / available" : undefined}
      className={`group relative border rounded-xl p-3 flex flex-col justify-between transition-all duration-150 shadow-sm h-full min-h-[105px] [-webkit-touch-callout:none] ${
        soldOut
          ? "bg-surface-hover border-border opacity-55 grayscale cursor-not-allowed"
          : "bg-surface hover:bg-surface-hover border-border hover:border-primary cursor-pointer active:scale-[0.98] hover:shadow-md"
      }`}
    >
      {soldOut && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="-rotate-12 bg-rose-600 text-white text-[11px] font-black tracking-wider px-2 py-0.5 rounded shadow-md border border-rose-800">
            86 · SOLD OUT
          </span>
        </div>
      )}
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
      <div className="text-xs font-bold text-text-main group-hover:text-primary-hover line-clamp-2 leading-snug flex-1 mb-2">
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
        ) : !soldOut && item.availableModifiers && item.availableModifiers.length > 0 ? (
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

    {confirmOpen &&
      createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !saving && setConfirmOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && !saving && setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={soldOut ? `Restore ${item.name}` : `Mark ${item.name} sold out`}
            className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-bold text-text-main">
                {soldOut ? `Put ${item.name} back on the menu?` : `86 ${item.name}?`}
              </h2>
              <p className="text-xs text-text-muted mt-1">
                {soldOut
                  ? "It becomes orderable again on every POS terminal and captain tablet."
                  : "It is greyed out and can't be ordered on every POS terminal and captain tablet until a manager restores it. Items already on bills are not affected."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
                className="py-2.5 rounded-lg text-xs font-bold border border-border-hover bg-surface hover:bg-surface-hover text-text-main"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={confirmToggle}
                disabled={saving}
                className={`py-2.5 rounded-lg text-xs font-bold text-white disabled:opacity-60 ${
                  soldOut ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {saving ? "Saving…" : soldOut ? "✅ Mark Available" : "🚫 Mark Sold Out"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
});
