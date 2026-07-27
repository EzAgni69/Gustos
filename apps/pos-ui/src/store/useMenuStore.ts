import { create } from "zustand";
import type { GSTRate } from "@gusto/core-logic";

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface POSMenuItem {
  id: string;
  categoryId: string;
  name: string;
  shortCode: string; // e.g. "101", "PBB", "C65"
  description?: string;
  price: number;
  gstRate: GSTRate;
  isVeg: boolean;
  isAvailable: boolean;
  availableModifiers?: string[];
}

export interface MenuStoreState {
  categories: MenuCategory[];
  items: POSMenuItem[];
  selectedCategoryId: string | null;
  searchQuery: string;
  shortCodeMap: Record<string, POSMenuItem>;

  // Actions
  setSelectedCategory: (categoryId: string | null) => void;
  setSearchQuery: (query: string) => void;
  getItemByShortCode: (code: string) => POSMenuItem | undefined;
  getFilteredItems: () => POSMenuItem[];
  resetSearch: () => void;
}

// ─── Initial Petpooja Mock Menu Seed ───
const MOCK_CATEGORIES: MenuCategory[] = [
  { id: "cat-1", name: "Quick Bites & Starters", sortOrder: 1, isActive: true },
  { id: "cat-2", name: "Main Course (Gravies)", sortOrder: 2, isActive: true },
  { id: "cat-3", name: "Indian Breads", sortOrder: 3, isActive: true },
  { id: "cat-4", name: "Rice & Biryani", sortOrder: 4, isActive: true },
  { id: "cat-5", name: "Beverages & Shakes", sortOrder: 5, isActive: true },
  { id: "cat-6", name: "Desserts & Ice Cream", sortOrder: 6, isActive: true },
];

