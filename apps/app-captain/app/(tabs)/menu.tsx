import React, { useEffect, useState, useMemo } from "react";
import { View, StyleSheet, FlatList, Text, Pressable, ScrollView, TextInput, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useDataStore } from "../../src/stores/data.store";
import { useCartStore, buildCartKey } from "../../src/stores/cart.store";
import { MenuItemCard } from "../../src/components/MenuItemCard";
import { CartBar } from "../../src/components/CartBar";
import { ItemCustomizer } from "../../src/components/ItemCustomizer";
import { ItemInfoModal } from "../../src/components/ItemInfoModal";
import { colors, spacing, fontSize, fontWeight, radius } from "../../src/config/theme";
import type { MenuItemResponse } from "../../src/services/api";
import { searchMenu, applyFilters, matchesFilter, DIETARY_FILTERS, type DietaryFilter } from "../../src/lib/menuSearch";

const SEARCH_DEBOUNCE_MS = 150;

export default function MenuScreen() {
  const { categories, menuItems, fetchMenu, menuLoading, selectedCategoryId, selectCategory, getFilteredItems } = useDataStore();
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

  // ─── Search + dietary filters ───
  const [searchText, setSearchText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<DietaryFilter>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText]);

  const isSearching = debouncedQuery.length > 0;
  const categoryItems = getFilteredItems();

  // Searching looks across the whole menu, ignoring the selected category
  const baseItems = useMemo(
    () => (isSearching ? searchMenu(menuItems, debouncedQuery) : categoryItems),
    [isSearching, menuItems, debouncedQuery, categoryItems]
  );

  const filteredItems = useMemo(() => applyFilters(baseItems, activeFilters), [baseItems, activeFilters]);

  // How many items each chip would leave (given the other active chips)
  const filterCounts = useMemo(() => {
    const counts = {} as Record<DietaryFilter, number>;
    for (const { id } of DIETARY_FILTERS) {
      const others = new Set([...activeFilters].filter((f) => f !== id));
      counts[id] = applyFilters(baseItems, others).filter((item) => matchesFilter(item, id)).length;
    }
    return counts;
  }, [baseItems, activeFilters]);

  const toggleFilter = (id: DietaryFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        // Veg and Non-Veg are mutually exclusive
        if (id === "VEG") next.delete("NON_VEG");
        if (id === "NON_VEG") next.delete("VEG");
      }
      return next;
    });
  };

  const clearSearch = () => {
    setSearchText("");
    setDebouncedQuery("");
  };

  const hasRefinement = isSearching || activeFilters.size > 0;

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search name or code (e.g. margh, 101)"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="never"
            accessibilityLabel="Search menu by name or short code"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {searchText.length > 0 && (
            <Pressable onPress={clearSearch} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>

        {/* Dietary quick filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersScroll}
          keyboardShouldPersistTaps="handled"
        >
          {DIETARY_FILTERS.map(({ id, label, icon }) => {
            const active = activeFilters.has(id);
            const count = filterCounts[id];
            const disabled = !active && count === 0;
            return (
              <Pressable
                key={id}
                onPress={() => toggleFilter(id)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                accessibilityLabel={`${label}, ${count} items`}
                style={[styles.filterChip, active && styles.filterChipActive, disabled && styles.filterChipDisabled]}
              >
                <Text style={styles.filterIcon}>{icon}</Text>
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
                <Text style={[styles.filterCount, active && styles.filterTextActive]}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Categories Bar (hidden while searching — search covers the whole menu) */}
      {isSearching ? (
        <View style={styles.searchScopeBar}>
          <Text style={styles.searchScopeText}>
            {filteredItems.length} result{filteredItems.length === 1 ? "" : "s"} for “{debouncedQuery}” across all categories
          </Text>
        </View>
      ) : (
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
      )}

      {/* Menu Items List */}
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          menuLoading ? null : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{hasRefinement ? "No matching items" : "No items in this category"}</Text>
              {hasRefinement && (
                <Pressable
                  onPress={() => {
                    clearSearch();
                    setActiveFilters(new Set());
                  }}
                  style={styles.emptyButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyButtonText}>Clear search & filters</Text>
                </Pressable>
              )}
            </View>
          )
        }
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
  searchWrapper: { backgroundColor: colors.bgCard, paddingTop: spacing.md, gap: spacing.sm },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.md, paddingVertical: spacing.sm },
  filtersScroll: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.xs },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  filterChipActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  filterChipDisabled: { opacity: 0.4 },
  filterIcon: { fontSize: fontSize.sm },
  filterText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  filterTextActive: { color: colors.accent, fontWeight: fontWeight.bold },
  filterCount: { color: colors.textTertiary, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  searchScopeBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  searchScopeText: { color: colors.textSecondary, fontSize: fontSize.sm },
  emptyState: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md },
  emptyTitle: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  emptyButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  emptyButtonText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  categoriesWrapper: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bgCard },
  categoriesScroll: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
  categoryChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.borderLight },
  categoryChipSelected: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  categoryText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  categoryTextSelected: { color: colors.accent, fontWeight: fontWeight.bold },
  listContent: { padding: spacing.md, gap: spacing.md, paddingBottom: 100 },
  cardWrapper: {},
});
