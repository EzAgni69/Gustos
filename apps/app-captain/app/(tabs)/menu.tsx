import React, { useEffect, useState, useMemo } from "react";
import { View, StyleSheet, FlatList, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore, buildCartKey } from "../../src/stores/cart.store";
import { MenuItemCard } from "../../src/components/MenuItemCard";
import { CartBar } from "../../src/components/CartBar";
import { ItemCustomizer } from "../../src/components/ItemCustomizer";
import { ItemInfoModal } from "../../src/components/ItemInfoModal";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import type { MenuItemResponse } from "../../src/services/api";

export default function MenuScreen() {
  const { categories, fetchMenu, menuLoading, selectedCategoryId, selectCategory, getFilteredItems } = useDataStore();
  const { items: cartItems, addItem, upsertItem, getItemCount, getSubtotal } = useCartStore();
  const router = useRouter();

  const [activeItem, setActiveItem] = useState<MenuItemResponse | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const [infoItem, setInfoItem] = useState<MenuItemResponse | null>(null);
  const [infoSheetVisible, setInfoSheetVisible] = useState(false);

  // Find existing cart item for the active item (to pre-fill the customizer)
  const activeCartItem = useMemo(() => {
    if (!activeItem) return undefined;
    // Find the first cart item matching this menu item
    return cartItems.find((i) => i.menuItemId === activeItem.id);
  }, [cartItems, activeItem]);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  const handleOpenSheet = (item: MenuItemResponse) => {
    setActiveItem(item);
    setSheetVisible(true);
  };

  const handleCloseSheet = () => {
    setSheetVisible(false);
  };

  const handleOpenInfo = (item: MenuItemResponse) => {
    setInfoItem(item);
    setInfoSheetVisible(true);
  };

  const handleCloseInfo = () => {
    setInfoSheetVisible(false);
  };

  const handleConfirmCustomization = (params: Parameters<typeof upsertItem>[0]) => {
    upsertItem(params);
    setSheetVisible(false);
  };

  // Calculate total quantity for a specific menu item across all variants
  const getItemTotalQty = (menuItemId: string): number => {
    return cartItems
      .filter((i) => i.menuItemId === menuItemId)
      .reduce((sum, i) => sum + i.quantity, 0);
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
          const qty = getItemTotalQty(item.id);
          return (
            <View style={styles.cardWrapper}>
              <MenuItemCard 
                item={item} 
                quantity={qty} 
                onAdd={addItem} 
                onPress={handleOpenSheet} 
                onInfoPress={handleOpenInfo} 
              />
            </View>
          );
        }}
      />

      {/* Cart Bar */}
      <CartBar itemCount={getItemCount()} total={getSubtotal()} onPress={() => router.push("/cart")} />

      {/* Item Customizer Bottom Sheet */}
      <ItemCustomizer
        item={activeItem}
        isVisible={sheetVisible}
        onClose={handleCloseSheet}
        onConfirm={handleConfirmCustomization}
        initialValues={
          activeCartItem
            ? {
                quantity: activeCartItem.quantity,
                variantName: activeCartItem.variantName,
                modifiers: activeCartItem.modifiers,
                addOns: activeCartItem.addOns,
                notes: activeCartItem.notes,
              }
            : undefined
        }
      />

      {/* Item Info Modal (from ⓘ button) */}
      <ItemInfoModal
        item={infoItem}
        isVisible={infoSheetVisible}
        onClose={handleCloseInfo}
        onAddPress={handleOpenSheet}
      />
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
});
