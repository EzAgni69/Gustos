import React, { useState, useEffect, useCallback, useRef } from "react";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { useTableStore } from "../../store/useTableStore";
import { useShiftStore } from "../../store/useShiftStore";
import {
  CashIcon,
  CardIcon,
  UpiIcon,
  SplitIcon,
  GPayLogo,
  PhonePeLogo,
  PaytmLogo,
  OtherUpiLogo,
  VisaLogo,
  MastercardLogo,
  RuPayLogo,
  AmexLogo,
  OtherCardLogo,
  EdcTerminalIcon,
  CheckmarkIcon,
  WarningAlertIcon,
} from "../common/PaymentIcons";

type TenderMode = "CASH" | "CARD" | "UPI" | "SPLIT";

interface SplitLeg {
  id: number;
  mode: "CASH" | "CARD" | "UPI";
  subMethod?: string;
  amount: number;
  reference?: string;
}

const UPI_SUBMETHODS = [
  { id: "PHONEPE", label: "PhonePe", icon: PhonePeLogo },
  { id: "GPAY", label: "GPay", icon: GPayLogo },
  { id: "PAYTM", label: "Paytm", icon: PaytmLogo },
  { id: "OTHER_UPI", label: "Other UPI", icon: OtherUpiLogo },
];

const CARD_SUBMETHODS = [
  { id: "VISA", label: "Visa", icon: VisaLogo },
  { id: "MASTERCARD", label: "Mastercard", icon: MastercardLogo },
  { id: "RUPAY", label: "RuPay", icon: RuPayLogo },
  { id: "AMEX", label: "Amex", icon: AmexLogo },
  { id: "OTHER_CARD", label: "Other", icon: OtherCardLogo },
];

const TIP_PRESETS = [
  { pct: 5, label: "5%" },
  { pct: 10, label: "10%" },
  { pct: 15, label: "15%" },
];

let splitIdCounter = 1;

const roundCurrency = (amount: number): number =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

