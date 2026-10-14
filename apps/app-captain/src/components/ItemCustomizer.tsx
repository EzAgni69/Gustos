/**
 * Gusto Captain — ItemCustomizer Component
 *
 * Full-featured bottom sheet for customizing a menu item before adding to cart.
 * Supports: Variants (size), Add-ons (extras), Half N Half pizza split,
 * Combo beverage picker, Modifiers (tags), Notes, and Quantity.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { BottomSheet } from "./BottomSheet";
import { QuantityStepper } from "./QuantityStepper";
import { colors, spacing, fontSize, fontWeight, radius } from "../config/theme";
import { COMMON_MODIFIERS } from "../config/constants";
import { useDataStore } from "../stores/data.store";
import type { MenuItemResponse } from "../services/api";
import type { CartItemAddOn } from "../stores/cart.store";

// ─── Variant & Add-on Definitions ───

export interface VariantOption {
  name: string;
  /** Price delta or override */
  price: number;
}

export interface AddOnOption {
  name: string;
  unitPrice: number;
  /** Max quantity selectable */
  maxQty: number;
}

export const BEVERAGE_OPTIONS = [
  "Coke",
  "Sprite",
  "Thumbs Up",
  "Fanta",
  "Diet Coke",
  "Sweet Lime Soda",
  "Virgin Mojito",
  "Lemonade",
  "Cold Coffee",
  "Mineral Water",
];

const PRESET_PIZZAS = [
  "Margherita",
  "Four Cheese",
  "Truffle Funghi",
  "Farmhouse",
  "Paneer Tikka",
  "Pesto Genovese",
  "Diavola (Spicy)",
  "Capricciosa",
];

/** Returns variant options for a given item category. Empty = no variants. */
function getVariantsForCategory(categoryId: string): VariantOption[] {
  switch (categoryId) {
    case "cat-pizza-reg":
    case "cat-pizza-prem":
    case "cat-starters":
    case "cat-combos":
      return [
        { name: '8"', price: 0 },
        { name: '12"', price: 0 },
      ];
    default:
      return [];
  }
}

/** Returns add-on options for a given item category. */
function getAddOnsForCategory(categoryId: string): AddOnOption[] {
  const REGULAR_VEG_ADDONS: AddOnOption[] = [
    { name: "Capsicum", unitPrice: 50, maxQty: 2 },
    { name: "Green Olives", unitPrice: 50, maxQty: 2 },
    { name: "Black Olives", unitPrice: 50, maxQty: 2 },
    { name: "Mushroom", unitPrice: 50, maxQty: 2 },
    { name: "Onion", unitPrice: 50, maxQty: 2 },
    { name: "Jalapenos", unitPrice: 50, maxQty: 2 },
    { name: "Baby Corn", unitPrice: 50, maxQty: 2 },
    { name: "Sweet Corn", unitPrice: 50, maxQty: 2 },
    { name: "Tomato", unitPrice: 50, maxQty: 2 },
    { name: "Sun-dried Tomato", unitPrice: 50, maxQty: 2 },
  ];

  const CHEESE_UPGRADES: AddOnOption[] = [
    { name: "Periphery Cheese Burst", unitPrice: 250, maxQty: 1 },
    { name: "Full Cheese Burst", unitPrice: 400, maxQty: 1 },
    { name: "Ricotta Cheese", unitPrice: 150, maxQty: 1 },
    { name: "Burrata", unitPrice: 200, maxQty: 1 },
    { name: "Extra Mozzarella", unitPrice: 100, maxQty: 2 },
    { name: "Extra Parmesan", unitPrice: 150, maxQty: 2 },
    { name: "Truffle Oil", unitPrice: 200, maxQty: 1 },
  ];

  switch (categoryId) {
    case "cat-pizza-reg":
    case "cat-pizza-prem":
    case "cat-combos":
      return [...REGULAR_VEG_ADDONS, ...CHEESE_UPGRADES];
    case "cat-starters":
    case "cat-sandwiches":
    case "cat-calzones":
    case "cat-pasta":
      return REGULAR_VEG_ADDONS;
    default:
      return [];
  }
}

// ─── Component Props ───

interface ItemCustomizerProps {
  item: MenuItemResponse | null;
  isVisible: boolean;
  onClose: () => void;
  /** Called when user confirms customization */
  onConfirm: (params: {
    menuItem: MenuItemResponse;
    variantName?: string;
    variantPrice?: number;
    quantity: number;
    modifiers: string[];
    addOns: CartItemAddOn[];
    notes: string;
  }) => void;
  /** Initial values if editing an existing cart item */
  initialValues?: {
    quantity: number;
    variantName: string;
    modifiers: string[];
    addOns: CartItemAddOn[];
    notes: string;
  };
}

