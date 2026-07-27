import React, { useEffect, useState, useMemo } from "react";
import { View, StyleSheet, FlatList, Text, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore } from "../../src/stores/cart.store";
import { MenuItemCard } from "../../src/components/MenuItemCard";
import { CartBar } from "../../src/components/CartBar";
import { BottomSheet } from "../../src/components/BottomSheet";
import { QuantityStepper } from "../../src/components/QuantityStepper";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import { COMMON_MODIFIERS } from "../../src/config/constants";
import type { MenuItemResponse } from "../../src/services/api";

export default function MenuScreen() {
  const { categories, fetchMenu, menuLoading, selectedCategoryId, selectCategory, getFilteredItems } = useDataStore();
  const { items: cartItems, addItem, updateQuantity, setItemModifiers, setItemNotes, getItemCount, getSubtotal } = useCartStore();
  const router = useRouter();

  const [activeItem, setActiveItem] = useState<MenuItemResponse | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  // Local state for bottom sheet
  const activeCartItem = useMemo(() => {
    return cartItems.find((i) => i.menuItemId === activeItem?.id);
  }, [cartItems, activeItem]);

  const [localQuantity, setLocalQuantity] = useState(0);
  const [localModifiers, setLocalModifiers] = useState<Set<string>>(new Set());
  const [localNotes, setLocalNotes] = useState("");

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  // Sync sheet state with cart
  useEffect(() => {
    if (activeItem) {
      if (activeCartItem) {
        setLocalQuantity(activeCartItem.quantity);
        setLocalModifiers(new Set(activeCartItem.modifiers));
        setLocalNotes(activeCartItem.notes);
      } else {
        setLocalQuantity(1);
        setLocalModifiers(new Set());
        setLocalNotes("");
      }
    }
  }, [activeItem, activeCartItem]);

  const handleOpenSheet = (item: MenuItemResponse) => {
    setActiveItem(item);
    setSheetVisible(true);
  };

  const handleCloseSheet = () => {
    if (activeItem && activeCartItem) {
      updateQuantity(activeItem.id, localQuantity);
      setItemModifiers(activeItem.id, Array.from(localModifiers));
      setItemNotes(activeItem.id, localNotes);
    } else if (activeItem && localQuantity > 0) {
      // Add new item if quantity is set
      addItem(activeItem);
      // Hack: we need to wait for store update before setting modifiers, 
      // but Zustand is sync so it's ok
      updateQuantity(activeItem.id, localQuantity);
      setItemModifiers(activeItem.id, Array.from(localModifiers));
      setItemNotes(activeItem.id, localNotes);
    }
    setSheetVisible(false);
  };

  const toggleModifier = (mod: string) => {
    const next = new Set(localModifiers);
    if (next.has(mod)) {
      next.delete(mod);
    } else {
      next.add(mod);
    }
    setLocalModifiers(next);
  };

  const filteredItems = getFilteredItems();

  return (
    <View style={styles.container}>
      {/* Categories Bar */}
      <View style={styles.categoriesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
          <Pressable
            style={[styles.categoryChip, selectedCategoryId === null && styles.categoryChipSelected]}
            onPress={() => selectCategory(null)}
          >
            <Text style={[styles.categoryText, selectedCategoryId === null && styles.categoryTextSelected]}>All</Text>
          </Pressable>
          {categories.map((cat) => (
            <Pressable
              key={cat.id}
              style={[styles.categoryChip, selectedCategoryId === cat.id && styles.categoryChipSelected]}
              onPress={() => selectCategory(cat.id)}
            >
              <Text style={[styles.categoryText, selectedCategoryId === cat.id && styles.categoryTextSelected]}>{cat.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Menu Items List */}
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const qty = cartItems.find((i) => i.menuItemId === item.id)?.quantity ?? 0;
          return (
            <View style={styles.cardWrapper}>
              <MenuItemCard item={item} quantity={qty} onAdd={addItem} onPress={handleOpenSheet} />
            </View>
          );
        }}
      />

      {/* Cart Bar */}
      <CartBar itemCount={getItemCount()} total={getSubtotal()} onPress={() => router.push("/cart")} />

      {/* Item Detail Bottom Sheet */}
      <BottomSheet isVisible={sheetVisible} onClose={handleCloseSheet} height={500}>
        {activeItem && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>{activeItem.name}</Text>
                  <Text style={styles.sheetPrice}>₹{activeItem.price.toFixed(0)}</Text>
                </View>
                <QuantityStepper quantity={localQuantity} onChange={setLocalQuantity} min={0} />
              </View>

              <Text style={styles.sectionTitle}>Modifiers</Text>
              <View style={styles.modifiersList}>
                {COMMON_MODIFIERS.map((mod) => {
                  const selected = localModifiers.has(mod);
                  return (
                    <Pressable
                      key={mod}
                      style={[styles.modifierChip, selected && styles.modifierChipSelected]}
                      onPress={() => toggleModifier(mod)}
                    >
                      <Text style={[styles.modifierText, selected && styles.modifierTextSelected]}>{mod}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.sectionTitle}>Special Instructions</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="e.g. Make it extra spicy..."
                placeholderTextColor={colors.textTertiary}
                value={localNotes}
                onChangeText={setLocalNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </ScrollView>
            
            <View style={styles.sheetFooter}>
               <Pressable style={styles.doneButton} onPress={handleCloseSheet}>
                 <Text style={styles.doneButtonText}>Done</Text>
               </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  categoriesWrapper: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bgCard },
  categoriesScroll: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
  categoryChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.borderLight },
  categoryChipSelected: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  categoryText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  categoryTextSelected: { color: colors.accent, fontWeight: fontWeight.bold },
  listContent: { padding: spacing.md, gap: spacing.md, paddingBottom: 100 },
  cardWrapper: {},
  sheetContent: { padding: spacing.xl },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.xl },
  sheetTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: 4 },
  sheetPrice: { fontSize: fontSize.lg, color: colors.textSecondary, fontWeight: fontWeight.medium },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary, marginBottom: spacing.md, marginTop: spacing.md },
  modifiersList: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  modifierChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.borderLight },
  modifierChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  modifierText: { color: colors.textSecondary, fontSize: fontSize.sm },
  modifierTextSelected: { color: "#fff", fontWeight: fontWeight.bold },
  notesInput: { backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.md, color: colors.textPrimary, minHeight: 80, fontSize: fontSize.md },
  sheetFooter: { padding: spacing.xl, paddingTop: 0 },
  doneButton: { backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  doneButtonText: { color: "#fff", fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