export const PaymentModal: React.FC = () => {
  const { getTotals, orderMode, orderNumber, tableId, checkoutOrder, isProcessingPayment } =
    useCartStore();
  const { activeModal, closeModal, openModal, showNotification } = useUIStore();
  const { setTableStatus } = useTableStore();
  const { shiftWarning } = useShiftStore();

  const totals = getTotals();
  const modalRef = useRef<HTMLDivElement>(null);

  // ── Tender mode state ──
  const [tenderMode, setTenderMode] = useState<TenderMode>("CASH");

  // ── Cash state ──
  const [tenderedAmount, setTenderedAmount] = useState<number>(totals.grandTotal);

  // ── Sub-method state (Card / UPI) ──
  const [upiSubMethod, setUpiSubMethod] = useState<string>("GPAY");
  const [cardSubMethod, setCardSubMethod] = useState<string>("VISA");

  // ── Tip state ──
  const [tipEnabled, setTipEnabled] = useState(false);
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [customTipActive, setCustomTipActive] = useState(false);

  // ── Split state ──
  const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([
    { id: splitIdCounter++, mode: "CASH", amount: Math.round(totals.grandTotal / 2) },
    {
      id: splitIdCounter++,
      mode: "UPI",
      amount: totals.grandTotal - Math.round(totals.grandTotal / 2),
    },
  ]);

  // ── Settlement result ──
  const [settleResult, setSettleResult] = useState<{
    success: boolean;
    invoiceNumber?: string;
  } | null>(null);

  // ── Recalculate when modal opens ──
  useEffect(() => {
    if (activeModal === "PAYMENT") {
      setTenderedAmount(totals.grandTotal);
      setSettleResult(null);
      setTipEnabled(false);
      setTipAmount(0);
      setCustomTipActive(false);
      const half = Math.round(totals.grandTotal / 2);
      setSplitLegs([
        { id: splitIdCounter++, mode: "CASH", amount: half },
        { id: splitIdCounter++, mode: "UPI", amount: totals.grandTotal - half },
      ]);
    }
  }, [activeModal, totals.grandTotal]);

  // Focus the modal container for keyboard shortcuts
  useEffect(() => {
    if (activeModal === "PAYMENT" && modalRef.current) {
      modalRef.current.focus();
    }
  }, [activeModal, tenderMode]);

  // ── Derived values ──
  const effectiveTip = tipEnabled ? roundCurrency(tipAmount) : 0;
  const totalWithTip = roundCurrency(totals.grandTotal + effectiveTip);
  const changeDue =
    tenderMode === "CASH"
      ? Math.max(0, roundCurrency(tenderedAmount - totalWithTip))
      : 0;

  const splitTotal = roundCurrency(splitLegs.reduce((sum, l) => sum + l.amount, 0));
  const splitRemaining = roundCurrency(totalWithTip - splitTotal);
  const isSplitValid =
    splitLegs.length >= 2 &&
    splitLegs.every((l) => l.amount > 0) &&
    Math.abs(splitRemaining) <= 0.01;

  const canSettle =
    !isProcessingPayment &&
    (tenderMode === "CASH"
      ? tenderedAmount >= totalWithTip
      : tenderMode === "SPLIT"
        ? isSplitValid
        : true);

  // ── Cash denominations ──
  const cashDenominations = [
    totalWithTip,
    Math.ceil(totalWithTip / 10) * 10,
    Math.ceil(totalWithTip / 50) * 50,
    Math.ceil(totalWithTip / 100) * 100,
    Math.ceil(totalWithTip / 500) * 500,
    1000,
    2000,
  ]
    .filter((v, i, self) => self.indexOf(v) === i && v >= totalWithTip)
    .slice(0, 5);

  // ── Tip helpers ──
  const applyTipPreset = (pct: number) => {
    setCustomTipActive(false);
    setTipAmount(roundCurrency((totals.grandTotal * pct) / 100));
  };

  // ── Split helpers ──
  const addSplitLeg = () => {
    setSplitLegs((prev) => [...prev, { id: splitIdCounter++, mode: "CASH", amount: 0 }]);
  };
  const removeSplitLeg = (id: number) => {
    if (splitLegs.length <= 2) return;
    setSplitLegs((prev) => prev.filter((l) => l.id !== id));
  };
  const updateSplitLeg = (id: number, updates: Partial<SplitLeg>) => {
    setSplitLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };
  const autoFillLastLeg = () => {
    if (splitLegs.length < 2) return;
    const allButLast = splitLegs.slice(0, -1);
    const usedAmount = allButLast.reduce((sum, l) => sum + l.amount, 0);
    const remaining = Math.max(0, roundCurrency(totalWithTip - usedAmount));
    const lastLeg = splitLegs[splitLegs.length - 1]!;
    updateSplitLeg(lastLeg.id, { amount: remaining });
  };

  // ── Settlement handler ──
  const handleSettle = useCallback(async () => {
    if (!canSettle || isProcessingPayment) return;

    let paymentMode: string = tenderMode;
    let paymentSubMethod: string | undefined;
    let paymentSplits: SplitLeg[] | undefined;

    if (tenderMode === "UPI") {
      paymentSubMethod = upiSubMethod;
    } else if (tenderMode === "CARD") {
      paymentSubMethod = cardSubMethod;
    } else if (tenderMode === "SPLIT") {
      paymentMode = "SPLIT";
      paymentSplits = splitLegs.map((l) => ({
        ...l,
        subMethod: l.mode === "UPI" ? l.subMethod : l.mode === "CARD" ? l.subMethod : undefined,
      }));
    }

    const result = await checkoutOrder({
      paymentMode,
      paymentSubMethod,
      paymentSplits: paymentSplits?.map((l) => ({
        mode: l.mode,
        subMethod: l.subMethod,
        amount: l.amount,
        reference: l.reference,
      })),
      tipAmount: effectiveTip > 0 ? effectiveTip : undefined,
      tenderedAmount: tenderMode === "CASH" ? tenderedAmount : undefined,
      changeDue: tenderMode === "CASH" ? changeDue : undefined,
    });

    if (result.success) {
      setSettleResult({ success: true, invoiceNumber: result.invoiceNumber });

      if (orderMode === "DINE_IN" && tableId) {
        setTableStatus(tableId, "VACANT");
      }

      // Auto-kick cash drawer if cash was involved
      if (
        paymentMode === "CASH" ||
        (paymentMode === "SPLIT" && paymentSplits?.some((l) => l.mode === "CASH"))
      ) {
        import("../../api/client").then(({ apiClient }) => {
          apiClient("/print/open-drawer", { method: "POST" }).catch(() => {});
        });
      }

      // Show success briefly then close
      setTimeout(() => {
        closeModal();
        showNotification(
          result.printed
            ? `✅ Order Settled! Invoice ${result.invoiceNumber || ""} printed.`
            : `✅ Order Settled! (Print may have failed)`
        );
      }, 1200);
    } else {
      setSettleResult(null);
      showNotification(`❌ ${result.error || "Settlement failed. Please try again."}`);
    }
  }, [
    canSettle,
    isProcessingPayment,
    tenderMode,
    upiSubMethod,
    cardSubMethod,
    splitLegs,
    effectiveTip,
    totalWithTip,
    tenderedAmount,
    changeDue,
    checkoutOrder,
    orderMode,
    tableId,
    setTableStatus,
    closeModal,
    showNotification,
  ]);

  // ── Keyboard handler ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't intercept typing in inputs
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSettle();
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      handleSettle();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
    // Mode switching only when not in input
    if (e.key.toLowerCase() === "c" && !e.ctrlKey && !e.altKey) setTenderMode("CASH");
    if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.altKey) setTenderMode("CARD");
    if (e.key.toLowerCase() === "u" && !e.ctrlKey && !e.altKey) setTenderMode("UPI");
    if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.altKey) setTenderMode("SPLIT");
  };

  if (activeModal !== "PAYMENT") return null;

  // ── Success overlay ──
  if (settleResult?.success) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center backdrop-blur-sm">
        <div className="bg-surface border border-emerald-500/50 rounded-2xl p-10 text-center shadow-2xl shadow-emerald-500/20 animate-[scaleIn_0.3s_ease-out]">
          <div className="flex justify-center mb-4">
            <CheckmarkIcon className="w-16 h-16" />
          </div>
          <h2 className="text-2xl font-black text-text-inverse mb-2">Payment Received!</h2>
          {settleResult.invoiceNumber && (
            <p className="text-sm font-mono text-secondary-hover">
              Invoice: {settleResult.invoiceNumber}
            </p>
          )}
          <p className="text-xs text-text-muted mt-3">Printing bill & closing...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={modalRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* ═══ Header ═══ */}
        <div className="bg-background px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-black text-text-inverse flex items-center gap-2">
              <CashIcon className="w-5 h-5 shrink-0" />
              <span>BILL SETTLEMENT</span>
              <span className="text-xs font-mono bg-primary/20 text-primary-hover px-2 py-0.5 rounded border border-primary">
                F12
              </span>
            </h2>
            <p className="text-xs text-text-muted font-mono mt-0.5">
              Order {orderNumber || "#---"} • Mode: {orderMode}
            </p>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-surface-hover text-text-muted hover:text-text-main flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>


        {/* ═══ Shift Warning Banner ═══ */}
        {shiftWarning && (
          <div className="bg-highlight-hover/10 border-b border-highlight/20 px-6 py-2 flex items-center justify-center gap-2">
            <WarningAlertIcon className="w-4 h-4 shrink-0" />
            <span className="text-highlight-hover text-xs font-bold">{shiftWarning}</span>
          </div>
        )}

        {/* ═══ Grand Total Banner ═══ */}
        <div className="bg-gradient-to-r from-orange-900/40 via-gray-900 to-gray-900 border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="text-xs font-bold text-text-muted tracking-wider uppercase">
              Total Payable
            </div>
            <div className="text-3xl font-black text-primary-hover font-mono mt-0.5">
              ₹{totals.grandTotal}
            </div>
          </div>
          <div className="text-right text-xs text-text-muted font-mono space-y-0.5">
            <div>Items: {totals.itemCount} (Qty: {totals.totalQuantity})</div>
            <div>Tax (GST): ₹{totals.totalTax}</div>
            {totals.discountAmount > 0 && (
              <div className="text-secondary-hover">Discount: -₹{totals.discountAmount}</div>
            )}
          </div>
        </div>

        {/* ═══ Tender Mode Tabs ═══ */}
        <div className="p-4 grid grid-cols-4 gap-2 border-b border-border bg-background/50 shrink-0">
          {(
            [
              { id: "CASH", label: "Cash", key: "C", icon: CashIcon },
              { id: "CARD", label: "Card / POS", key: "R", icon: CardIcon },
              { id: "UPI", label: "UPI / QR", key: "U", icon: UpiIcon },
              { id: "SPLIT", label: "Split Pay", key: "S", icon: SplitIcon },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setTenderMode(tab.id)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all ${
                  tenderMode === tab.id
                    ? "bg-primary text-text-inverse border-primary shadow-md shadow-primary/30 font-extrabold scale-[1.02]"
                    : "bg-surface-hover text-text-muted border-border-hover hover:text-text-main hover:bg-surface-hover"
                }`}
              >
                <div className="mb-1">
                  <Icon className="w-6 h-6" />
                </div>
                <span>{tab.label}</span>
                <span className="text-[10px] font-mono mt-0.5 opacity-80">[{tab.key}]</span>
              </button>
            );
          })}
        </div>

        {/* ═══ Dynamic Tender Content ═══ */}
        <div className="p-6 flex-1 overflow-y-auto">
          {/* ── CASH ── */}
          {tenderMode === "CASH" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-main mb-1.5">
                  Tendered Cash Amount (₹)
                </label>
                <input
                  type="number"
                  value={tenderedAmount}
                  onChange={(e) => setTenderedAmount(Number(e.target.value))}
                  autoFocus
                  min={0}
                  className="w-full bg-background border border-border-hover focus:border-primary rounded-xl px-4 py-3 text-xl font-mono font-bold text-text-main focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-colors"
                />
              </div>

              {/* Denomination quick buttons */}
              <div>
                <div className="text-xs text-text-muted mb-2 font-mono">Quick Denominations:</div>
                <div className="flex flex-wrap gap-2">
                  {cashDenominations.map((denom) => (
                    <button
                      key={denom}
                      onClick={() => setTenderedAmount(denom)}
                      className={`px-3.5 py-2 rounded-lg border text-xs font-mono font-bold transition-all ${
                        tenderedAmount === denom
                          ? "bg-primary/20 border-primary text-primary-hover shadow-sm shadow-orange-500/20"
                          : "bg-surface-hover border-border-hover text-text-main hover:bg-surface-hover hover:border-gray-600"
                      }`}
                    >
                      ₹{denom} {denom === totalWithTip ? "(Exact)" : ""}
                    </button>
                  ))}
                </div>
              </div>

              {/* Change due */}
              <div
                className={`rounded-xl p-4 flex items-center justify-between border ${
                  tenderedAmount >= totalWithTip
                    ? "bg-emerald-950/40 border-emerald-500/30"
                    : "bg-rose-950/30 border-rose-500/30"
                }`}
              >
                <span className="text-sm font-bold text-text-main">Change Due:</span>
                <span
                  className={`text-2xl font-black font-mono ${
                    tenderedAmount >= totalWithTip ? "text-secondary-hover" : "text-rose-400"
                  }`}
                >
                  {tenderedAmount >= totalWithTip ? `₹${changeDue}` : `Short ₹${Math.round((totalWithTip - tenderedAmount) * 100) / 100}`}
                </span>
              </div>
            </div>
          )}

          {/* ── CARD ── */}
          {tenderMode === "CARD" && (
            <div className="space-y-5">
              <div className="text-center py-4 space-y-2">
                <div className="flex justify-center mb-1">
                  <EdcTerminalIcon className="w-12 h-12" />
                </div>
                <p className="text-sm font-bold text-text-inverse">Swipe / Dip / Tap Card on EDC Terminal</p>
                <p className="text-xs text-text-muted max-w-sm mx-auto">
                  Once approved on physical terminal, select card network and confirm below.
                </p>
              </div>

              <div>
                <div className="text-xs font-bold text-text-main mb-2">Card Network (for CA records):</div>
                <div className="grid grid-cols-5 gap-2">
                  {CARD_SUBMETHODS.map((sub) => {
                    const Logo = sub.icon;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => setCardSubMethod(sub.id)}
                        className={`px-2 py-2 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1.5 ${
                          cardSubMethod === sub.id
                            ? "bg-blue-600/20 border-blue-500 text-blue-300"
                            : "bg-surface-hover border-border-hover text-text-muted hover:text-text-main hover:bg-surface-hover"
                        }`}
                      >
                        <Logo className="w-5 h-5" />
                        <span>{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-background border border-border rounded-xl p-4 text-center">
                <span className="text-sm font-bold text-text-main">Amount: </span>
                <span className="text-xl font-black font-mono text-primary-hover">₹{totalWithTip}</span>
              </div>
            </div>
          )}

          {/* ── UPI ── */}
          {tenderMode === "UPI" && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
                <div className="bg-white p-3 rounded-2xl shadow-md shrink-0">
                  <div className="w-36 h-36 border-2 border-dashed border-gray-400 rounded-xl flex flex-col items-center justify-center bg-gray-50 text-gray-900 p-2 text-center">
                    <UpiIcon className="w-9 h-9 mb-1" />
                    <div className="text-[10px] font-bold font-mono">SCAN TO PAY</div>
                    <div className="text-[11px] font-black font-mono text-orange-600 mt-1">
                      ₹{totalWithTip}
                    </div>
                  </div>
                </div>
                <div className="space-y-2 text-left">
                  <div className="text-sm font-bold text-text-inverse">UPI Payment</div>
                  <div className="text-xs text-secondary-hover flex items-center gap-2 font-medium">
                    <span className="w-2 h-2 rounded-full bg-secondary-hover animate-pulse" />
                    <span>Awaiting customer payment...</span>
                  </div>
                  <div className="text-[11px] text-text-muted pt-1">
                    Press Enter after customer confirms successful payment.
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-text-main mb-2">UPI App (for CA records):</div>
                <div className="grid grid-cols-4 gap-2">
                  {UPI_SUBMETHODS.map((sub) => {
                    const Logo = sub.icon;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => setUpiSubMethod(sub.id)}
                        className={`px-2 py-2.5 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center gap-1.5 ${
                          upiSubMethod === sub.id
                            ? "bg-purple-600/20 border-purple-500 text-purple-300"
                            : "bg-surface-hover border-border-hover text-text-muted hover:text-text-main hover:bg-surface-hover"
                        }`}
                      >
                        <Logo className="w-6 h-6" />
                        <span>{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── SPLIT ── */}
          {tenderMode === "SPLIT" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-text-main">
                  Split across multiple payment modes:
                </div>
                <button
                  onClick={addSplitLeg}
                  className="text-[11px] bg-surface-hover hover:bg-surface-hover text-primary-hover px-2.5 py-1 rounded-lg border border-border-hover font-bold"
                >
                  + Add Leg
                </button>
              </div>

              <div className="space-y-3">
                {splitLegs.map((leg, idx) => (
                  <div
                    key={leg.id}
                    className="bg-background border border-border rounded-xl p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded">
                        Leg {idx + 1}
                      </span>
                      {splitLegs.length > 2 && (
                        <button
                          onClick={() => removeSplitLeg(leg.id)}
                          className="text-[10px] text-text-muted hover:text-rose-400 font-mono"
                        >
                          × Remove
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {/* Mode selector */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1">Payment Mode</div>
                        <div className="flex gap-1">
                          {(["CASH", "CARD", "UPI"] as const).map((mode) => {
                            const Icon = mode === "CASH" ? CashIcon : mode === "CARD" ? CardIcon : UpiIcon;
                            return (
                              <button
                                key={mode}
                                onClick={() => updateSplitLeg(leg.id, { mode })}
                                className={`flex-1 px-1.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                                  leg.mode === mode
                                    ? "bg-primary/20 border-primary text-primary-hover"
                                    : "bg-surface border-border-hover text-text-muted hover:text-text-main"
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5 shrink-0" />
                                <span>{mode}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Amount input */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1">Amount (₹)</div>
                        <input
                          type="number"
                          value={leg.amount}
                          onChange={(e) =>
                            updateSplitLeg(leg.id, { amount: Math.max(0, Number(e.target.value)) })
                          }
                          min={0}
                          className="w-full bg-surface border border-border-hover rounded-lg px-3 py-1.5 text-sm font-mono text-text-main focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Sub-method for UPI/Card legs */}
                    {leg.mode === "UPI" && (
                      <div className="flex gap-1 flex-wrap">
                        {UPI_SUBMETHODS.map((sub) => {
                          const Logo = sub.icon;
                          return (
                            <button
                              key={sub.id}
                              onClick={() => updateSplitLeg(leg.id, { subMethod: sub.id })}
                              className={`px-2 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1 ${
                                leg.subMethod === sub.id
                                  ? "bg-purple-600/20 border-purple-500 text-purple-300"
                                  : "bg-surface border-border text-text-muted hover:text-text-main"
                              }`}
                            >
                              <Logo className="w-3.5 h-3.5" />
                              <span>{sub.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {leg.mode === "CARD" && (
                      <div className="flex gap-1 flex-wrap">
                        {CARD_SUBMETHODS.map((sub) => {
                          const Logo = sub.icon;
                          return (
                            <button
                              key={sub.id}
                              onClick={() => updateSplitLeg(leg.id, { subMethod: sub.id })}
                              className={`px-2 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1 ${
                                leg.subMethod === sub.id
                                  ? "bg-blue-600/20 border-blue-500 text-blue-300"
                                  : "bg-surface border-border text-text-muted hover:text-text-main"
                              }`}
                            >
                              <Logo className="w-3.5 h-3.5" />
                              <span>{sub.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Split summary bar */}
              <div
                className={`rounded-xl p-3 flex items-center justify-between border text-xs font-mono ${
                  isSplitValid
                    ? "bg-emerald-950/30 border-emerald-500/30 text-secondary-hover"
                    : "bg-amber-950/30 border-highlight/30 text-highlight-hover"
                }`}
              >
                <span>
                  Allocated: ₹{splitTotal} / ₹{totalWithTip}
                </span>
                {!isSplitValid && (
                  <div className="flex items-center gap-2">
                    <span className="text-amber-300">
                      {splitRemaining > 0
                        ? `₹${splitRemaining} remaining`
                        : `₹${Math.abs(splitRemaining)} over-allocated`}
                    </span>
                    {splitRemaining > 0 && (
                      <button
                        onClick={autoFillLastLeg}
                        className="text-[10px] bg-highlight/20 border border-highlight/40 px-2 py-0.5 rounded text-amber-300 font-bold hover:bg-highlight/30"
                      >
                        Auto-fill last
                      </button>
                    )}
                  </div>
                )}
                {isSplitValid && <span>✓ Balanced</span>}
              </div>
            </div>
          )}

          {/* ═══ Tip / Gratuity Section (all modes) ═══ */}
          <div className="mt-5 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-text-main">Tip / Gratuity (Optional)</span>
              <button
                onClick={() => {
                  setTipEnabled(!tipEnabled);
                  if (!tipEnabled) {
                    // Default 10%
                    setTipAmount(roundCurrency((totals.grandTotal * 10) / 100));
                    setCustomTipActive(false);
                  } else {
                    setTipAmount(0);
                  }
                }}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  tipEnabled ? "bg-primary" : "bg-surface-hover"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    tipEnabled ? "left-5.5 translate-x-0" : "left-0.5"
                  }`}
                  style={{ left: tipEnabled ? "22px" : "2px" }}
                />
              </button>
            </div>

            {tipEnabled && (
              <div className="flex items-center gap-2 flex-wrap">
                {TIP_PRESETS.map((preset) => {
                  const presetAmount = roundCurrency((totals.grandTotal * preset.pct) / 100);
                  return (
                    <button
                      key={preset.pct}
                      onClick={() => applyTipPreset(preset.pct)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                        !customTipActive && tipAmount === presetAmount
                          ? "bg-primary/20 border-primary text-primary-hover"
                          : "bg-surface-hover border-border-hover text-text-muted hover:text-text-main"
                      }`}
                    >
                      {preset.label} (₹{presetAmount})
                    </button>
                  );
                })}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-text-muted">₹</span>
                  <input
                    type="number"
                    value={customTipActive ? tipAmount : ""}
                    placeholder="Custom"
                    onChange={(e) => {
                      setCustomTipActive(true);
                      setTipAmount(Math.max(0, Number(e.target.value)));
                    }}
                    onFocus={() => setCustomTipActive(true)}
                    min={0}
                    className="w-20 bg-background border border-border-hover rounded-lg px-2 py-1.5 text-xs font-mono text-text-main focus:border-primary focus:outline-none"
                  />
                </div>
                {effectiveTip > 0 && (
                  <span className="text-xs font-mono text-primary-hover ml-auto">
                    Total with tip: ₹{totalWithTip}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ Footer Actions ═══ */}
        <div className="bg-background px-6 py-4 border-t border-border flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={closeModal}
            disabled={isProcessingPayment}
            className="px-5 py-2.5 bg-surface-hover hover:bg-surface-hover text-text-main rounded-xl text-xs font-bold border border-border-hover disabled:opacity-50"
          >
            Cancel [Esc]
          </button>
          <button
            type="button"
            onClick={() => openModal("BILL_PREVIEW")}
            className="px-4 py-2.5 bg-surface-hover hover:bg-surface-hover text-primary-hover border border-primary/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
            title="Preview 80mm thermal receipt paper"
          >
            <span>🧾</span>
            <span>Bill Paper Preview</span>
          </button>
          <button
            onClick={handleSettle}
            disabled={!canSettle}
            className={`flex-1 font-black py-3 px-6 rounded-xl text-sm flex items-center justify-center gap-2 transition-all ${
              canSettle
                ? "bg-primary hover:bg-primary-hover text-text-inverse shadow-lg shadow-primary/30 active:scale-[0.98]"
                : "bg-surface-hover text-text-muted cursor-not-allowed border border-border-hover"
            }`}
          >
            {isProcessingPayment ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>PROCESSING...</span>
              </>
            ) : (
              <>
                <span>CONFIRM & PRINT BILL</span>
                <span className="text-xs bg-orange-700/80 px-2 py-0.5 rounded font-mono border border-primary">
                  Enter
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
