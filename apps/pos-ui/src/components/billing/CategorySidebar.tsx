import React from "react";
import { useMenuStore } from "../../store/useMenuStore";

export const CategorySidebar: React.FC = () => {
  const { categories, selectedCategoryId, setSelectedCategory, resetSearch, items } = useMenuStore();

  const handleSelectCategory = (catId: string) => {
    setSelectedCategory(catId);
    resetSearch();
  };

  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col h-full select-none shrink-0">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between text-xs text-gray-400 font-bold tracking-wider">
        <span>CATEGORIES</span>
        <span className="text-[10px] text-orange-400 font-mono">[Alt+1..9]</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {categories.map((cat, index) => {
          const isSelected = selectedCategoryId === cat.id;
          const itemCount = items.filter((i) => i.categoryId === cat.id).length;
          const shortcutNum = index + 1;

          return (
            <button
              key={cat.id}
              onClick={() => handleSelectCategory(cat.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs font-semibold transition-all ${
                isSelected
                  ? "bg-orange-600 text-white font-bold shadow-md shadow-orange-600/20"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
              title={`Switch to ${cat.name} (Shortcut: Alt+${shortcutNum})`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 font-bold ${
                    isSelected
                      ? "bg-orange-700 text-orange-200"
                      : "bg-gray-800 text-gray-400 border border-gray-700"
                  }`}
                >
                  {shortcutNum}
                </span>
                <span className="truncate leading-tight">{cat.name}</span>
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ml-1 shrink-0 ${
                  isSelected ? "bg-orange-800 text-orange-100" : "bg-gray-800 text-gray-500"
                }`}
              >
                {itemCount}
              </span>
            </button>
          );
        })}
      </div>

      <div className="p-2 border-t border-gray-800 text-[11px] text-gray-500 text-center font-mono">
        Jump with Alt + Number
      </div>
    </aside>
  );
};
