import { useState } from "react";
import { useUIStore } from "../../store/useUIStore";
import { Check, X, AlertCircle } from "lucide-react";

export function OnlineOrderModal() {
  const { activeModal, closeModal, incomingOnlineOrder } = useUIStore();
  const [loading, setLoading] = useState(false);

  if (activeModal !== "ONLINE_ORDER" || !incomingOnlineOrder) return null;

  const handleAccept = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:8080/api/orders/${incomingOnlineOrder.id}/accept-online`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to accept order");
      closeModal();
    } catch (err) {
      console.error(err);
      alert("Error accepting online order");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt("Enter reason for rejection:");
    if (!reason) return;

    setLoading(true);
    try {
      const res = await fetch(`http://localhost:8080/api/orders/${incomingOnlineOrder.id}/reject-online`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Failed to reject order");
      closeModal();
    } catch (err) {
      console.error(err);
      alert("Error rejecting online order");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border-2 border-orange-500 rounded-xl w-[500px] overflow-hidden shadow-2xl animate-pulse-fast">
        {/* Header */}
        <div className="bg-orange-500 p-4 text-center">
          <h2 className="text-2xl font-bold text-white flex items-center justify-center gap-2">
            <AlertCircle className="w-8 h-8" />
            NEW ONLINE ORDER
          </h2>
          <p className="text-orange-100 font-medium">Zomato • #{incomingOnlineOrder.orderNumber}</p>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-4 text-center">
            <p className="text-gray-400">Customer</p>
            <p className="text-xl font-semibold text-white">{incomingOnlineOrder.customerName || "N/A"}</p>
          </div>

          <div className="max-h-60 overflow-y-auto mb-6 bg-gray-950 p-4 rounded-lg">
            {incomingOnlineOrder.items?.map((item: any) => (
              <div key={item.id} className="flex justify-between py-2 border-b border-gray-800 last:border-0">
                <div>
                  <p className="text-white font-medium">
                    {item.quantity}x {item.menuItemName}
                  </p>
                  {item.notes && <p className="text-sm text-gray-400 mt-1">Note: {item.notes}</p>}
                </div>
                <p className="text-white font-medium">₹{(item.quantity * item.unitPrice).toFixed(2)}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg mb-6">
            <p className="text-gray-400 font-medium">Total Amount</p>
            <p className="text-3xl font-bold text-green-400">₹{incomingOnlineOrder.totalAmount?.toFixed(2)}</p>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handleReject}
              disabled={loading}
              className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg bg-gray-800 text-red-500 hover:bg-gray-700 active:scale-95 transition-all"
            >
              <X className="w-6 h-6" />
              REJECT
            </button>
            <button
              onClick={handleAccept}
              disabled={loading}
              className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg bg-green-500 text-white hover:bg-green-600 active:scale-95 transition-all"
            >
              <Check className="w-6 h-6" />
              ACCEPT & PRINT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
