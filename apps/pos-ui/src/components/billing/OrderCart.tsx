import React from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

export const OrderCart: React.FC = () => {
  const {
    orderMode,
    tableNumber,
    paxCount,
    setPaxCount,
    assignedWaiter,
    customer,
    items,
    updateQuantity,
    removeItem,
    discount,
    setDiscount,
    clearCart,
    getTotals,
    holdCurrentBill,
  } = useCartStore();

  const { openModal, showNotification } = useUIStore();
  const totals = getTotals();

  return (
    <aside className="w-80 sm:w-96 bg-gray-900 border-l border-gray-800 flex flex-col h-full select-none shrink-0 shadow-2xl">
      {/* ─── Cart Header: Table, Mode & Pax ─── */}
      <div className="bg-gray-950 px-4 py-3 border-b border-gray-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">
              {orderMode === "DINE_IN"
                ? "🍽️"
                : orderMode === "TAKEAWAY"
                  ? "🛍️"
                  : orderMode === "DELIVERY"
                    ? "🛵"
                    : "⚡"}
            </span>
            <div>
              <div className="text-sm font-extrabold text-white">
                {orderMode === "DINE_IN" ? tableNumber || "Table Not Selected" : orderMode}
              </div>
              <div className="text-[11px] text-gray-400 font-mono">
                {assignedWaiter} • #OUT-20260715-0042
              </div>
            </div>
          </div>

          {/* Cover / Pax Stepper for Dine-In */}
          {orderMode === "DINE_IN" && (
            <div className="flex items-center bg-gray-900 border border-gray-750 rounded-lg p-1 gap-1">
              <button
                onClick={() => setPaxCount(paxCount - 1)}
                className="w-5 h-5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center font-bold"
                title="Decrease covers"
              >
                -
              </button>
              <span className="text-xs font-bold text-orange-400 px-1 font-mono">{paxCount} Pax</span>
              <button
                onClick={() => setPaxCount(paxCount + 1)}
                className="w-5 h-5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center font-bold"
                title="Increase covers"
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Customer / CRM Link Pill [F9] */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-900 text-xs">
          {customer ? (
            <div className="flex items-center justify-between w-full bg-orange-600/10 border border-orange-500/30 px-2.5 py-1 rounded-md text-orange-300">
              <div className="truncate flex items-center gap-1.5 font-medium">
                <span>👤 {customer.name}</span>
                <span className="text-[10px] bg-orange-600/30 px-1 rounded font-mono">
                  {customer.loyaltyPoints ?? 0} Pts
                </span>
              </div>
              <button
                onClick={() => openModal("CUSTOMER")}
                className="text-[11px] text-gray-400 hover:text-white ml-2 shrink-0"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              onClick={() => openModal("CUSTOMER")}
              className="w-full flex items-center justify-between bg-gray-900 hover:bg-gray-800 border border-dashed border-gray-700 px-2.5 py-1 rounded-md text-gray-400 hover:text-white transition-colors"
            >
              <span>+ Link Customer / Loyalty CRM</span>
              <span className="text-[10px] font-mono text-gray-500">[F9]</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Cart Items List ─── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-gray-800/60">
        {items.map((item) => {
          const itemSubtotal = Math.round(item.unitPrice * item.quantity * 100) / 100;

          return (
            <div key={item.cartItemId} className="pt-2 first:pt-0 group flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                {/* Item Name & Quantity Stepper */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-gray-100 group-hover:text-white leading-snug">
                    {item.menuItemName}
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                    ₹{item.unitPrice} each
                  </div>
                </div>

                {/* Line Total & Remove */}
                <div className="text-right shrink-0">
                  <div className="text-xs font-black text-gray-100 font-mono">₹{itemSubtotal}</div>
                  <button
                    onClick={() => removeItem(item.cartItemId)}
                    className="text-[11px] text-gray-500 hover:text-rose-400 transition-colors mt-0.5 font-mono"
                    title="Remove item from bill"
                  >
                    × Remove
                  </button>
                </div>
              </div>

              {/* Quantity Control Stepper & Modifiers Button */}
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <div className="flex items-center bg-gray-950 border border-gray-800 rounded-md p-0.5 gap-1">
                  <button
                    onClick={() => updateQuantity(item.cartItemId, -1)}
                    className="w-6 h-6 bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white rounded flex items-center justify-center font-bold text-xs"
                  >
                    -
                  </button>
                  <span className="w-6 text-center text-xs font-bold text-orange-400 font-mono">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.cartItemId, +1)}
                    className="w-6 h-6 bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white rounded flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>

                {/* Modifiers display or toggle */}
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {item.modifiers && item.modifiers.length > 0 && (
                    <span className="text-[10px] bg-orange-500/10 text-orange-300 border border-orange-500/20 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                      {item.modifiers.join(", ")}
                    </span>
                  )}
                  <button
                    onClick={() => openModal("MODIFIERS", item.cartItemId)}
                    className="text-[10px] bg-gray-800 hover:bg-gray-750 text-gray-400 hover:text-white px-1.5 py-0.5 rounded border border-gray-700 shrink-0"
                    title="Customize item [Alt+M]"
                  >
                    {item.modifiers && item.modifiers.length > 0 ? "Edit Mods" : "+ Note/Mod"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-16">
            <div className="text-4xl mb-2">🛒</div>
            <p className="text-xs font-semibold text-gray-400">Cart is empty</p>
            <p className="text-[11px] text-gray-600 mt-1 max-w-[200px]">
              Tap items from grid or punch Short-Code in top search + Enter
            </p>
          </div>
        )}
      </div>

      {/* ─── Cart Totals Summary (@gusto/core-logic accuracy) ─── */}
      <div className="bg-gray-950 border-t border-gray-800 p-3 space-y-1.5 text-xs">
        <div className="flex justify-between text-gray-400">
          <span>Subtotal ({totals.itemCount} items)</span>
          <span className="font-mono text-gray-200">₹{totals.subtotal}</span>
        </div>

        {/* Discount Line */}
        <div className="flex justify-between items-center text-gray-400">
          <div className="flex items-center gap-1.5">
            <span>Discount</span>
            <button
              onClick={() => openModal("DISCOUNT")}
              className="text-[10px] bg-gray-900 hover:bg-gray-800 text-orange-400 border border-gray-800 px-1.5 py-0.2 rounded font-mono"
            >
              [F4]
            </button>
          </div>
          {discount ? (
            <div className="flex items-center gap-1 text-emerald-400 font-mono">
              <span>-₹{totals.discountAmount}</span>
              <button
                onClick={() => setDiscount(undefined)}
                className="text-gray-500 hover:text-rose-400 ml-1 font-sans font-bold"
                title="Remove discount"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => openModal("DISCOUNT")}
              className="text-gray-500 hover:text-gray-300 font-mono text-[11px]"
            >
              Add Discount
            </button>
          )}
        </div>

        {/* GST Tax Breakdown */}
        {totals.taxBreakdown.map((tax, idx) => (
          <div key={idx} className="flex justify-between text-[11px] text-gray-500 font-mono">
            <span>GST ({tax.taxRate}%) — CGST + SGST</span>
            <span>₹{tax.totalTax}</span>
          </div>
        ))}

        <div className="border-t border-gray-800/80 pt-2 flex items-center justify-between font-extrabold">
          <span className="text-sm text-gray-100">NET PAYABLE</span>
          <span className="text-xl text-orange-400 font-mono">₹{totals.grandTotal}</span>
        </div>
      </div>

      {/* ─── Bottom Action Bar (Hold F3, Clear, Settle F12) ─── */}
      <div className="bg-gray-900 border-t border-gray-800 p-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            if (items.length > 0) {
              holdCurrentBill("Customer parked bill (F3)");
              showNotification("⏸️ Order parked on hold. Screen cleared.");
            } else {
              openModal("HOLD_BILLS");
            }
          }}
          className="bg-gray-800 hover:bg-gray-750 border border-gray-700 text-gray-200 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
        >
          <span>⏸️ Hold Bill</span>
          <span className="text-[10px] text-gray-500 font-mono">[F3]</span>
        </button>

        <button
          onClick={() => {
            if (items.length > 0) {
              if (window.confirm("Are you sure you want to clear current order items?")) {
                clearCart();
                showNotification("🗑️ Cart cleared");
              }
            }
          }}
          className="bg-gray-800 hover:bg-rose-900/30 border border-gray-700 hover:border-rose-500/40 text-gray-400 hover:text-rose-300 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
        >
          <span>🗑️ Clear</span>
        </button>

        <button
          onClick={() => {
            if (items.length === 0) {
              showNotification("⚠️ Cart is empty. Cannot open settlement screen.");
              return;
            }
            openModal("PAYMENT");
          }}
          className="col-span-2 bg-orange-600 hover:bg-orange-500 text-white font-black py-3 rounded-xl text-sm shadow-xl shadow-orange-600/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
        >
          <span>💵 SETTLE & PAY</span>
          <span className="bg-orange-700/80 px-2 py-0.5 rounded text-xs font-mono border border-orange-500/40">
            F12 / Enter
          </span>
        </button>
      </div>
    </aside>
  );
};
