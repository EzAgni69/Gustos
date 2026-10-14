import React from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

export const HoldBillsModal: React.FC = () => {
  const { heldBills, retrieveHeldBill } = useCartStore();
  const { activeModal, closeModal, showNotification } = useUIStore();

  if (activeModal !== "HOLD_BILLS") return null;

  const handleRetrieve = (id: string) => {
    retrieveHeldBill(id);
    closeModal();
    showNotification(`▶️ Retrieved parked bill ${id} back into active billing cart.`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none">
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-background px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-text-inverse flex items-center gap-2">
              <span>⏸️ PARKED / HELD BILLS</span>
              <span className="text-xs font-mono bg-highlight/20 text-highlight-hover px-2 py-0.5 rounded border border-highlight/30">
                F3
              </span>
            </h2>
            <p className="text-xs text-text-muted font-mono mt-0.5">
              Select any held transaction to load it directly onto the billing counter
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* List of Held Bills */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {heldBills.map((bill) => {
            const itemCount = bill.items.reduce((sum, i) => sum + i.quantity, 0);
            const subtotal = bill.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
            const elapsedMins = Math.round((Date.now() - new Date(bill.heldAt).getTime()) / (1000 * 60));

            return (
              <div
                key={bill.id}
                onClick={() => handleRetrieve(bill.id)}
                className="group bg-background hover:bg-surface-hover border border-border hover:border-highlight/60 rounded-xl p-4 flex items-center justify-between transition-all cursor-pointer shadow-md"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-black bg-highlight-hover/20 text-highlight-hover px-2 py-0.5 rounded border border-highlight/30">
                      {bill.id}
                    </span>
                    <span className="text-sm font-bold text-text-inverse">
                      {bill.tableNumber ? bill.tableNumber : `${bill.orderMode} Order`}
                    </span>
                    <span className="text-xs text-text-muted font-mono">({itemCount} items)</span>
                  </div>

                  <div className="text-xs text-text-muted">
                    {bill.customer ? `👤 ${bill.customer.name} (${bill.customer.phone})` : "No Customer Linked"} • Waiter: {bill.assignedWaiter}
                  </div>

                  <div className="text-[11px] text-highlight-hover/80 font-mono">
                    Reason: "{bill.reason}" • Held {elapsedMins}m ago
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-base font-black text-primary-hover font-mono">₹{subtotal}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRetrieve(bill.id);
                    }}
                    className="mt-2 px-3 py-1.5 bg-highlight hover:bg-highlight-hover text-text-inverse rounded-lg text-xs font-bold shadow transition-colors"
                  >
                    ▶️ Retrieve
                  </button>
                </div>
              </div>
            );
          })}

          {heldBills.length === 0 && (
            <div className="text-center py-16 text-text-muted">
              <div className="text-4xl mb-2">✨</div>
              <p className="text-sm font-semibold text-text-muted">No parked / held bills currently</p>
              <p className="text-xs text-gray-600 mt-1">Press F3 anytime with active items to park an order</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-background px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl text-xs font-bold border border-border-hover"
          >
            Close [Esc]
          </button>
        </div>
      </div>
    </div>
  );
};
