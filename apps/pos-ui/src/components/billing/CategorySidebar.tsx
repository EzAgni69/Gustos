import React, { useMemo } from "react";
import { useMenuStore } from "../../store/useMenuStore";

export const CategorySidebar: React.FC = () => {
  const { categories, selectedCategoryId, setSelectedCategory, resetSearch, items } = useMenuStore();

  const handleSelectCategory = (catId: string) => {
    setSelectedCategory(catId);
    resetSearch();
  };

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1);
    }
    return counts;
  }, [items]);

  return (
    <aside className="w-56 bg-surface border-r border-border flex flex-col h-full select-none shrink-0">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between text-xs text-text-muted font-bold tracking-wider">
        <span>CATEGORIES</span>
        <span className="text-[10px] text-primary-hover font-mono">[Alt+1..9]</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {categories.map((cat, index) => {
          const isSelected = selectedCategoryId === cat.id;
          const itemCount = categoryCounts.get(cat.id) || 0;
          const shortcutNum = index + 1;

          return (
            <button
              key={cat.id}
              onClick={() => handleSelectCategory(cat.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs font-semibold transition-all ${
                isSelected
                  ? "bg-primary text-text-inverse font-bold shadow-md shadow-primary/30"
                  : "text-text-main hover:bg-surface-hover hover:text-text-main"
              }`}
              title={`Switch to ${cat.name} (Shortcut: Alt+${shortcutNum})`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 font-bold ${
                    isSelected
                      ? "bg-orange-700 text-orange-200"
                      : "bg-surface-hover text-text-muted border border-border-hover"
                  }`}
                >
                  {shortcutNum}
                </span>
                <span className="truncate leading-tight">{cat.name}</span>
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ml-1 shrink-0 ${
                  isSelected ? "bg-orange-800 text-orange-100" : "bg-surface-hover text-text-muted"
                }`}
              >
                {itemCount}
              </span>
            </button>
          );
        })}
      </div>

      <div className="p-2 border-t border-border text-[11px] text-text-muted text-center font-mono">
        Jump with Alt + Number
      </div>
    </aside>
  );
};
