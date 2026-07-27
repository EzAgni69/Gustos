import React, { useState, useEffect } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";

export const CustomerModal: React.FC = () => {
  const { customer, setCustomer } = useCartStore();
  const { activeModal, closeModal, showNotification } = useUIStore();

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [points, setPoints] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (activeModal === "CUSTOMER") {
      setPhone(customer?.phone || "");
      setName(customer?.name || "");
      setPoints(customer?.loyaltyPoints);
    }
  }, [activeModal, customer]);

  if (activeModal !== "CUSTOMER") return null;

  const handleSearchPhone = (val: string) => {
    setPhone(val);
    if (val === "9876543210") {
      setName("Amit Sharma");
      setPoints(140);
    } else if (val === "9988776655") {
      setName("Priya Verma");
      setPoints(320);
    } else if (val.length === 10 && !name) {
      setPoints(50); // New loyalty bonus
    }
  };

  const handleSave = () => {
    if (!phone.trim() || !name.trim()) {
      showNotification("⚠️ Please enter valid phone number and customer name.");
      return;
    }
    setCustomer({ name: name.trim(), phone: phone.trim(), loyaltyPoints: points ?? 50 });
    closeModal();
    showNotification(`👤 Customer linked: ${name.trim()} (${points ?? 50} Loyalty Pts)`);
  };

  const handleRemove = () => {
    setCustomer(null);
    closeModal();
    showNotification("👤 Customer unlinked from bill.");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
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
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <span>👤 CUSTOMER & LOYALTY CRM</span>
              <span className="text-[10px] font-mono bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded border border-orange-500/30">
                F9
              </span>
            </h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              Link phone number to accumulate or redeem loyalty points
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1 font-mono">
              Mobile Number (10 digits):
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => handleSearchPhone(e.target.value)}
              placeholder="e.g. 9876543210 (Try this for Amit Sharma)"
              autoFocus
              className="w-full bg-gray-950 border border-gray-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-sm font-mono text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1 font-mono">
              Customer Full Name:
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Amit Sharma"
              className="w-full bg-gray-950 border border-gray-700 focus:border-orange-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none font-sans"
            />
          </div>

          {points !== undefined && (
            <div className="bg-orange-600/10 border border-orange-500/30 rounded-xl p-3 flex items-center justify-between text-orange-300 font-mono text-xs">
              <span>Accumulated Loyalty Points:</span>
              <span className="font-extrabold text-sm text-orange-400">{points} Pts</span>
            </div>
          )}

          {customer && (
            <button
              onClick={handleRemove}
              className="w-full py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/40 text-rose-300 rounded-xl text-xs font-bold transition-colors"
            >
              Unlink Current Customer
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-950 px-6 py-4 border-t border-gray-800 flex items-center justify-between gap-3">
          <button
            onClick={closeModal}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded-xl text-xs font-bold border border-gray-700"
          >
            Cancel [Esc]
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-2.5 rounded-xl text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center gap-1.5"
          >
            <span>SAVE / LINK CUSTOMER</span>
            <span className="text-[10px] bg-orange-700/80 px-1.5 py-0.5 rounded font-mono border border-orange-500/40">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
