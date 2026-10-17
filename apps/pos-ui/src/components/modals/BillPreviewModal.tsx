import React, { useState, useEffect, useRef } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { apiClient } from "../../api/client";

export const BillPreviewModal: React.FC = () => {
  const { activeModal, closeModal, openModal, billPreviewData, showNotification } = useUIStore();
  const {
    activeOrderId: cartActiveOrderId,
    items: cartItems,
    orderNumber: cartOrderNumber,
    orderMode: cartOrderMode,
    tableNumber: cartTableNumber,
    assignedWaiter: cartWaiter,
    customer: cartCustomer,
    discount: cartDiscount,
    getTotals,
  } = useCartStore();

  const [isFlipped, setIsFlipped] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus modal on open for keyboard navigation
  useEffect(() => {
    if (activeModal === "BILL_PREVIEW") {
      setIsFlipped(false);
      modalRef.current?.focus();
    }
  }, [activeModal]);

  if (activeModal !== "BILL_PREVIEW") return null;

  // Resolve bill data from billPreviewData or active cart
  const totals = getTotals();
  const isPaid = billPreviewData?.isPaid ?? false;
  const billNumber = billPreviewData?.invoiceNumber || (isPaid ? `INV-${cartOrderNumber || "4735"}` : `BILL-${cartOrderNumber || "4735"}`);
  const orderNumber = billPreviewData?.orderNumber || cartOrderNumber || "#OUT-20260715-0042";
  const orderMode = billPreviewData?.orderMode || cartOrderMode || "DINE_IN";
  const tableName = billPreviewData?.tableName || cartTableNumber || "T2";
  const cashierName = cartWaiter || "Admin Cashier";
  const customerName = billPreviewData?.customerName || cartCustomer?.name;

  const items = billPreviewData?.items && billPreviewData.items.length > 0
    ? billPreviewData.items
    : cartItems.map((ci) => ({
        name: ci.menuItemName,
        quantity: ci.quantity,
        unitPrice: ci.unitPrice,
        amount: Math.round(ci.unitPrice * ci.quantity * 100) / 100,
        variantName: ci.variantName,
        modifiers: ci.modifiers,
        notes: ci.notes,
      }));

  const subtotal = billPreviewData?.subtotal ?? totals.subtotal;
  const discountAmount = billPreviewData?.discountAmount ?? totals.discountAmount;
  const totalTax = billPreviewData?.taxAmount ?? totals.totalTax;
  const grandTotal = billPreviewData?.grandTotal ?? totals.grandTotal;
  const totalQty = items.reduce((sum, it) => sum + it.quantity, 0);

  const formattedDate = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
  const formattedTime = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const handleFlip = () => {
    setIsFlipped((prev) => !prev);
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    const targetOrderId = billPreviewData?.orderId || cartActiveOrderId;
    try {
      if (targetOrderId) {
        await apiClient(`/print/bill/${targetOrderId}`, {
          method: "POST",
          body: JSON.stringify({ source: "pos" }),
        });
        showNotification("🖨️ Bill sent to thermal printer!");
      } else {
        window.print();
        showNotification("🖨️ Browser print dialog opened!");
      }
    } catch {
      window.print();
    } finally {
      setIsPrinting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    } else if (e.key === " " || e.key.toLowerCase() === "f") {
      e.preventDefault();
      handleFlip();
    } else if (e.key.toLowerCase() === "p" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handlePrint();
    } else if (e.key === "F12" || (e.key === "Enter" && !isPaid)) {
      e.preventDefault();
      closeModal();
      openModal("PAYMENT");
    }
  };

  return (
    <div
      ref={modalRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 outline-none select-none overflow-y-auto"
    >
      {/* ═══ Header Action Control Bar ═══ */}
      <div className="w-full max-w-md flex items-center justify-between mb-3 text-white z-10 px-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧾</span>
          <div>
            <h3 className="text-sm font-black tracking-wide uppercase flex items-center gap-1.5">
              <span>80mm Thermal Bill Paper</span>
              <span className="text-[10px] font-mono font-bold bg-primary/20 text-primary-hover px-1.5 py-0.5 rounded border border-primary/40">
                {isFlipped ? "BACKSIDE ROLL" : "FRONT BILL"}
              </span>
            </h3>
            <p className="text-[11px] text-gray-400 font-mono">
              Press <kbd className="bg-gray-800 px-1 rounded text-gray-300">Space</kbd> or <kbd className="bg-gray-800 px-1 rounded text-gray-300">F</kbd> to Flip • <kbd className="bg-gray-800 px-1 rounded text-gray-300">Esc</kbd> to Close
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Flip Button */}
          <button
            onClick={handleFlip}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-gray-700 border border-border-hover text-xs font-bold text-text-main hover:text-white transition-all active:scale-95 shadow-lg"
            title="Flip paper to see backside [Space / F]"
          >
            <span className="text-base transition-transform duration-300" style={{ transform: isFlipped ? "rotate(180deg)" : "none" }}>
              🔄
            </span>
            <span>{isFlipped ? "View Front (Bill)" : "Flip to Backside"}</span>
          </button>

          {/* Close button */}
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center font-bold text-sm transition-colors"
            title="Close [Esc]"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ═══ 3D Card Container ═══ */}
      <div
        className="w-full max-w-[380px] my-auto cursor-pointer"
        style={{ perspective: "1400px" }}
        onClick={handleFlip}
        title="Click paper to flip"
      >
        <div
          className="relative w-full transition-transform duration-700 ease-out"
          style={{
            transformStyle: "preserve-3d",
            transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* ══════════════════════════════════════════════════════
              FRONT SIDE: Authentic 80mm Thermal Receipt Bill
             ══════════════════════════════════════════════════════ */}
          <div
            className="w-full bg-[#fcfbf7] text-neutral-900 rounded-sm shadow-2xl overflow-hidden relative font-mono text-[12px] leading-relaxed border border-stone-200"
            style={{
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              filter: "drop-shadow(0 20px 25px rgba(0, 0, 0, 0.45))",
            }}
          >
            {/* Top Serrated Jagged Tear Edge */}
            <div className="w-full h-3 bg-repeat-x overflow-hidden opacity-90"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'%3E%3Cpolygon points='0,0 8,8 16,0' fill='%23111827'/%3E%3C/svg%3E")`,
                backgroundSize: "14px 7px",
              }}
            />

            {/* Receipt Content */}
            <div className="px-5 py-4 space-y-3">
              {/* ─── Zone A: Header (Brand & Info) ─── */}
              <div className="text-center space-y-1">
                <div className="flex justify-center mb-1">
                  <img
                    src="/logo.png"
                    alt="Gusto's"
                    className="h-14 object-contain mx-auto filter contrast-125"
                  />
                </div>

                <div className="inline-block border border-neutral-800 px-3 py-0.5 text-[11px] font-black tracking-wider uppercase">
                  {isPaid ? "TAX INVOICE • PAID" : "BILL • PRE-CHECK"}
                </div>

                <div className="font-extrabold text-base tracking-tight text-black pt-1">
                  Gusto's Pizzeria
                </div>
                <div className="text-[11px] text-neutral-600 leading-tight">
                  Shop 4, Ground Floor, Food Street, City Center<br />
                  Phone: +91 98765 43210
                </div>
              </div>

              {/* Dotted Divider */}
              <div className="border-b border-dashed border-neutral-400 my-2" />

              {/* ─── Zone B: Order Metadata ─── */}
              <div className="text-[11px] space-y-0.5 text-neutral-700">
                {customerName && (
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span className="font-bold text-neutral-900">{customerName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Date & Time:</span>
                  <span>{formattedDate} {formattedTime}</span>
                </div>
                <div className="flex justify-between font-bold text-neutral-900">
                  <span>{orderMode === "DINE_IN" ? `Dine In (${tableName})` : orderMode}:</span>
                  <span>{orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Bill No:</span>
                  <span className="font-bold">{billNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cashier:</span>
                  <span>{cashierName}</span>
                </div>
              </div>

              {/* Dotted Divider */}
              <div className="border-b border-dashed border-neutral-400 my-2" />

              {/* ─── Zone C: Line Items ─── */}
              <div>
                <div className="grid grid-cols-12 font-bold text-[11px] border-b border-neutral-800 pb-1 mb-1.5 text-neutral-800">
                  <div className="col-span-6 text-left">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Price</div>
                  <div className="col-span-2 text-right">Amt</div>
                </div>

                <div className="space-y-1.5 divide-y divide-dashed divide-neutral-200">
                  {items.map((item, idx) => (
                    <div key={idx} className="pt-1 first:pt-0">
                      <div className="grid grid-cols-12 text-[11px]">
                        <div className="col-span-6 text-left font-semibold text-neutral-900 break-words pr-1">
                          {item.name}
                        </div>
                        <div className="col-span-2 text-right">{item.quantity}</div>
                        <div className="col-span-2 text-right">₹{item.unitPrice}</div>
                        <div className="col-span-2 text-right font-bold text-neutral-900">
                          ₹{item.amount || item.unitPrice * item.quantity}
                        </div>
                      </div>

                      {item.variantName && (
                        <div className="text-[10px] text-neutral-600 pl-2 italic">
                          ↳ {item.variantName}
                        </div>
                      )}
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div className="text-[10px] text-neutral-600 pl-2">
                          * {item.modifiers.join(", ")}
                        </div>
                      )}
                      {item.notes && (
                        <div className="text-[10px] text-neutral-500 pl-2">
                          [Note: {item.notes}]
                        </div>
                      )}
                    </div>
                  ))}

                  {items.length === 0 && (
                    <div className="text-center py-4 text-neutral-400 italic text-[11px]">
                      No items in order
                    </div>
                  )}
                </div>
              </div>

              {/* Dotted Divider */}
              <div className="border-b border-dashed border-neutral-400 my-2" />

              {/* ─── Zone D: Billing Summary ─── */}
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Total Qty: {totalQty}</span>
                  <span className="font-bold">Sub Total: ₹{subtotal.toFixed(2)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-neutral-800 font-semibold">
                    <span>Discount:</span>
                    <span>-₹{discountAmount.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between text-neutral-700 text-[10px]">
                  <span>CGST (2.5%):</span>
                  <span>₹{(totalTax / 2).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-neutral-700 text-[10px]">
                  <span>SGST (2.5%):</span>
                  <span>₹{(totalTax / 2).toFixed(2)}</span>
                </div>

                {/* Grand Total */}
                <div className="border-t-2 border-b-2 border-neutral-900 py-1.5 my-2 flex items-center justify-between font-black text-sm">
                  <span>GRAND TOTAL</span>
                  <span className="text-base tracking-tight">₹{grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* ─── Zone E: Footer & Compliance ─── */}
              <div className="text-center text-[10px] text-neutral-600 space-y-1 pt-1">
                <div className="font-bold text-neutral-800">
                  {isPaid ? "Paid via Cash / UPI" : "Payment Pending"}
                </div>
                <div>GSTIN: 27AABCG1234F1Z5</div>
                <div>FSSAI Lic No: 11521000000123</div>
                <div className="font-semibold text-neutral-800 pt-1">
                  Thank You! Visit Again!
                </div>
                <div className="text-[9px] text-neutral-400 pt-0.5">
                  *** Powered by Gusto's ERP ***
                </div>
              </div>
            </div>

            {/* Bottom Serrated Jagged Tear Edge */}
            <div className="w-full h-3 bg-repeat-x overflow-hidden opacity-90 rotate-180"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'%3E%3Cpolygon points='0,0 8,8 16,0' fill='%23111827'/%3E%3C/svg%3E")`,
                backgroundSize: "14px 7px",
              }}
            />

            {/* Flip hint banner */}
            <div className="bg-neutral-200/90 text-neutral-700 text-center py-1 text-[10px] font-bold tracking-wide flex items-center justify-center gap-1">
              <span>🔄 Click paper to see backside roll pattern</span>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              BACKSIDE: Continuous Repeating Gusto's Red Logo Pattern
              (Exactly matching the user's reference photo)
             ══════════════════════════════════════════════════════ */}
          <div
            className="absolute inset-0 w-full bg-[#FCFBF7] rounded-sm shadow-2xl overflow-hidden border border-stone-200 flex flex-col justify-between"
            style={{
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              filter: "drop-shadow(0 20px 25px rgba(0, 0, 0, 0.45))",
            }}
          >
            {/* Top Serrated Jagged Tear Edge */}
            <div className="w-full h-3 bg-repeat-x overflow-hidden opacity-90 shrink-0"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'%3E%3Cpolygon points='0,0 8,8 16,0' fill='%23111827'/%3E%3C/svg%3E")`,
                backgroundSize: "14px 7px",
              }}
            />

            {/* Continuous Logo Pattern Container */}
            <div
              className="flex-1 w-full relative min-h-[480px]"
              style={{
                backgroundImage: "url('/logo-red-monochrome.png')",
                backgroundRepeat: "repeat-y",
                backgroundPosition: "center top",
                backgroundSize: "260px auto",
                opacity: 0.96,
              }}
            >
              {/* Subtle authentic paper grain texture overlay */}
              <div
                className="absolute inset-0 pointer-events-none mix-blend-multiply opacity-20"
                style={{
                  backgroundImage: `radial-gradient(#d32f2f 0.5px, transparent 0.5px)`,
                  backgroundSize: "8px 8px",
                }}
              />

              {/* Floating watermark badge indicating backside */}
              <div className="absolute top-2 right-2 bg-red-900/10 border border-red-900/20 text-red-800 text-[9px] font-bold px-1.5 py-0.5 rounded font-mono">
                ROLL BACKSIDE
              </div>
            </div>

            {/* Bottom Serrated Jagged Tear Edge */}
            <div className="w-full h-3 bg-repeat-x overflow-hidden opacity-90 rotate-180 shrink-0"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'%3E%3Cpolygon points='0,0 8,8 16,0' fill='%23111827'/%3E%3C/svg%3E")`,
                backgroundSize: "14px 7px",
              }}
            />

            {/* Flip hint banner */}
            <div className="bg-red-50 text-red-800 text-center py-1 text-[10px] font-bold tracking-wide flex items-center justify-center gap-1 border-t border-red-100 shrink-0">
              <span>🔄 Click paper to flip back to bill receipt</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Floating Bottom Action Buttons ═══ */}
      <div className="w-full max-w-lg flex items-center justify-center gap-2.5 mt-4 z-10 px-2">
        <button
          onClick={handleFlip}
          className="flex-1 py-2 px-3 rounded-xl bg-surface-hover hover:bg-gray-700 text-white border border-border-hover text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-all"
        >
          <span>🔄</span>
          <span>{isFlipped ? "Front Bill" : "Backside"}</span>
        </button>

        <button
          onClick={handlePrint}
          disabled={isPrinting}
          className="flex-1 py-2 px-3 rounded-xl bg-surface-hover hover:bg-gray-700 text-white border border-border-hover text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-all disabled:opacity-50"
        >
          {isPrinting ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <span>🖨️ Print [P]</span>
          )}
        </button>

        {!isPaid && (
          <button
            onClick={() => {
              closeModal();
              openModal("PAYMENT");
            }}
            className="flex-1 py-2 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-lg shadow-primary/30 active:scale-95 transition-all"
          >
            <span>💳 Settle & Pay [F12]</span>
          </button>
        )}
      </div>
    </div>
  );
};
