import React, { useState } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { CashIcon, CardIcon, UpiIcon, SplitIcon } from "../common/PaymentIcons";

type SplitMode = "EQUAL" | "BY_AMOUNT" | "BY_ITEM";

interface GuestSplit {
  id: number;
  label: string;
  amount: number;
  mode: "CASH" | "CARD" | "UPI";
}

let guestIdCounter = 1;

export const SplitBillModal: React.FC = () => {
  const { getTotals, paxCount, items, splitItemQuantity, moveItemsToNewOrder } = useCartStore();
  const { activeModal, closeModal, openModal, showNotification } = useUIStore();

  const totals = getTotals();
  const [splitMode, setSplitMode] = useState<SplitMode>("EQUAL");
  const [splitWays, setSplitWays] = useState<number>(Math.max(2, paxCount));

  // By Item Split state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isProcessingSplit, setIsProcessingSplit] = useState(false);

  // Custom amount splits
  const [guestSplits, setGuestSplits] = useState<GuestSplit[]>(() => {
    const perPerson = Math.round((totals.grandTotal / Math.max(2, paxCount)) * 100) / 100;
    return Array.from({ length: Math.max(2, paxCount) }, (_, i) => ({
      id: guestIdCounter++,
      label: `Guest ${i + 1}`,
      amount: i === Math.max(2, paxCount) - 1
        ? Math.round((totals.grandTotal - perPerson * (Math.max(2, paxCount) - 1)) * 100) / 100
        : perPerson,
      mode: "CASH" as const,
    }));
  });

  if (activeModal !== "SPLIT_BILL") return null;

  const perPerson = Math.round((totals.grandTotal / splitWays) * 100) / 100;
  const equalRemainder = Math.round((totals.grandTotal - perPerson * splitWays) * 100) / 100;

  // Custom split validation
  const customTotal = guestSplits.reduce((sum, g) => sum + g.amount, 0);
  const customRemaining = Math.round((totals.grandTotal - customTotal) * 100) / 100;
  const isCustomValid = Math.abs(customRemaining) <= 0.01 && guestSplits.every(g => g.amount > 0);

  const handleEqualSplitConfirm = () => {
    // Open payment modal — the user will handle actual payment there
    // We pass a notification about the split for tracking
    closeModal();
    showNotification(
      `✂️ Bill split ${splitWays} ways — ₹${perPerson} per person. Open Settle & Pay to process each payment.`
    );
  };

  const handleCustomSplitToPayment = () => {
    if (!isCustomValid) {
      showNotification("⚠️ Split amounts must equal the total.");
      return;
    }
    // Close split modal and open payment modal with pre-loaded split legs
    closeModal();
    // Short delay to let modal close animation complete, then open payment
    setTimeout(() => {
      openModal("PAYMENT");
    }, 100);
    showNotification(
      `✂️ Bill split into ${guestSplits.length} custom amounts. Complete payment in settlement screen.`
    );
  };

  const toggleItemSelection = (cartItemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(cartItemId)) next.delete(cartItemId);
      else next.add(cartItemId);
      return next;
    });
  };

  const handleSplitItemQty = async (cartItemId: string) => {
    setIsProcessingSplit(true);
    await splitItemQuantity(cartItemId, 1);
    setIsProcessingSplit(false);
  };

  const handleByItemSplitConfirm = async () => {
    if (selectedItems.size === 0) return;
    
    setIsProcessingSplit(true);
    const res = await moveItemsToNewOrder(Array.from(selectedItems));
    setIsProcessingSplit(false);
    
    if (res.success) {
      showNotification("✂️ Items moved to new bill.");
      closeModal();
    } else {
      showNotification(`⚠️ Failed to move items: ${res.error}`);
    }
  };

  const addGuest = () => {
    setGuestSplits((prev) => [
      ...prev,
      { id: guestIdCounter++, label: `Guest ${prev.length + 1}`, amount: 0, mode: "CASH" },
    ]);
  };

  const removeGuest = (id: number) => {
    if (guestSplits.length <= 2) return;
    setGuestSplits((prev) => prev.filter((g) => g.id !== id));
  };

  const updateGuest = (id: number, updates: Partial<GuestSplit>) => {
    setGuestSplits((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const distributeEvenly = () => {
    const count = guestSplits.length;
    const perGuest = Math.round((totals.grandTotal / count) * 100) / 100;
    setGuestSplits((prev) =>
      prev.map((g, i) => ({
        ...g,
        amount:
          i === count - 1
            ? Math.round((totals.grandTotal - perGuest * (count - 1)) * 100) / 100
            : perGuest,
      }))
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT") {
      if (e.key === "Enter") {
        e.preventDefault();
        if (splitMode === "EQUAL") handleEqualSplitConfirm();
        else handleCustomSplitToPayment();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (splitMode === "EQUAL") handleEqualSplitConfirm();
      else handleCustomSplitToPayment();
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-background px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-black text-text-inverse flex items-center gap-2">
              <SplitIcon className="w-5 h-5 shrink-0" />
              <span>SPLIT BILL</span>
              <span className="text-[10px] font-mono bg-primary/20 text-primary-hover px-2 py-0.5 rounded border border-primary">
                F6
              </span>
            </h2>
            <p className="text-xs text-text-muted font-mono mt-0.5">
              Split calculation & guest-wise breakdown
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Total banner */}
        <div className="bg-background border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[10px] text-text-muted font-mono">Bill Total</div>
            <div className="text-2xl font-black font-mono text-text-inverse">₹{totals.grandTotal}</div>
          </div>
          <div className="text-right text-xs text-text-muted font-mono">
            {totals.itemCount} items • {totals.totalQuantity} qty
          </div>
        </div>

        {/* Split mode tabs */}
        <div className="p-3 grid grid-cols-3 gap-2 border-b border-border shrink-0">
          <button
            onClick={() => setSplitMode("EQUAL")}
            className={`py-2 rounded-lg text-xs font-bold border transition-all ${
              splitMode === "EQUAL"
                ? "bg-primary/20 border-primary text-primary-hover"
                : "bg-surface-hover border-border-hover text-text-muted hover:text-text-main"
            }`}
          >
            Equal Split
          </button>
          <button
            onClick={() => setSplitMode("BY_AMOUNT")}
            className={`py-2 rounded-lg text-xs font-bold border transition-all ${
              splitMode === "BY_AMOUNT"
                ? "bg-primary/20 border-primary text-primary-hover"
                : "bg-surface-hover border-border-hover text-text-muted hover:text-text-main"
            }`}
          >
            Custom Amounts
          </button>
          <button
            onClick={() => setSplitMode("BY_ITEM")}
            className={`py-2 rounded-lg text-xs font-bold border transition-all ${
              splitMode === "BY_ITEM"
                ? "bg-primary/20 border-primary text-primary-hover"
                : "bg-surface-hover border-border-hover text-text-muted hover:text-text-main"
            }`}
          >
            By Items
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {splitMode === "EQUAL" && (
            <>
              <div>
                <label className="block text-xs font-bold text-text-main mb-2 font-mono">
                  Number of Guests / Ways:
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSplitWays(Math.max(2, splitWays - 1))}
                    className="w-10 h-10 bg-surface-hover hover:bg-surface-hover rounded-xl text-lg font-bold text-text-main flex items-center justify-center border border-border-hover"
                  >
                    -
                  </button>
                  <div className="flex-1 bg-background border border-border-hover rounded-xl py-2 text-center font-mono font-bold text-lg text-primary-hover">
                    {splitWays} Ways
                  </div>
                  <button
                    onClick={() => setSplitWays(splitWays + 1)}
                    className="w-10 h-10 bg-surface-hover hover:bg-surface-hover rounded-xl text-lg font-bold text-text-main flex items-center justify-center border border-border-hover"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="bg-primary/10 border border-primary rounded-xl p-4 text-center space-y-1">
                <div className="text-xs text-primary-hover font-mono">Amount Per Person:</div>
                <div className="text-3xl font-black font-mono text-primary-hover">₹{perPerson}</div>
                {equalRemainder !== 0 && (
                  <div className="text-[10px] text-text-muted font-mono">
                    (₹{Math.abs(equalRemainder)} {equalRemainder > 0 ? "extra on last person" : "adjusted"})
                  </div>
                )}
              </div>

              {/* Visual guest breakdown */}
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: Math.min(splitWays, 9) }, (_, i) => (
                  <div
                    key={i}
                    className="bg-background border border-border rounded-lg p-2 text-center"
                  >
                    <div className="text-[10px] text-text-muted font-mono">Guest {i + 1}</div>
                    <div className="text-sm font-bold font-mono text-text-inverse">
                      ₹{i === splitWays - 1 && equalRemainder !== 0
                        ? Math.round((perPerson + equalRemainder) * 100) / 100
                        : perPerson}
                    </div>
                  </div>
                ))}
                {splitWays > 9 && (
                  <div className="bg-background border border-border rounded-lg p-2 text-center">
                    <div className="text-xs text-text-muted font-mono">+{splitWays - 9} more</div>
                  </div>
                )}
              </div>
            </>
          )}

          {splitMode === "BY_AMOUNT" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-main">Guest-wise split:</span>
                <div className="flex gap-2">
                  <button
                    onClick={distributeEvenly}
                    className="text-[10px] bg-surface-hover hover:bg-surface-hover text-text-main px-2 py-1 rounded border border-border-hover font-mono"
                  >
                    Distribute Evenly
                  </button>
                  <button
                    onClick={addGuest}
                    className="text-[10px] bg-surface-hover hover:bg-surface-hover text-primary-hover px-2 py-1 rounded border border-border-hover font-bold"
                  >
                    + Add Guest
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {guestSplits.map((guest, idx) => (
                  <div
                    key={guest.id}
                    className="bg-background border border-border rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded shrink-0">
                      #{idx + 1}
                    </div>

                    {/* Payment mode for this guest */}
                    <div className="flex gap-1 shrink-0">
                      {(["CASH", "CARD", "UPI"] as const).map((mode) => {
                        const Icon = mode === "CASH" ? CashIcon : mode === "CARD" ? CardIcon : UpiIcon;
                        return (
                          <button
                            key={mode}
                            onClick={() => updateGuest(guest.id, { mode })}
                            className={`px-1.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1 ${
                              guest.mode === mode
                                ? "bg-primary/20 border-primary text-primary-hover"
                                : "bg-surface border-border text-gray-600"
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{mode}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Amount */}
                    <div className="flex-1">
                      <input
                        type="number"
                        value={guest.amount}
                        onChange={(e) =>
                          updateGuest(guest.id, { amount: Math.max(0, Number(e.target.value)) })
                        }
                        min={0}
                        className="w-full bg-surface border border-border-hover rounded-lg px-3 py-1.5 text-sm font-mono text-text-main focus:border-primary focus:outline-none"
                        placeholder="₹ Amount"
                      />
                    </div>

                    {/* Remove */}
                    {guestSplits.length > 2 && (
                      <button
                        onClick={() => removeGuest(guest.id)}
                        className="text-gray-600 hover:text-rose-400 text-xs font-bold shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Validation bar */}
              <div
                className={`rounded-xl p-3 flex items-center justify-between border text-xs font-mono ${
                  isCustomValid
                    ? "bg-emerald-950/30 border-emerald-500/30 text-secondary-hover"
                    : "bg-amber-950/30 border-highlight/30 text-highlight-hover"
                }`}
              >
                <span>
                  Total: ₹{customTotal} / ₹{totals.grandTotal}
                </span>
                {isCustomValid ? (
                  <span>✓ Balanced</span>
                ) : (
                  <span>
                    {customRemaining > 0
                      ? `₹${customRemaining} remaining`
                      : `₹${Math.abs(customRemaining)} over`}
                  </span>
                )}
              </div>
            </>
          )}

          {splitMode === "BY_ITEM" && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-text-main">
                Select items to move to a new separate bill.
              </div>
              <div className="space-y-2 border border-border rounded-xl p-2 bg-background max-h-[300px] overflow-y-auto">
                {items.length === 0 && (
                  <div className="text-center text-text-muted text-xs p-4">No items in order</div>
                )}
                {items.map((item) => (
                  <div key={item.cartItemId} className={`flex items-center justify-between p-2 rounded-lg border ${selectedItems.has(item.cartItemId) ? 'bg-orange-900/20 border-primary' : 'bg-surface border-border'}`}>
                    <label className="flex items-center gap-3 flex-1 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-gray-600 bg-surface-hover text-orange-500 focus:ring-orange-500/50"
                        checked={selectedItems.has(item.cartItemId)}
                        onChange={() => toggleItemSelection(item.cartItemId)}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-bold text-text-main">{item.menuItemName}</div>
                        <div className="text-[10px] text-text-muted font-mono">Qty: {item.quantity} • ₹{item.unitPrice}</div>
                      </div>
                    </label>
                    
                    {item.quantity > 1 && (
                      <button 
                        onClick={() => handleSplitItemQty(item.cartItemId)}
                        disabled={isProcessingSplit}
                        className="ml-2 text-[10px] bg-surface-hover hover:bg-surface-hover text-text-main px-2 py-1 rounded border border-border-hover font-mono"
                      >
                        ✂️ Split 1 Qty
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-background px-6 py-4 border-t border-border flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl text-xs font-bold border border-border-hover"
          >
            Cancel [Esc]
          </button>
          {splitMode === "EQUAL" ? (
            <button
              onClick={handleEqualSplitConfirm}
              className="flex-1 bg-primary hover:bg-primary-hover text-text-inverse font-black py-2.5 rounded-xl text-xs shadow-lg shadow-primary/30 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
            >
              <span>APPLY EQUAL SPLIT</span>
              <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-primary">
                Enter
              </span>
            </button>
          ) : splitMode === "BY_AMOUNT" ? (
            <button
              onClick={handleCustomSplitToPayment}
              disabled={!isCustomValid}
              className={`flex-1 font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all ${
                isCustomValid
                  ? "bg-primary hover:bg-primary-hover text-text-inverse shadow-lg shadow-primary/30 active:scale-[0.98]"
                  : "bg-surface-hover text-text-muted cursor-not-allowed border border-border-hover"
              }`}
            >
              <span>PROCEED TO PAYMENT →</span>
              <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-primary">
                Enter
              </span>
            </button>
          ) : (
            <button
              onClick={handleByItemSplitConfirm}
              disabled={selectedItems.size === 0 || isProcessingSplit}
              className={`flex-1 font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all ${
                selectedItems.size > 0 && !isProcessingSplit
                  ? "bg-primary hover:bg-primary-hover text-text-inverse shadow-lg shadow-primary/30 active:scale-[0.98]"
                  : "bg-surface-hover text-text-muted cursor-not-allowed border border-border-hover"
              }`}
            >
              <span>{isProcessingSplit ? "PROCESSING..." : "MOVE TO NEW BILL"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