export function ItemCustomizer({
  item,
  isVisible,
  onClose,
  onConfirm,
  initialValues,
}: ItemCustomizerProps) {
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [selectedModifiers, setSelectedModifiers] = useState<Set<string>>(new Set());
  const [addOnQuantities, setAddOnQuantities] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState("");

  // Half N Half and Combo States
  const [enableHalfNHalf, setEnableHalfNHalf] = useState(false);
  const [leftHalf, setLeftHalf] = useState("");
  const [rightHalf, setRightHalf] = useState("");
  const [selectedBeverage, setSelectedBeverage] = useState("");

  const allMenuItems = useDataStore((s) => s.menuItems);

  // Available pizzas for Half N Half selection
  const availablePizzaNames = useMemo(() => {
    const list = allMenuItems
      .filter(
        (m) =>
          (m.categoryId === "cat-pizza-reg" || m.categoryId === "cat-pizza-prem") &&
          !m.name.toLowerCase().includes("half")
      )
      .map((m) => m.name);
    return list.length > 0 ? list : PRESET_PIZZAS;
  }, [allMenuItems]);

  const isPizza = useMemo(() => {
    if (!item) return false;
    return (
      item.categoryId === "cat-pizza-reg" ||
      item.categoryId === "cat-pizza-prem" ||
      item.name.toLowerCase().includes("pizza") ||
      item.name.toLowerCase().includes("half")
    );
  }, [item]);

  const isCombo = useMemo(() => {
    if (!item) return false;
    return (
      item.categoryId === "cat-combos" ||
      item.name.toLowerCase().includes("combo")
    );
  }, [item]);

  // Get definitions for this item
  const variants = useMemo(() => {
    if (!item) return [];
    if (item.variants) {
      try {
        const parsed = JSON.parse(item.variants);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((v: any) => ({
            name: v.name,
            price: Number(v.price) - Number(item.price),
          }));
        }
      } catch (e) {
        console.error("Failed to parse variants", e);
      }
    }
    return getVariantsForCategory(item.categoryId);
  }, [item]);

  const addOnOptions = useMemo(
    () => (item ? getAddOnsForCategory(item.categoryId) : []),
    [item?.categoryId]
  );

  // Reset state when item changes
  useEffect(() => {
    if (item && isVisible) {
      if (initialValues) {
        setQuantity(initialValues.quantity);
        setSelectedVariant(initialValues.variantName);
        setSelectedModifiers(new Set(initialValues.modifiers));
        const aqMap = new Map<string, number>();
        for (const ao of initialValues.addOns) {
          aqMap.set(ao.name, ao.quantity);
        }
        setAddOnQuantities(aqMap);
        setNotes(initialValues.notes);

        // Check if existing modifiers contain Half N Half or Beverage
        const hnhMod = initialValues.modifiers.find((m) => m.startsWith("L:") && m.includes("R:"));
        if (hnhMod) {
          setEnableHalfNHalf(true);
          const parts = hnhMod.split("|").map((p) => p.trim());
          if (parts[0]) setLeftHalf(parts[0].replace("L:", "").trim());
          if (parts[1]) setRightHalf(parts[1].replace("R:", "").trim());
        } else {
          setEnableHalfNHalf(item.name.toLowerCase().includes("half"));
          setLeftHalf(availablePizzaNames[0] || "Margherita");
          setRightHalf(availablePizzaNames[1] || "Four Cheese");
        }

        const drinkMod = initialValues.modifiers.find((m) => m.startsWith("Drink:"));
        if (drinkMod) {
          setSelectedBeverage(drinkMod.replace("Drink:", "").trim());
        } else {
          setSelectedBeverage(isCombo ? BEVERAGE_OPTIONS[0]! : "");
        }
      } else {
        setQuantity(1);
        setSelectedVariant(variants.length > 0 ? variants[0]!.name : "");
        setSelectedModifiers(new Set());
        setAddOnQuantities(new Map());
        setNotes("");

        const isHnhByDefault = item.name.toLowerCase().includes("half");
        setEnableHalfNHalf(isHnhByDefault);
        setLeftHalf(availablePizzaNames[0] || "Margherita");
        setRightHalf(availablePizzaNames[1] || "Four Cheese");
        setSelectedBeverage(isCombo ? BEVERAGE_OPTIONS[0]! : "");
      }
    }
  }, [item?.id, isVisible, availablePizzaNames, isCombo]);

  // Calculate prices
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

  const handleConfirm = () => {
    if (!item || quantity <= 0) {
      onClose();
      return;
    }

    // Build add-ons array
    const addOns: CartItemAddOn[] = [];
    for (const [name, qty] of addOnQuantities) {
      if (qty > 0) {
        const opt = addOnOptions.find((a) => a.name === name);
        if (opt) {
          addOns.push({ name, quantity: qty, unitPrice: opt.unitPrice });
        }
      }
    }

    // Compose final modifiers
    const finalModifiers: string[] = [];
    if (enableHalfNHalf && leftHalf && rightHalf) {
      finalModifiers.push(`L: ${leftHalf} | R: ${rightHalf}`);
    }
    if (isCombo && selectedBeverage) {
      finalModifiers.push(`Drink: ${selectedBeverage}`);
    }
    for (const mod of selectedModifiers) {
      finalModifiers.push(mod);
    }

    onConfirm({
      menuItem: item,
      variantName: selectedVariant || undefined,
      variantPrice: selectedVariant ? effectiveUnitPrice : undefined,
      quantity,
      modifiers: finalModifiers,
      addOns,
      notes,
    });
  };

  if (!item) return null;

  return (
    <BottomSheet isVisible={isVisible} onClose={handleConfirm} height="88%">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.vegIndicator, { borderColor: item.isVeg ? colors.veg : colors.nonVeg }]}>
                <View style={[styles.vegDot, { backgroundColor: item.isVeg ? colors.veg : colors.nonVeg }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemPrice}>₹{effectiveUnitPrice.toFixed(0)}</Text>
              </View>
            </View>
            <QuantityStepper quantity={quantity} onChange={setQuantity} min={0} />
          </View>

          {/* Variants (Size) */}
          {variants.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Size / Variant</Text>
              <Text style={styles.sectionSubtitle}>Choose pizza size</Text>
              <View style={styles.variantGrid}>
                {variants.map((v) => {
                  const isSelected = selectedVariant === v.name;
                  const price = basePrice + v.price;
                  return (
                    <Pressable
                      key={v.name}
                      style={[styles.variantChip, isSelected && styles.variantChipSelected]}
                      onPress={() => setSelectedVariant(v.name)}
                    >
                      <Text style={[styles.variantName, isSelected && styles.variantNameSelected]}>
                        {v.name === '8"' ? '8" Regular' : v.name === '12"' ? '12" Large' : v.name}
                      </Text>
                      <Text style={[styles.variantPrice, isSelected && styles.variantPriceSelected]}>
                        ₹{price.toFixed(0)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Half N Half Pizza Split */}
          {isPizza && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>🍕 Half & Half Flavors</Text>
                  <Text style={styles.sectionSubtitle}>Split pizza into 2 distinct halves</Text>
                </View>
                <Pressable
                  style={[styles.toggleBtn, enableHalfNHalf && styles.toggleBtnActive]}
                  onPress={() => setEnableHalfNHalf(!enableHalfNHalf)}
                >
                  <Text style={[styles.toggleBtnText, enableHalfNHalf && styles.toggleBtnTextActive]}>
                    {enableHalfNHalf ? "Active" : "Enable"}
                  </Text>
                </Pressable>
              </View>

              {enableHalfNHalf && (
                <View style={styles.halfSelectorContainer}>
                  {/* Left Half */}
                  <Text style={styles.halfLabel}>Left Half Pizza:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                    {availablePizzaNames.map((pName) => {
                      const isSel = leftHalf === pName;
                      return (
                        <Pressable
                          key={`L-${pName}`}
                          style={[styles.smallChip, isSel && styles.smallChipSelected]}
                          onPress={() => setLeftHalf(pName)}
                        >
                          <Text style={[styles.smallChipText, isSel && styles.smallChipTextSelected]}>
                            {pName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {/* Right Half */}
                  <Text style={[styles.halfLabel, { marginTop: spacing.md }]}>Right Half Pizza:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                    {availablePizzaNames.map((pName) => {
                      const isSel = rightHalf === pName;
                      return (
                        <Pressable
                          key={`R-${pName}`}
                          style={[styles.smallChip, isSel && styles.smallChipSelected]}
                          onPress={() => setRightHalf(pName)}
                        >
                          <Text style={[styles.smallChipText, isSel && styles.smallChipTextSelected]}>
                            {pName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.halfSummaryBox}>
                    <Text style={styles.halfSummaryText}>
                      Selected: 🌓 {leftHalf || "None"} + {rightHalf || "None"}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Combo Beverage Selection */}
          {isCombo && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🥤 Combo Beverage</Text>
              <Text style={styles.sectionSubtitle}>Included beverage with this combo</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {BEVERAGE_OPTIONS.map((bev) => {
                  const isSel = selectedBeverage === bev;
                  return (
                    <Pressable
                      key={bev}
                      style={[styles.beverageChip, isSel && styles.beverageChipSelected]}
                      onPress={() => setSelectedBeverage(bev)}
                    >
                      <Text style={[styles.beverageChipText, isSel && styles.beverageChipTextSelected]}>
                        {bev}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Add-ons */}
          {addOnOptions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Extras & Add-ons</Text>
              <Text style={styles.sectionSubtitle}>Toppings, cheese bursts & oils</Text>
              <View style={styles.addOnsList}>
                {addOnOptions.map((ao) => {
                  const qty = addOnQuantities.get(ao.name) ?? 0;
                  return (
                    <View key={ao.name} style={styles.addOnRow}>
                      <View style={styles.addOnInfo}>
                        <Text style={styles.addOnName}>{ao.name}</Text>
                        <Text style={styles.addOnPrice}>+₹{ao.unitPrice}</Text>
                      </View>
                      <QuantityStepper
                        quantity={qty}
                        onChange={(q) => updateAddOnQty(ao.name, q)}
                        min={0}
                        max={ao.maxQty}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Modifiers */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Kitchen Prep Instructions</Text>
            <Text style={styles.sectionSubtitle}>Tags highlighted on Kitchen Display (KDS)</Text>
            <View style={styles.modifierGrid}>
              {COMMON_MODIFIERS.map((mod) => {
                const isSelected = selectedModifiers.has(mod);
                return (
                  <Pressable
                    key={mod}
                    style={[styles.modifierChip, isSelected && styles.modifierChipSelected]}
                    onPress={() => toggleModifier(mod)}
                  >
                    <Text style={[styles.modifierText, isSelected && styles.modifierTextSelected]}>
                      {mod}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Custom Chef Note</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="e.g. Cut in 8 slices, extra crispy base..."
              placeholderTextColor={colors.textTertiary}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerTotal}>
            <Text style={styles.footerTotalLabel}>Item Total</Text>
            <Text style={styles.footerTotalValue}>₹{lineTotal.toFixed(0)}</Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.confirmButton,
              pressed && styles.confirmButtonPressed,
              quantity === 0 && styles.removeButton,
            ]}
            onPress={handleConfirm}
          >
            <Text style={styles.confirmButtonText}>
              {quantity === 0
                ? "Remove from Cart"
                : initialValues
                  ? `Update Item (₹${lineTotal.toFixed(0)})`
                  : `Add to Cart (₹${lineTotal.toFixed(0)})`}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

// ─── Styles ───

const styles = StyleSheet.create({
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.lg,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    flex: 1,
  },
  vegIndicator: {
    width: 14,
    height: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    backgroundColor: "#fff",
  },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  itemName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },

  // Sections
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },

  // Variants
  variantGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  variantChip: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: 2,
  },
  variantChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  variantName: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  variantNameSelected: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  variantPrice: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
    fontWeight: fontWeight.bold,
  },
  variantPriceSelected: {
    color: colors.accent,
  },

  // Half N Half
  toggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.bgInput,
  },
  toggleBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  toggleBtnText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.bold,
  },
  toggleBtnTextActive: {
    color: colors.accent,
  },
  halfSelectorContainer: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  halfLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  smallChip: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  smallChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  smallChipText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  smallChipTextSelected: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  halfSummaryBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.bgInput,
    borderRadius: radius.sm,
  },
  halfSummaryText: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },

  // Beverage
  beverageChip: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  beverageChipSelected: {
    borderColor: colors.info,
    backgroundColor: colors.infoBg,
  },
  beverageChipText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  beverageChipTextSelected: {
    color: colors.info,
    fontWeight: fontWeight.bold,
  },

  // Add-ons
  addOnsList: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  addOnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  addOnInfo: {
    flex: 1,
  },
  addOnName: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
  },
  addOnPrice: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
    marginTop: 1,
  },

  // Modifiers
  modifierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  modifierChip: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  modifierChipSelected: {
    borderColor: colors.warning,
    backgroundColor: colors.warningBg,
  },
  modifierText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  modifierTextSelected: {
    color: colors.warning,
    fontWeight: fontWeight.bold,
  },

  // Notes
  notesInput: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    minHeight: 70,
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.bgCard,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  footerTotal: {
    flex: 1,
  },
  footerTotalLabel: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
  },
  footerTotalValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  confirmButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonPressed: {
    opacity: 0.8,
  },
  removeButton: {
    backgroundColor: colors.danger,
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
});
