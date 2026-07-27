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
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <span>⏸️ PARKED / HELD BILLS</span>
              <span className="text-xs font-mono bg-amber-600/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30">
                F3
              </span>
            </h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              Select any held transaction to load it directly onto the billing counter
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold"
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
                className="group bg-gray-950 hover:bg-gray-800 border border-gray-800 hover:border-amber-500/60 rounded-xl p-4 flex items-center justify-between transition-all cursor-pointer shadow-md"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-black bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30">
                      {bill.id}
                    </span>
                    <span className="text-sm font-bold text-white">
                      {bill.tableNumber ? bill.tableNumber : `${bill.orderMode} Order`}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">({itemCount} items)</span>
                  </div>

                  <div className="text-xs text-gray-400">
                    {bill.customer ? `👤 ${bill.customer.name} (${bill.customer.phone})` : "No Customer Linked"} • Waiter: {bill.assignedWaiter}
                  </div>

                  <div className="text-[11px] text-amber-400/80 font-mono">
                    Reason: "{bill.reason}" • Held {elapsedMins}m ago
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-base font-black text-orange-400 font-mono">₹{subtotal}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRetrieve(bill.id);
                    }}
                    className="mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow transition-colors"
                  >
                    ▶️ Retrieve
                  </button>
                </div>
              </div>
            );
          })}

          {heldBills.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <div className="text-4xl mb-2">✨</div>
              <p className="text-sm font-semibold text-gray-400">No parked / held bills currently</p>
              <p className="text-xs text-gray-600 mt-1">Press F3 anytime with active items to park an order</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-950 px-6 py-4 border-t border-gray-800 flex justify-end">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded-xl text-xs font-bold border border-gray-700"
          >
            Close [Esc]
          </button>
        </div>
      </div>
    </div>
  );
};
