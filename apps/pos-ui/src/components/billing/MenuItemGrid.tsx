import React, { useMemo } from "react";
import { useMenuStore, type POSMenuItem } from "../../store/useMenuStore";
import { useCartStore } from "../../store/useCartStore";
import { useUIStore } from "../../store/useUIStore";
import { VirtuosoGrid } from "react-virtuoso";
import { MenuItemCard } from "./MenuItemCard";

export const MenuItemGrid: React.FC = () => {
  const { getFilteredItems, searchQuery, resetSearch } = useMenuStore();
  const { addItem } = useCartStore();
  const { openModal } = useUIStore();

  const filteredItems = getFilteredItems();

  const handleItemClick = (item: POSMenuItem) => {
    addItem(item);
  };

  // Memoize grid components for Virtuoso
  const GridComponents = useMemo(() => ({
    List: React.forwardRef<HTMLDivElement, any>((props, ref) => (
      <div
        {...props}
        ref={ref}
        className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 content-start"
      />
    )),
    Item: ({ children, ...props }: any) => (
      <div {...props} className="h-[105px]">
        {children}
      </div>
    )
  }), []);

  return (
    <main className="flex-1 bg-background flex flex-col h-full overflow-hidden select-none">
      {/* Search Filter Header if active */}
      {searchQuery && (
        <div className="bg-primary/10 border-b border-primary px-4 py-2 flex items-center justify-between text-xs text-primary-hover">
          <div className="flex items-center gap-2">
            <span className="font-bold">⚡ Active Search Filter:</span>
            <span className="bg-primary/15 font-mono px-2 py-0.5 rounded text-primary-hover font-bold border border-primary/30">
              "{searchQuery}"
            </span>
            <span className="text-text-muted">({filteredItems.length} results)</span>
          </div>
          <button
            onClick={resetSearch}
            className="text-text-muted hover:text-text-main underline text-[11px] flex items-center gap-1"
          >
            <span>Clear [Esc]</span>
          </button>
        </div>
      )}

      {/* Grid container */}
      <div className="flex-1 overflow-hidden">
        {filteredItems.length > 0 ? (
          <VirtuosoGrid
            style={{ height: "100%", width: "100%" }}
            data={filteredItems}
            components={GridComponents as any}
            itemContent={(index, item) => (
              <MenuItemCard key={item.id} item={item} />
            )}
          />
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-center text-text-muted">
            <div className="text-3xl mb-2">🍽️</div>
            <p className="text-sm font-semibold text-text-muted">No items found matching "{searchQuery}"</p>
            <p className="text-xs text-gray-600 mt-1">Try another keyword or press Esc to clear search</p>
            <button
              onClick={resetSearch}
              className="mt-4 px-3 py-1.5 bg-surface-hover hover:bg-surface-hover text-text-main rounded-lg text-xs font-medium border border-border-hover"
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>
    </main>
  );
};