const MOCK_ITEMS: POSMenuItem[] = [
  // Starters
  {
    id: "item-101",
    categoryId: "cat-1",
    name: "Paneer Tikka Dry",
    shortCode: "101",
    price: 260,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Spicy", "Jain Preparation", "Less Oil", "Mint Chutney Side"],
  },
  {
    id: "item-102",
    categoryId: "cat-1",
    name: "Crispy Corn Kernels",
    shortCode: "102",
    price: 210,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Spicy", "Less Salt", "No Garlic"],
  },
  {
    id: "item-103",
    categoryId: "cat-1",
    name: "Pav Bhaji Butter",
    shortCode: "PBB",
    price: 180,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Butter", "Jain Preparation", "Extra Pav (+₹40)"],
  },
  {
    id: "item-104",
    categoryId: "cat-1",
    name: "Chicken 65",
    shortCode: "C65",
    price: 320,
    gstRate: "5",
    isVeg: false,
    isAvailable: true,
    availableModifiers: ["Extra Spicy", "Less Oil", "Dry / Gravy"],
  },
  {
    id: "item-105",
    categoryId: "cat-1",
    name: "Tandoori Chicken (Half)",
    shortCode: "TCH",
    price: 380,
    gstRate: "5",
    isVeg: false,
    isAvailable: true,
    availableModifiers: ["Well Done", "Extra Chat Masala", "Mint Chutney Side"],
  },

  // Main Course
  {
    id: "item-201",
    categoryId: "cat-2",
    name: "Paneer Butter Masala",
    shortCode: "PBM",
    price: 320,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Jain Preparation", "Extra Cream", "Less Spicy", "Sweet Gravy"],
  },
  {
    id: "item-202",
    categoryId: "cat-2",
    name: "Dal Makhani (Special)",
    shortCode: "DM",
    price: 280,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Butter", "Less Cream", "No Garlic"],
  },
  {
    id: "item-203",
    categoryId: "cat-2",
    name: "Kadhai Paneer",
    shortCode: "KP",
    price: 310,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Spicy", "Less Oil", "Capsicum Extra"],
  },
  {
    id: "item-204",
    categoryId: "cat-2",
    name: "Butter Chicken (Boneless)",
    shortCode: "BC",
    price: 420,
    gstRate: "5",
    isVeg: false,
    isAvailable: true,
    availableModifiers: ["Sweet Gravy", "Spicy Touch", "Extra Cream"],
  },
  {
    id: "item-205",
    categoryId: "cat-2",
    name: "Mutton Rogan Josh",
    shortCode: "MRJ",
    price: 540,
    gstRate: "5",
    isVeg: false,
    isAvailable: true,
    availableModifiers: ["Spicy Kashmiri Style", "Less Gravy", "Bone-in"],
  },

  // Breads
  {
    id: "item-301",
    categoryId: "cat-3",
    name: "Tandoori Roti (Plain)",
    shortCode: "TR",
    price: 35,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
  },
  {
    id: "item-302",
    categoryId: "cat-3",
    name: "Butter Roti",
    shortCode: "BR",
    price: 45,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Butter", "Crispy / Kadak"],
  },
  {
    id: "item-303",
    categoryId: "cat-3",
    name: "Butter Naan",
    shortCode: "BN",
    price: 65,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Butter", "Crispy", "Cut into 3"],
  },
  {
    id: "item-304",
    categoryId: "cat-3",
    name: "Garlic Naan",
    shortCode: "GN",
    price: 85,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Butter", "Extra Garlic", "Crispy"],
  },
  {
    id: "item-305",
    categoryId: "cat-3",
    name: "Stuffed Kulcha (Paneer/Potato)",
    shortCode: "SK",
    price: 110,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Paneer Stuffing", "Aloo Stuffing", "Mixed Stuffing"],
  },

  // Rice & Biryani
  {
    id: "item-401",
    categoryId: "cat-4",
    name: "Steamed Basmati Rice",
    shortCode: "SR",
    price: 160,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
  },
  {
    id: "item-402",
    categoryId: "cat-4",
    name: "Jeera Fried Rice",
    shortCode: "JR",
    price: 190,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Ghee", "Less Oil"],
  },
  {
    id: "item-403",
    categoryId: "cat-4",
    name: "Vegetable Dum Biryani",
    shortCode: "VB",
    price: 320,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Raita Side", "Extra Salan", "Less Spicy"],
  },
  {
    id: "item-404",
    categoryId: "cat-4",
    name: "Chicken Dum Biryani",
    shortCode: "CB",
    price: 390,
    gstRate: "5",
    isVeg: false,
    isAvailable: true,
    availableModifiers: ["Leg Piece Request", "Extra Spicy", "Extra Raita Side"],
  },
  {
    id: "item-405",
    categoryId: "cat-4",
    name: "Mutton Hyderabadi Biryani",
    shortCode: "MB",
    price: 490,
    gstRate: "5",
    isVeg: false,
    isAvailable: true,
    availableModifiers: ["Spicy Masala", "Extra Salan", "Extra Raita Side"],
  },

  // Beverages
  {
    id: "item-501",
    categoryId: "cat-5",
    name: "Fresh Lime Soda (Sweet/Salted)",
    shortCode: "FLS",
    price: 90,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Sweet Only", "Salted Only", "Mixed Sweet & Salted", "Chilled With Ice"],
  },
  {
    id: "item-502",
    categoryId: "cat-5",
    name: "Masala Chaas (Buttermilk)",
    shortCode: "MC",
    price: 70,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["No Mint", "Extra Jeera Powder", "Chilled"],
  },
  {
    id: "item-503",
    categoryId: "cat-5",
    name: "Special Sweet Lassi",
    shortCode: "LSS",
    price: 120,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Malai / Cream", "Rose Flavour", "Less Sugar"],
  },
  {
    id: "item-504",
    categoryId: "cat-5",
    name: "Cold Coffee with Ice Cream",
    shortCode: "CC",
    price: 180,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Strong Decoction", "Less Sugar", "Chocolate Drizzle"],
  },

  // Desserts
  {
    id: "item-601",
    categoryId: "cat-6",
    name: "Gulab Jamun (2 Pcs Warm)",
    shortCode: "GJ",
    price: 110,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Warm / Hot", "With Vanilla Ice Cream (+₹50)"],
  },
  {
    id: "item-602",
    categoryId: "cat-6",
    name: "Moong Dal Halwa (Desi Ghee)",
    shortCode: "MDH",
    price: 160,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Extra Dry Fruits", "Served Hot"],
  },
  {
    id: "item-603",
    categoryId: "cat-6",
    name: "Rasmalai (2 Pcs Chilled)",
    shortCode: "RM",
    price: 150,
    gstRate: "5",
    isVeg: true,
    isAvailable: true,
    availableModifiers: ["Chilled Extra", "Extra Rabdi"],
  },
];

const initialShortCodeMap = MOCK_ITEMS.reduce((acc, item) => {
  if (item.shortCode) {
    acc[item.shortCode.toUpperCase()] = item;
  }
  return acc;
}, {} as Record<string, POSMenuItem>);

export const useMenuStore = create<MenuStoreState>((set, get) => ({
  categories: MOCK_CATEGORIES,
  items: MOCK_ITEMS,
  selectedCategoryId: MOCK_CATEGORIES[0]?.id ?? null,
  searchQuery: "",
  shortCodeMap: initialShortCodeMap,

  setSelectedCategory: (categoryId) => set({ selectedCategoryId: categoryId }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  resetSearch: () => set({ searchQuery: "" }),

  getItemByShortCode: (code) => {
    const clean = code.trim().toUpperCase();
    return get().shortCodeMap[clean];
  },

  getFilteredItems: () => {
    const { items, selectedCategoryId, searchQuery } = get();
    const query = searchQuery.trim().toLowerCase();

    if (query) {
      return items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.shortCode.toLowerCase() === query ||
          (item.description && item.description.toLowerCase().includes(query))
      );
    }

    if (selectedCategoryId) {
      return items.filter((item) => item.categoryId === selectedCategoryId);
    }

    return items;
  },
}));
