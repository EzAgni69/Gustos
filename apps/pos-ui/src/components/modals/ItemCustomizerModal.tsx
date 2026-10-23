/**
 * Gusto POS UI — Item Customizer Modal
 *
 * Full-featured modal for customizing menu items before adding to cart.
 * Supports: Size variants (8"/12"), add-ons (toppings, cheese, extras),
 * modifiers (Jain, Less Spicy, etc.), notes, quantity,
 * AND combo/half-n-half pizza selection (Left Half, Right Half, Beverage).
 *
 * Mirrors the Captain App's ItemCustomizer but styled for desktop POS.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useMenuStore, type POSMenuItem } from "../../store/useMenuStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import type { CartItemAddOn } from "@gusto/core-logic";

// ─── Variant & Add-on Definitions ───

interface VariantOption {
  name: string;
  price: number; // delta from base price (0 = use base)
}

interface AddOnOption {
  name: string;
  unitPrice: number;
  maxQty: number;
}

// ─── Combo Type Detection ───

type ComboType = "HALF_N_HALF_REG" | "HALF_N_HALF_PREM" | "HALF_N_HALF_CROSS" | "COMBO_REG" | "COMBO_PREM" | "COMBO_PESTO" | null;

function getComboType(itemId: string): ComboType {
  switch (itemId) {
    case "item-combo-hnh-reg": return "HALF_N_HALF_REG";
    case "item-combo-hnh-prem": return "HALF_N_HALF_PREM";
    case "item-combo-hnh-cross": return "HALF_N_HALF_CROSS";
    case "item-combo-regular": return "COMBO_REG";
    case "item-combo-premium": return "COMBO_PREM";
    case "item-combo-pesto": return "COMBO_PESTO";
    default: return null;
  }
}

function isHalfNHalf(comboType: ComboType): boolean {
  return comboType === "HALF_N_HALF_REG" || comboType === "HALF_N_HALF_PREM" || comboType === "HALF_N_HALF_CROSS";
}

function isPizzaCombo(comboType: ComboType): boolean {
  return comboType === "COMBO_REG" || comboType === "COMBO_PREM" || comboType === "COMBO_PESTO";
}

// ─── Constants ───

const COMMON_MODIFIERS = [
  "Less spicy",
  "Extra spicy",
  "No onion",
  "No garlic",
  "Jain",
  "Swaminarayan",
  "Less oil",
  "No ice",
  "Extra crispy",
  "Light on sauce",
  "No chilli flakes",
] as const;

const BEVERAGE_OPTIONS = [
  "Sweet Lime Soda",
  "Virgin Mojito",
  "Lemonade",
  "Cold Coffee",
  "Masala Chaas",
  "Mango Lassi",
  "Iced Tea (Lemon)",
  "Iced Tea (Peach)",
  "Coke",
  "Sprite",
  "Fanta",
  "Thumbs Up",
];

function getAddOnsForCategory(categoryId: string): AddOnOption[] {
  const REGULAR_VEG_ADDONS: AddOnOption[] = [
    { name: "Capsicum", unitPrice: 50, maxQty: 2 },
    { name: "Green Olives", unitPrice: 50, maxQty: 2 },
    { name: "Black Olives", unitPrice: 50, maxQty: 2 },
    { name: "Mushroom", unitPrice: 50, maxQty: 2 },
    { name: "Onion", unitPrice: 50, maxQty: 2 },
    { name: "Jalapenos", unitPrice: 50, maxQty: 2 },
    { name: "Capers", unitPrice: 50, maxQty: 2 },
    { name: "Baby Corn", unitPrice: 50, maxQty: 2 },
    { name: "Sweet Corn", unitPrice: 50, maxQty: 2 },
    { name: "Spinach", unitPrice: 50, maxQty: 2 },
    { name: "Tomato", unitPrice: 50, maxQty: 2 },
    { name: "Sun-dried Tomato", unitPrice: 50, maxQty: 2 },
  ];

  const PREMIUM_VEG_ADDONS: AddOnOption[] = [
    { name: "Broccoli", unitPrice: 100, maxQty: 2 },
    { name: "Zucchini", unitPrice: 100, maxQty: 2 },
  ];

  const CHEESE_UPGRADES: AddOnOption[] = [
    { name: "Periphery Cheese Burst", unitPrice: 250, maxQty: 1 },
    { name: "Full Cheese Burst", unitPrice: 400, maxQty: 1 },
    { name: "Ricotta Cheese", unitPrice: 150, maxQty: 1 },
    { name: "Gorgonzola Cheese", unitPrice: 150, maxQty: 1 },
    { name: "Cream Cheese", unitPrice: 100, maxQty: 1 },
  ];

  const FLAT_RATE_ADDONS: AddOnOption[] = [
    { name: "Extra Mozzarella", unitPrice: 100, maxQty: 2 },
    { name: "Extra Parmesan", unitPrice: 150, maxQty: 2 },
    { name: "Burrata", unitPrice: 200, maxQty: 1 },
    { name: "Mozzarella di Bufala", unitPrice: 200, maxQty: 1 },
    { name: "Extra Marinara Sauce", unitPrice: 100, maxQty: 2 },
    { name: "Extra Pesto Sauce", unitPrice: 350, maxQty: 1 },
    { name: "Truffle Oil", unitPrice: 200, maxQty: 1 },
  ];

  switch (categoryId) {
    case "cat-pizza-reg":
    case "cat-pizza-prem":
    case "cat-combos":
      return [...REGULAR_VEG_ADDONS, ...PREMIUM_VEG_ADDONS, ...CHEESE_UPGRADES, ...FLAT_RATE_ADDONS];
    case "cat-starters":
    case "cat-sandwiches":
    case "cat-calzones":
    case "cat-pasta":
      return [...REGULAR_VEG_ADDONS, ...FLAT_RATE_ADDONS];
    default:
      return [];
  }
}

// ─── Component ───

export const ItemCustomizerModal: React.FC = () => {
  const { activeModal, customizerItemId, closeModal, showNotification } = useUIStore();
  const { items: menuItems } = useMenuStore();
  const { addItemWithCustomization } = useCartStore();

  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [selectedModifiers, setSelectedModifiers] = useState<Set<string>>(new Set());
  const [addOnQuantities, setAddOnQuantities] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState("");

  // Combo-specific state
  const [leftHalf, setLeftHalf] = useState("");
  const [rightHalf, setRightHalf] = useState("");
  const [selectedBeverage, setSelectedBeverage] = useState("");

  const item = useMemo(
    () => menuItems.find((m) => m.id === customizerItemId) ?? null,
    [menuItems, customizerItemId]
  );

  const comboType = useMemo(() => (item ? getComboType(item.id) : null), [item?.id]);

  // Build pizza lists for combo dropdowns
  const regularPizzas = useMemo(
    () => menuItems.filter((m) => m.categoryId === "cat-pizza-reg" && m.isAvailable),
    [menuItems]
  );
  const premiumPizzas = useMemo(
    () => menuItems.filter((m) => m.categoryId === "cat-pizza-prem" && m.isAvailable),
    [menuItems]
  );

  // Pizza choices available based on combo type
  const pizzaChoicesLeft = useMemo(() => {
    switch (comboType) {
      case "HALF_N_HALF_REG": return regularPizzas;
      case "HALF_N_HALF_PREM": return premiumPizzas;
      case "HALF_N_HALF_CROSS": return regularPizzas;
      case "COMBO_REG": return regularPizzas;
      case "COMBO_PREM": return premiumPizzas;
      default: return [];
    }
  }, [comboType, regularPizzas, premiumPizzas]);

  const pizzaChoicesRight = useMemo(() => {
    switch (comboType) {
      case "HALF_N_HALF_REG": return regularPizzas;
      case "HALF_N_HALF_PREM": return premiumPizzas;
      case "HALF_N_HALF_CROSS": return premiumPizzas;
      default: return [];
    }
  }, [comboType, regularPizzas, premiumPizzas]);

  // Parse variants from item's JSON field
  const variants: VariantOption[] = useMemo(() => {
    if (!item?.variants) return [];
    try {
      const parsed = JSON.parse(item.variants);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((v: any) => ({
          name: v.name,
          price: Number(v.price) - Number(item.price), // delta from base
        }));
      }
    } catch (e) {
      console.error("Failed to parse variants", e);
    }
    return [];
  }, [item]);

  const addOnOptions = useMemo(
    () => (item ? getAddOnsForCategory(item.categoryId) : []),
    [item?.categoryId]
  );

  // Reset state when item changes
  useEffect(() => {
    if (item && activeModal === "ITEM_CUSTOMIZER") {
      setQuantity(1);
      setSelectedVariant(variants.length > 0 ? variants[0]!.name : "");
      setSelectedModifiers(new Set());
      setAddOnQuantities(new Map());
      setNotes("");
      setLeftHalf("");
      setRightHalf("");
      setSelectedBeverage("");
    }
  }, [item?.id, activeModal]);

  // Pricing calculations
  const basePrice = item ? Number(item.price) : 0;

  const variantDef = useMemo(
    () => variants.find((v) => v.name === selectedVariant),
    [variants, selectedVariant]
  );

  const effectiveUnitPrice = useMemo(() => {
    if (!variantDef) return basePrice;
    return basePrice + variantDef.price;
  }, [basePrice, variantDef]);

  const addOnsTotal = useMemo(() => {
    let total = 0;
    for (const [name, qty] of addOnQuantities) {
      if (qty > 0) {
        const opt = addOnOptions.find((a) => a.name === name);
        if (opt) total += opt.unitPrice * qty;
      }
    }
    return total;
  }, [addOnQuantities, addOnOptions]);

  const lineTotal = useMemo(
    () => (effectiveUnitPrice + addOnsTotal) * quantity,
    [effectiveUnitPrice, addOnsTotal, quantity]
  );

  // Handlers
  const toggleModifier = useCallback((mod: string) => {
    setSelectedModifiers((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  }, []);

  const updateAddOnQty = useCallback((name: string, qty: number) => {
    setAddOnQuantities((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(name);
      else next.set(name, qty);
      return next;
    });
  }, []);

  // Build combo description for cart display
  const comboDescription = useMemo(() => {
    const parts: string[] = [];
    if (isHalfNHalf(comboType)) {
      if (leftHalf) parts.push(`L: ${leftHalf}`);
      if (rightHalf) parts.push(`R: ${rightHalf}`);
    }
    if (isPizzaCombo(comboType)) {
      if (leftHalf) parts.push(`Pizza: ${leftHalf}`);
      if (selectedBeverage) parts.push(`Drink: ${selectedBeverage}`);
    }
    return parts.join(" | ");
  }, [comboType, leftHalf, rightHalf, selectedBeverage]);

  // Validation for combos
  const comboValid = useMemo(() => {
    if (!comboType) return true; // Not a combo, always valid
    if (isHalfNHalf(comboType)) return leftHalf !== "" && rightHalf !== "";
    if (isPizzaCombo(comboType)) {
      if (comboType === "COMBO_PESTO") return selectedBeverage !== ""; // Pesto is fixed pizza
      return leftHalf !== "" && selectedBeverage !== "";
    }
    return true;
  }, [comboType, leftHalf, rightHalf, selectedBeverage]);

  const handleConfirm = () => {
    if (!item || quantity <= 0) {
      closeModal();
      return;
    }

    if (comboType && !comboValid) {
      showNotification("⚠️ Please complete all combo selections before adding.");
      return;
    }

    const addOns: CartItemAddOn[] = [];
    for (const [name, qty] of addOnQuantities) {
      if (qty > 0) {
        const opt = addOnOptions.find((a) => a.name === name);
        if (opt) {
          addOns.push({ name, quantity: qty, unitPrice: opt.unitPrice });
        }
      }
    }

    // Build modifiers with combo selections baked in
    const allModifiers = Array.from(selectedModifiers);
    if (comboDescription) {
      allModifiers.unshift(comboDescription);
    }

    addItemWithCustomization({
      menuItem: item,
      variantName: selectedVariant || undefined,
      variantPrice: selectedVariant ? effectiveUnitPrice : undefined,
      quantity,
      modifiers: allModifiers,
      addOns,
      notes,
    });

    const sizeSuffix = selectedVariant ? ` (${selectedVariant})` : "";
    showNotification(`🍕 Added ${quantity}× ${item.name}${sizeSuffix} — ₹${lineTotal}`);
    closeModal();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    }
    if (e.key === "Escape") {
      closeModal();
    }
  };

  if (activeModal !== "ITEM_CUSTOMIZER" || !item) return null;

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm select-none outline-none"
    >
      <div className="bg-surface border border-border-hover rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-background px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-5 h-5 border-2 flex items-center justify-center rounded-[4px] ${
                item.isVeg ? "border-emerald-500" : "border-rose-500"
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  item.isVeg ? "bg-emerald-500" : "bg-rose-500"
                }`}
              />
            </div>
            <div>
              <h2 className="text-base font-black text-text-main flex items-center gap-2">
                {item.name}
                {comboType && (
                  <span className="text-[10px] bg-highlight/20 text-highlight px-1.5 py-0.5 rounded-md border border-highlight/40 font-mono">
                    {isHalfNHalf(comboType) ? "½ + ½" : "COMBO"}
                  </span>
                )}
              </h2>
              {item.description && (
                <p className="text-[11px] text-text-muted mt-0.5 max-w-md truncate">
                  {item.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-black text-primary font-mono">₹{effectiveUnitPrice}</span>
            <button
              onClick={closeModal}
              className="w-8 h-8 rounded-lg bg-surface-hover hover:bg-border text-text-muted hover:text-text-main flex items-center justify-center font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Size / Variant Selection */}
          {variants.length > 0 && (
            <div>
              <div className="text-xs font-bold text-text-main mb-2 font-mono">Size / Variant:</div>
              <div className="flex gap-2">
                {variants.map((v) => {
                  const isSelected = selectedVariant === v.name;
                  const price = basePrice + v.price;
                  return (
                    <button
                      key={v.name}
                      onClick={() => setSelectedVariant(v.name)}
                      className={`flex-1 py-3 px-4 rounded-xl border-2 text-center transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary shadow-md shadow-primary/20"
                          : "border-border-hover bg-surface text-text-main hover:bg-surface-hover"
                      }`}
                    >
                      <div className={`text-sm font-bold ${isSelected ? "text-primary" : ""}`}>
                        {v.name}
                      </div>
                      <div className={`text-base font-black font-mono mt-0.5 ${isSelected ? "text-primary-hover" : "text-text-main"}`}>
                        ₹{price}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Half N Half Pizza Selection ─── */}
          {isHalfNHalf(comboType) && (
            <div className="bg-highlight/5 border border-highlight/30 rounded-xl p-4 space-y-3">
              <div className="text-xs font-black text-highlight font-mono flex items-center gap-2">
                🍕 Select Your Two Pizza Halves:
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Left Half */}
                <div>
                  <label className="block text-[11px] font-bold text-text-main mb-1">Left Half:</label>
                  <select
                    value={leftHalf}
                    onChange={(e) => setLeftHalf(e.target.value)}
                    className="w-full bg-background border border-border-hover focus:border-highlight rounded-lg p-2.5 text-xs text-text-main focus:outline-none"
                  >
                    <option value="">— Select pizza —</option>
                    {pizzaChoicesLeft.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Right Half */}
                <div>
                  <label className="block text-[11px] font-bold text-text-main mb-1">Right Half:</label>
                  <select
                    value={rightHalf}
                    onChange={(e) => setRightHalf(e.target.value)}
                    className="w-full bg-background border border-border-hover focus:border-highlight rounded-lg p-2.5 text-xs text-text-main focus:outline-none"
                  >
                    <option value="">— Select pizza —</option>
                    {pizzaChoicesRight.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {leftHalf && rightHalf && (
                <div className="text-[10px] text-highlight font-mono bg-highlight/10 rounded-lg px-3 py-1.5 text-center">
                  ½ {leftHalf} + ½ {rightHalf}
                </div>
              )}
            </div>
          )}

          {/* ─── Pizza Combo Selection ─── */}
          {isPizzaCombo(comboType) && (
            <div className="bg-secondary/5 border border-secondary/30 rounded-xl p-4 space-y-3">
              <div className="text-xs font-black text-secondary font-mono flex items-center gap-2">
                🎉 Customize Your Combo:
              </div>
              {/* Pizza selection (not for Pesto — it's fixed) */}
              {comboType !== "COMBO_PESTO" && (
                <div>
                  <label className="block text-[11px] font-bold text-text-main mb-1">
                    Choose Your Pizza:
                  </label>
                  <select
                    value={leftHalf}
                    onChange={(e) => setLeftHalf(e.target.value)}
                    className="w-full bg-background border border-border-hover focus:border-secondary rounded-lg p-2.5 text-xs text-text-main focus:outline-none"
                  >
                    <option value="">— Select pizza —</option>
                    {pizzaChoicesLeft.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {comboType === "COMBO_PESTO" && (
                <div className="text-[11px] text-text-muted bg-background rounded-lg px-3 py-2 border border-border-hover">
                  🌿 <strong>Pizza:</strong> Pesto Pizza (fixed) &nbsp;|&nbsp; <strong>Tasca:</strong> Pesto Cheese Garlic Tasca (fixed)
                </div>
              )}
              {/* Beverage selection */}
              <div>
                <label className="block text-[11px] font-bold text-text-main mb-1">
                  Choose Your Beverage:
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {BEVERAGE_OPTIONS.map((bev) => {
                    const isSelected = selectedBeverage === bev;
                    return (
                      <button
                        key={bev}
                        onClick={() => setSelectedBeverage(isSelected ? "" : bev)}
                        className={`px-2 py-2 rounded-lg text-[11px] font-semibold border text-center transition-all ${
                          isSelected
                            ? "bg-secondary text-text-inverse border-secondary shadow-sm"
                            : "bg-background text-text-main border-border-hover hover:bg-surface-hover"
                        }`}
                      >
                        {isSelected ? "✓ " : ""}
                        {bev}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Summary */}
              {(leftHalf || comboType === "COMBO_PESTO") && selectedBeverage && (
                <div className="text-[10px] text-secondary font-mono bg-secondary/10 rounded-lg px-3 py-1.5 text-center">
                  {comboType === "COMBO_PESTO" ? "Pesto Pizza" : leftHalf} + Cheese Garlic Tasca + {selectedBeverage}
                </div>
              )}
            </div>
          )}

          {/* Add-ons */}
          {addOnOptions.length > 0 && (
            <div>
              <div className="text-xs font-bold text-text-main mb-2 font-mono">
                Add-ons ({addOnsTotal > 0 ? `+₹${addOnsTotal}` : "Optional"}):
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
                {addOnOptions.map((ao) => {
                  const qty = addOnQuantities.get(ao.name) ?? 0;
                  return (
                    <div
                      key={ao.name}
                      className={`flex items-center justify-between bg-background border rounded-lg px-3 py-2 ${
                        qty > 0
                          ? "border-primary bg-primary/5"
                          : "border-border-hover"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-text-main truncate">
                          {ao.name}
                        </div>
                        <div className="text-[10px] text-text-muted font-mono">+₹{ao.unitPrice}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {qty > 0 && (
                          <button
                            onClick={() => updateAddOnQty(ao.name, qty - 1)}
                            className="w-6 h-6 bg-surface-hover hover:bg-border text-text-main rounded flex items-center justify-center text-xs font-bold"
                          >
                            −
                          </button>
                        )}
                        {qty > 0 && (
                          <span className="w-5 text-center text-xs font-bold text-primary font-mono">
                            {qty}
                          </span>
                        )}
                        {qty < ao.maxQty && (
                          <button
                            onClick={() => updateAddOnQty(ao.name, qty + 1)}
                            className="w-6 h-6 bg-primary/20 hover:bg-primary/30 text-primary-hover rounded flex items-center justify-center text-xs font-bold"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modifiers */}
          <div>
            <div className="text-xs font-bold text-text-main mb-2 font-mono">
              Kitchen Modifiers:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_MODIFIERS.map((mod) => {
                const isSelected = selectedModifiers.has(mod);
                return (
                  <button
                    key={mod}
                    onClick={() => toggleModifier(mod)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      isSelected
                        ? "bg-primary text-text-inverse border-primary shadow-sm shadow-primary/30"
                        : "bg-background text-text-main border-border-hover hover:bg-surface-hover"
                    }`}
                  >
                    {isSelected ? "✓ " : "+ "}
                    {mod}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Special Instructions */}
          <div>
            <label className="block text-xs font-bold text-text-main mb-1.5 font-mono">
              Special Instructions:
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cut into 4 slices, No onions..."
              rows={2}
              className="w-full bg-background border border-border-hover focus:border-primary rounded-xl p-3 text-xs text-text-main placeholder-gray-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="bg-background px-6 py-4 border-t border-border flex items-center justify-between gap-4 shrink-0">
          {/* Quantity Stepper */}
          <div className="flex items-center bg-surface border border-border rounded-xl p-1 gap-1">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-8 h-8 bg-surface-hover hover:bg-border text-text-main rounded-lg flex items-center justify-center font-bold text-sm"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-black text-primary font-mono">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-8 h-8 bg-surface-hover hover:bg-border text-text-main rounded-lg flex items-center justify-center font-bold text-sm"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-3 flex-1 justify-end">
            <button
              onClick={closeModal}
              className="px-5 py-2.5 bg-surface-hover hover:bg-border text-text-main rounded-xl text-xs font-bold border border-border-hover"
            >
              Cancel [Esc]
            </button>
            <button
              onClick={handleConfirm}
              disabled={comboType !== null && !comboValid}
              className={`flex-1 max-w-xs font-black py-3 rounded-xl text-sm shadow-lg flex items-center justify-center gap-2 transition-all ${
                comboType && !comboValid
                  ? "bg-gray-600 text-gray-400 cursor-not-allowed shadow-none"
                  : "bg-primary hover:bg-primary-hover text-text-inverse shadow-primary/30"
              }`}
            >
              <span>ADD TO CART</span>
              <span className="text-xs bg-red-800/60 px-2 py-0.5 rounded font-mono border border-primary">
                ₹{lineTotal}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
