import React from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { CashIcon, SplitIcon } from "../common/PaymentIcons";

export const OrderCart: React.FC = () => {
  const {
    orderMode,
    tableId,
    tableNumber,
    paxCount,
    setPaxCount,
    assignedWaiter,
    customer,
    items,
    activeOrderId,
    orderNumber,
    updateQuantity,
    removeItem,
    discount,
    setDiscount,
    clearCart,
    getTotals,
    holdCurrentBill,
    fireKOT,
    loadTableOrder,
    retrieveHeldBill,
  } = useCartStore();

  const { openModal, showNotification } = useUIStore();
  const totals = getTotals();

  return (
    <aside className="w-80 sm:w-96 bg-surface border-l border-border flex flex-col h-full select-none shrink-0 shadow-2xl">
      {/* ─── Cart Header: Table, Mode & Pax ─── */}
      <div className="bg-background px-4 py-3 border-b border-border space-y-2">
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
              <div className="text-sm font-extrabold text-text-main flex items-center gap-1.5">
                <span>{orderMode === "DINE_IN" ? tableNumber || "Table Not Selected" : orderMode}</span>
                {activeOrderId && (
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30 font-mono">
                    ACTIVE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted font-mono flex items-center gap-1">
                <span>{assignedWaiter || "Counter"}</span>
                <span>•</span>
                <span className={orderNumber ? "text-primary-hover font-bold" : "text-text-muted"}>
                  {orderNumber ? `#${orderNumber}` : "New Bill"}
                </span>
              </div>
            </div>
          </div>

          {/* Cover / Pax Stepper for Dine-In */}
          {orderMode === "DINE_IN" && (
            <div className="flex items-center bg-surface border border-border rounded-lg p-1 gap-1">
              <button
                onClick={() => setPaxCount(paxCount - 1)}
                className="w-5 h-5 bg-surface-hover hover:bg-surface-hover text-text-main rounded text-xs flex items-center justify-center font-bold"
                title="Decrease covers"
              >
                -
              </button>
              <span className="text-xs font-bold text-primary-hover px-1 font-mono">{paxCount} Pax</span>
              <button
                onClick={() => setPaxCount(paxCount + 1)}
                className="w-5 h-5 bg-surface-hover hover:bg-surface-hover text-text-main rounded text-xs flex items-center justify-center font-bold"
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
            <div className="flex items-center justify-between w-full bg-primary/10 border border-primary px-2.5 py-1 rounded-md text-primary-hover">
              <div className="truncate flex items-center gap-1.5 font-medium">
                <span>👤 {customer.name}</span>
                <span className="text-[10px] bg-primary/30 px-1 rounded font-mono">
                  {customer.loyaltyPoints ?? 0} Pts
                </span>
              </div>
              <button
                onClick={() => openModal("CUSTOMER")}
                className="text-[11px] text-text-muted hover:text-text-main ml-2 shrink-0"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              onClick={() => openModal("CUSTOMER")}
              className="w-full flex items-center justify-between bg-surface hover:bg-surface-hover border border-dashed border-border-hover px-2.5 py-1 rounded-md text-text-muted hover:text-text-main transition-colors"
            >
              <span>+ Link Customer / Loyalty CRM</span>
              <span className="text-[10px] font-mono text-text-muted">[F9]</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Cart Items List ─── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-gray-800/60">
        {items.map((item) => {
          const addOnsTotal = item.addOns?.reduce((sum, ao) => sum + ao.unitPrice * ao.quantity, 0) ?? 0;
          const itemSubtotal = Math.round((item.unitPrice + addOnsTotal) * item.quantity * 100) / 100;

          return (
            <div key={item.cartItemId} className="pt-2 first:pt-0 group flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                {/* Item Name & Quantity Stepper */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-text-main group-hover:text-primary-hover leading-snug flex items-center gap-1.5">
                    {item.menuItemName}
                    {item.kotId ? (
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded border border-amber-500/40 whitespace-nowrap font-mono font-semibold">
                        🔥 FIRED
                      </span>
                    ) : item.isSaved ? (
                      <span className="text-[9px] bg-secondary/20 text-secondary-hover px-1 py-0.5 rounded border border-emerald-500/30 whitespace-nowrap font-mono">
                        SAVED
                      </span>
                    ) : (
                      <span className="text-[9px] bg-primary/20 text-primary-hover px-1 py-0.5 rounded border border-primary/30 whitespace-nowrap font-mono">
                        NEW
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-muted font-mono mt-0.5 flex flex-col">
                    <span>₹{item.unitPrice} each</span>
                    {item.addOns && item.addOns.length > 0 && (
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {item.addOns.map((ao, idx) => (
                          <span key={idx} className="text-[10px] text-primary-hover">
                            + {ao.quantity}× {ao.name} (₹{ao.unitPrice})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Line Total & Remove / Void */}
                <div className="text-right shrink-0">
                  <div className="text-xs font-black text-text-main font-mono">₹{itemSubtotal}</div>
                  <button
                    onClick={() => removeItem(item.cartItemId)}
                    className={`text-[11px] transition-colors mt-0.5 font-mono ${
                      item.kotId
                        ? "text-rose-400/90 hover:text-rose-300 hover:underline"
                        : "text-text-muted hover:text-rose-400"
                    }`}
                    title={item.kotId ? "Void item (already fired to kitchen)" : "Remove item from bill"}
                  >
                    {item.kotId ? "× Void (NCR)" : "× Remove"}
                  </button>
                </div>
              </div>

              {/* Quantity Control Stepper & Modifiers Button */}
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <div className="flex items-center bg-background border border-border rounded-md p-0.5 gap-1">
                  <button
                    onClick={() => updateQuantity(item.cartItemId, -1)}
                    className="w-6 h-6 bg-surface hover:bg-surface-hover text-text-main hover:text-text-main rounded flex items-center justify-center font-bold text-xs"
                  >
                    -
                  </button>
                  <span className="w-6 text-center text-xs font-bold text-primary-hover font-mono">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.cartItemId, +1)}
                    className="w-6 h-6 bg-surface hover:bg-surface-hover text-text-main hover:text-text-main rounded flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>

                {/* Modifiers display or toggle */}
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {item.modifiers && item.modifiers.length > 0 && (
                    <span className="text-[10px] bg-primary-hover/10 text-primary-hover border border-primary px-1.5 py-0.5 rounded truncate max-w-[150px]">
                      {item.modifiers.join(", ")}
                    </span>
                  )}
                  <button
                    onClick={() => openModal("MODIFIERS", item.cartItemId)}
                    className="text-[10px] bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main px-1.5 py-0.5 rounded border border-border-hover shrink-0"
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
          <div className="h-full flex flex-col items-center justify-center text-center text-text-muted py-16 px-4">
            <div className="text-4xl mb-2">🛒</div>
            <p className="text-xs font-semibold text-text-muted">
              {tableNumber ? `No items in ${tableNumber} cart` : "Cart is empty"}
            </p>
            <p className="text-[11px] text-gray-500 mt-1 max-w-[200px]">
              Tap items from grid or punch Short-Code in top search + Enter
            </p>
            {tableId && (
              <button
                onClick={async () => {
                  showNotification("🔄 Checking table for active orders...");
                  const found = await loadTableOrder(tableId, tableNumber || undefined);
                  if (found) {
                    showNotification("✅ Active order loaded from table!");
                  } else {
                    showNotification("ℹ️ Table currently has no active order.");
                  }
                }}
                className="mt-3 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border-hover rounded-lg text-xs font-mono text-primary-hover flex items-center gap-1.5 transition-all shadow-sm"
              >
                <span>🔄 Sync Table Order</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Cart Totals Summary (@gusto/core-logic accuracy) ─── */}
      <div className="bg-background border-t border-border p-3 space-y-1.5 text-xs">
        <div className="flex justify-between text-text-muted">
          <span>Subtotal ({totals.itemCount} items)</span>
          <span className="font-mono text-text-main">₹{totals.subtotal}</span>
        </div>

        {/* Discount Line */}
        <div className="flex justify-between items-center text-text-muted">
          <div className="flex items-center gap-1.5">
            <span>Discount</span>
            <button
              onClick={() => openModal("DISCOUNT")}
              className="text-[10px] bg-surface hover:bg-surface-hover text-primary-hover border border-border px-1.5 py-0.2 rounded font-mono"
            >
              [F4]
            </button>
          </div>
          {discount ? (
            <div className="flex items-center gap-1 text-secondary-hover font-mono">
              <span>-₹{totals.discountAmount}</span>
              <button
                onClick={() => setDiscount(undefined)}
                className="text-text-muted hover:text-rose-400 ml-1 font-sans font-bold"
                title="Remove discount"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => openModal("DISCOUNT")}
              className="text-text-muted hover:text-text-main font-mono text-[11px]"
            >
              Add Discount
            </button>
          )}
        </div>

        {/* GST Tax Breakdown */}
        {totals.taxBreakdown.map((tax, idx) => (
          <div key={idx} className="flex justify-between text-[11px] text-text-muted font-mono">
            <span>GST ({tax.taxRate}%) — CGST + SGST</span>
            <span>₹{tax.totalTax}</span>
          </div>
        ))}

        <div className="border-t border-border/80 pt-2 flex items-center justify-between font-extrabold">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-text-main">NET PAYABLE</span>
            <button
              onClick={async () => {
                if (items.length === 0) {
                  if (tableId) {
                    showNotification(`🔄 Loading active bill for ${tableNumber || "table"}...`);
                    const hasOrder = await loadTableOrder(tableId, tableNumber || undefined, activeOrderId || undefined);
                    if (hasOrder && useCartStore.getState().items.length > 0) {
                      openModal("BILL_PREVIEW");
                      return;
                    }
                  } else if (activeOrderId) {
                    await retrieveHeldBill(activeOrderId);
                    if (useCartStore.getState().items.length > 0) {
                      openModal("BILL_PREVIEW");
                      return;
                    }
                  }
                  showNotification("⚠️ Cart is empty. Add items before viewing bill paper.");
                  return;
                }
                openModal("BILL_PREVIEW");
              }}
              className="text-[10px] bg-primary/10 hover:bg-primary/20 text-primary-hover border border-primary/30 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 transition-all active:scale-95"
              title="Preview 80mm thermal bill paper with 3D backside roll [F11]"
            >
              <span>🧾 Bill Paper</span>
              <span className="text-[9px] opacity-75">[F11]</span>
            </button>
          </div>
          <span className="text-xl text-primary-hover font-mono">₹{totals.grandTotal}</span>
        </div>
      </div>

      {/* ─── Bottom Action Bar (Hold F3, Fire KOT, Split, Settle F12) ─── */}
      <div className="bg-surface border-t border-border p-3 grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            if (items.length > 0) {
              holdCurrentBill("Customer parked bill (F3)");
              showNotification("⏸️ Order parked on hold. Screen cleared.");
            } else {
              openModal("HOLD_BILLS");
            }
          }}
          className="bg-surface-hover hover:bg-surface-hover border border-border-hover text-text-main py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
        >
          <span>⏸️ Hold / Park</span>
          <span className="text-[10px] text-text-muted font-mono">[F3]</span>
        </button>

        <button
          onClick={async () => {
            const unfiredItems = items.filter(i => !i.kotId);
            if (items.length === 0) {
              showNotification("⚠️ Cart is empty. Cannot fire KOT.");
            } else if (unfiredItems.length > 0) {
              await fireKOT();
              showNotification("🔥 KOT Fired to Kitchen!");
            } else {
              showNotification("✅ All items already sent to kitchen. Add new items to fire another KOT.");
            }
          }}
          className={`border py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all ${
            items.some(i => !i.kotId) 
              ? "bg-highlight hover:bg-highlight-hover text-text-inverse border-highlight/50 shadow-md shadow-amber-600/20" 
              : items.length > 0 && items.every(i => !!i.kotId)
                ? "bg-emerald-700/30 border-emerald-500/40 text-emerald-400 cursor-default"
                : "bg-surface-hover border-border-hover text-text-muted cursor-not-allowed"
          }`}
        >
          {items.some(i => !i.kotId) ? (
            <>
              <span>🔥 Fire KOT</span>
              <span className="text-[10px] bg-amber-800/50 px-1 rounded font-mono">
                {items.filter(i => !i.kotId).length} new
              </span>
            </>
          ) : items.length > 0 && items.every(i => !!i.kotId) ? (
            <span>✅ KOT Sent</span>
          ) : (
            <span>🔥 Fire KOT</span>
          )}
        </button>

        <button
          onClick={() => {
            if (items.length === 0) {
              showNotification("⚠️ Cart is empty. Cannot split bill.");
              return;
            }
            openModal("SPLIT_BILL");
          }}
          className="bg-surface-hover hover:bg-surface-hover border border-border-hover text-text-main py-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-1.5">
            <SplitIcon className="w-4 h-4" />
            <span>Split</span>
          </div>
          <span className="text-[10px] text-text-muted font-mono">[F6]</span>
        </button>

        <button
          onClick={async () => {
            if (items.length === 0) {
              if (tableId) {
                showNotification(`🔄 Loading active bill for ${tableNumber || "table"}...`);
                const hasOrder = await loadTableOrder(tableId, tableNumber || undefined, activeOrderId || undefined);
                if (hasOrder && useCartStore.getState().items.length > 0) {
                  openModal("PAYMENT");
                  return;
                }
              } else if (activeOrderId) {
                await retrieveHeldBill(activeOrderId);
                if (useCartStore.getState().items.length > 0) {
                  openModal("PAYMENT");
                  return;
                }
              }
              showNotification("⚠️ Cart is empty. Cannot open settlement screen.");
              return;
            }
            openModal("PAYMENT");
          }}
          className="col-span-3 bg-primary hover:bg-primary-hover text-text-inverse font-black py-3 rounded-xl text-sm shadow-xl shadow-primary/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
        >
          <CashIcon className="w-5 h-5 shrink-0" />
          <span>SETTLE & PAY</span>
          <span className="bg-orange-700/80 px-2 py-0.5 rounded text-xs font-mono border border-primary">
            F12 / Enter
          </span>
        </button>
      </div>
    </aside>
  );
};
