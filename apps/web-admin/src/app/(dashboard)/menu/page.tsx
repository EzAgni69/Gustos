"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createMenuItemSchema,
  type CreateMenuItem,
  type MenuItem,
  type MenuCategory,
  type Outlet,
} from "@gusto/api-contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  UtensilsCrossed,
  Plus,
  MoreHorizontal,
  Loader2,
  Edit,
  Trash2,
  FolderEdit,
  Sparkles,
  Search,
  X,
  Layers,
  Check,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { getPersistedOutletId, setPersistedOutletId } from "@/lib/outlet-context";
import { OutletSwitcher } from "@/components/shared/OutletSwitcher";
import { EmptyState } from "@/components/shared/EmptyState";

interface VariantRow {
  name: string;
  price: number;
}

export default function MenuPage() {
  const { toast } = useToast();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [switcherLoading, setSwitcherLoading] = useState(false);
  const [error, setError] = useState("");

  // Filtering & Search
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [vegFilter, setVegFilter] = useState<"ALL" | "VEG" | "NON_VEG">("ALL");

  // Item Modal State
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Variant Builder State for Item Modal
  const [hasVariants, setHasVariants] = useState(false);
  const [variantList, setVariantList] = useState<VariantRow[]>([]);

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // Load Standard Menu Modal State
  const [isLoadStandardModalOpen, setIsLoadStandardModalOpen] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [isLoadingStandard, setIsLoadingStandard] = useState(false);

  const form = useForm<CreateMenuItem & { isActive?: boolean }>({
    resolver: zodResolver(createMenuItemSchema) as any,
    defaultValues: {
      outletId: "",
      categoryId: "",
      name: "",
      description: "",
      price: undefined as unknown as number,
      gstRate: "5",
      isVeg: true,
      isAvailable: true,
      sortOrder: 0,
      variants: "",
    },
  });

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  const loadData = async () => {
    setLoading(true);
    setError("");

    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    let initialOutletId = "";

    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);

      const persistedId = getPersistedOutletId();
      const persistedOutlet = persistedId
        ? outletsRes.data.find((o) => o.id === persistedId)
        : null;

      if (persistedOutlet) {
        initialOutletId = persistedOutlet.id;
      } else if (outletsRes.data[0]) {
        initialOutletId = outletsRes.data[0].id;
      }

      setCurrentOutletId(initialOutletId);
      setPersistedOutletId(initialOutletId);
      form.setValue("outletId", initialOutletId);

      const [itemsRes, catRes] = await Promise.all([
        apiFetch<MenuItem[]>(`/menu/items?outletId=${initialOutletId}&limit=500`),
        apiFetch<MenuCategory[]>(`/menu/categories?outletId=${initialOutletId}`),
      ]);

      if (catRes.success && catRes.data) {
        setCategories(catRes.data);
        if (catRes.data.length > 0 && catRes.data[0]) {
          form.setValue("categoryId", catRes.data[0].id);
        }
      } else if (!catRes.success) {
        setError(catRes.message || "Failed to load categories.");
      }

      if (itemsRes.success && itemsRes.data) {
        setMenuItems(itemsRes.data);
      } else if (!itemsRes.success) {
        setError(itemsRes.message || "Failed to load menu items.");
      }
    } else {
      setError(
        outletsRes.message || "Failed to load outlets. Ensure the API server is running."
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOutletChange = async (newOutletId: string) => {
    setCurrentOutletId(newOutletId);
    setPersistedOutletId(newOutletId);
    form.setValue("outletId", newOutletId);

    setCategories([]);
    setMenuItems([]);
    setSelectedCategoryId("ALL");
    setSearchQuery("");
    setSwitcherLoading(true);
    setError("");

    const timeoutId = setTimeout(() => {
      setSwitcherLoading(false);
      setError("Data could not be loaded in time. Please try again.");
    }, 5_000);

    try {
      const [itemsRes, catRes] = await Promise.all([
        apiFetch<MenuItem[]>(`/menu/items?outletId=${newOutletId}&limit=500`),
        apiFetch<MenuCategory[]>(`/menu/categories?outletId=${newOutletId}`),
      ]);

      clearTimeout(timeoutId);

      if (catRes.success && catRes.data) {
        setCategories(catRes.data);
        if (catRes.data.length > 0 && catRes.data[0]) {
          form.setValue("categoryId", catRes.data[0].id);
        }
      } else if (!catRes.success) {
        setError(catRes.message || "Failed to load categories for the selected outlet.");
      }

      if (itemsRes.success && itemsRes.data) {
        setMenuItems(itemsRes.data);
      } else if (!itemsRes.success) {
        setError(itemsRes.message || "Failed to load menu items for the selected outlet.");
      }
    } catch {
      clearTimeout(timeoutId);
      setError("Failed to load data for the selected outlet. Please try again.");
    } finally {
      setSwitcherLoading(false);
    }
  };

  // ─── Filtered Items ───
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      // Category filter
      if (selectedCategoryId !== "ALL" && item.categoryId !== selectedCategoryId) {
        return false;
      }
      // Veg filter
      if (vegFilter === "VEG" && !item.isVeg) return false;
      if (vegFilter === "NON_VEG" && item.isVeg) return false;
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDesc = (item.description || "").toLowerCase().includes(query);
        const catName = (categoryMap.get(item.categoryId) || "").toLowerCase();
        const matchesCat = catName.includes(query);
        if (!matchesName && !matchesDesc && !matchesCat) return false;
      }
      return true;
    });
  }, [menuItems, selectedCategoryId, vegFilter, searchQuery, categoryMap]);

  // ─── Load Standard Menu from menu.md ───
  const handleLoadStandardMenu = async () => {
    if (!currentOutletId) return;
    setIsLoadingStandard(true);

    try {
      const res = await apiFetch<{ categoriesCount: number; itemsInserted: number; totalItems: number }>(
        "/menu/load-standard",
        {
          method: "POST",
          body: JSON.stringify({
            outletId: currentOutletId,
            replace: replaceExisting,
          }),
        }
      );

      if (res.success && res.data) {
        toast({
          title: "Menu Loaded Successfully",
          description: `Loaded ${res.data.totalItems} items across ${res.data.categoriesCount} categories from menu.md.`,
          variant: "success",
        });
        setIsLoadStandardModalOpen(false);
        // Refresh data
        await handleOutletChange(currentOutletId);
      } else {
        toast({
          title: "Failed to load menu",
          description: res.message || "Could not load standard menu",
          variant: "error",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "An unexpected error occurred while loading menu.",
        variant: "error",
      });
    } finally {
      setIsLoadingStandard(false);
    }
  };

  // ─── Inline Availability Toggle with Optimistic Update (Task 3.3) ───
  const handleToggleAvailability = async (itemId: string, newStatus: boolean) => {
    // Optimistic update
    setMenuItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, isAvailable: newStatus } : item))
    );

    const res = await apiFetch<MenuItem>(`/menu/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ isAvailable: newStatus }),
    });

    if (!res.success) {
      // Revert if failed
      setMenuItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, isAvailable: !newStatus } : item))
      );
      toast({
        title: "Update failed",
        description: res.message || "Could not update availability state.",
        variant: "error",
      });
    } else {
      toast({
        title: newStatus ? "Item In Stock" : "Item Marked Out of Stock",
        description: "Availability updated instantly.",
        variant: "default",
      });
    }
  };

  // ─── Item Modal Methods ───
  const openCreateItemModal = () => {
    setEditingItem(null);
    setHasVariants(false);
    setVariantList([]);
    form.reset({
      outletId: currentOutletId,
      categoryId: categories.length > 0 ? categories[0]?.id : "",
      name: "",
      description: "",
      price: undefined,
      gstRate: "5",
      isVeg: true,
      isAvailable: true,
      sortOrder: 0,
      variants: "",
    });
    setIsItemModalOpen(true);
  };

  const openEditItemModal = (item: MenuItem) => {
    setEditingItem(item);

    // Parse variants if available
    let parsed: VariantRow[] = [];
    if (item.variants) {
      try {
        const v = JSON.parse(item.variants);
        if (Array.isArray(v)) parsed = v;
      } catch {
        parsed = [];
      }
    }

    setHasVariants(parsed.length > 0);
    setVariantList(parsed);

    form.reset({
      outletId: item.outletId,
      categoryId: item.categoryId,
      name: item.name,
      description: item.description || "",
      price: Number(item.price),
      gstRate: item.gstRate as any,
      isVeg: item.isVeg,
      isAvailable: item.isAvailable,
      sortOrder: item.sortOrder,
      variants: item.variants || "",
    });
    setIsItemModalOpen(true);
  };

  const addVariantRow = () => {
    setVariantList([...variantList, { name: "", price: 0 }]);
  };

  const updateVariantRow = (index: number, field: "name" | "price", value: any) => {
    const updated = [...variantList];
    if (field === "name") {
      updated[index] = { ...updated[index]!, name: value };
    } else {
      updated[index] = { ...updated[index]!, price: Number(value) || 0 };
    }
    setVariantList(updated);
  };

  const removeVariantRow = (index: number) => {
    setVariantList(variantList.filter((_, i) => i !== index));
  };

  const applyPizzaPreset = () => {
    const currentPrice = Number(form.getValues("price")) || 600;
    setHasVariants(true);
    setVariantList([
      { name: "8\"", price: currentPrice },
      { name: "12\"", price: currentPrice + 300 },
    ]);
  };

  const handleSaveItem = async (data: any) => {
    setIsSubmitting(true);

    const variantsString =
      hasVariants && variantList.length > 0
        ? JSON.stringify(variantList.filter((v) => v.name.trim().length > 0))
        : undefined;

    // If variants exist, set base price to first variant's price if base price was not set
    let finalPrice = data.price;
    if ((finalPrice === undefined || isNaN(finalPrice)) && hasVariants && variantList.length > 0) {
      finalPrice = variantList[0]?.price ?? 0;
    }

    if (editingItem) {
      const res = await apiFetch<MenuItem>(`/menu/items/${editingItem.id}`, {
        method: "PUT",
        body: JSON.stringify({
          categoryId: data.categoryId,
          name: data.name,
          description: data.description || undefined,
          price: finalPrice,
          gstRate: data.gstRate,
          isVeg: data.isVeg,
          isAvailable: data.isAvailable,
          sortOrder: data.sortOrder,
          variants: variantsString,
        }),
      });

      if (res.success && res.data) {
        setMenuItems(menuItems.map((m) => (m.id === editingItem.id ? res.data! : m)));
        setIsItemModalOpen(false);
        toast({ title: "Updated", description: "Menu item updated successfully.", variant: "success" });
      } else {
        toast({ title: "Update failed", description: res.message || "Failed to update menu item", variant: "error" });
      }
    } else {
      const res = await apiFetch<MenuItem>("/menu/items", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          price: finalPrice,
          description: data.description || undefined,
          variants: variantsString,
        }),
      });

      if (res.success && res.data) {
        setMenuItems([...menuItems, res.data]);
        setIsItemModalOpen(false);
        toast({ title: "Created", description: "Menu item created successfully.", variant: "success" });
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create menu item", variant: "error" });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Are you sure you want to delete this dish?")) return;
    const res = await apiFetch(`/menu/items/${id}`, { method: "DELETE" });
    if (res.success) {
      setMenuItems(menuItems.filter((m) => m.id !== id));
      toast({ title: "Deleted", description: "Menu item removed.", variant: "default" });
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete item", variant: "error" });
    }
  };

  // ─── Category Management Methods ───
  const handleSaveCategory = async () => {
    if (!categoryName.trim() || !currentOutletId) return;

    if (editingCategoryId) {
      const res = await apiFetch<MenuCategory>(`/menu/categories/${editingCategoryId}`, {
        method: "PUT",
        body: JSON.stringify({ name: categoryName }),
      });
      if (res.success && res.data) {
        setCategories(categories.map((c) => (c.id === editingCategoryId ? res.data! : c)));
        setEditingCategoryId(null);
        setCategoryName("");
        toast({ title: "Category Updated", description: "Category renamed successfully.", variant: "success" });
      }
    } else {
      const res = await apiFetch<MenuCategory>("/menu/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName, outletId: currentOutletId }),
      });
      if (res.success && res.data) {
        setCategories([...categories, res.data]);
        setCategoryName("");
        toast({ title: "Category Created", description: "New category added.", variant: "success" });
      }
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Are you sure? This will delete all dishes inside this category.")) return;
    const res = await apiFetch(`/menu/categories/${id}`, { method: "DELETE" });
    if (res.success) {
      setCategories(categories.filter((c) => c.id !== id));
      setMenuItems(menuItems.filter((m) => m.categoryId !== id));
      toast({ title: "Category Deleted", description: "Category removed.", variant: "default" });
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete category", variant: "error" });
    }
  };

  const currentOutletName = outlets.find((o) => o.id === currentOutletId)?.name || "Current Outlet";

  return (
    <div className="space-y-6">
      {/* Outlet Switcher */}
      {outlets.length > 0 && (
        <OutletSwitcher
          outlets={outlets}
          currentOutletId={currentOutletId}
          onOutletChange={handleOutletChange}
          isLoading={switcherLoading}
          className="sm:w-auto w-full"
        />
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Menu Management</h1>
          <p className="text-gray-500">
            Manage categories, dishes, variants, and pricing for <span className="font-semibold text-gray-700">{currentOutletName}</span>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Load Standard Menu from menu.md button */}
          <Button
            variant="outline"
            className="bg-white border-amber-200 text-amber-900 hover:bg-amber-50"
            onClick={() => {
              setReplaceExisting(menuItems.length === 0);
              setIsLoadStandardModalOpen(true);
            }}
          >
            <Sparkles className="w-4 h-4 mr-2 text-amber-600" />
            Load Menu from menu.md
          </Button>

          {/* Manage Categories Modal */}
          <Dialog open={isCategoryModalOpen} onOpenChange={setIsCategoryModalOpen}>
            <Button
              variant="outline"
              className="bg-white"
              onClick={() => {
                setEditingCategoryId(null);
                setCategoryName("");
                setIsCategoryModalOpen(true);
              }}
            >
              <FolderEdit className="w-4 h-4 mr-2 text-gray-600" />
              Manage Categories ({categories.length})
            </Button>
            <DialogContent className="sm:max-w-[550px]">
              <DialogHeader>
                <DialogTitle>Manage Categories</DialogTitle>
                <DialogDescription>
                  Create, rename, or delete categories for {currentOutletName}.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4 space-y-4">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-2">
                    <Label>{editingCategoryId ? "Edit Category Name" : "New Category Name"}</Label>
                    <Input
                      value={categoryName}
                      onChange={(e) => setCategoryName(e.target.value)}
                      placeholder="e.g. Starters, Regular Pizzas, Pastas..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveCategory();
                        }
                      }}
                    />
                  </div>
                  <Button onClick={handleSaveCategory} className="bg-blue-600 hover:bg-blue-700">
                    {editingCategoryId ? "Update" : "Add"}
                  </Button>
                  {editingCategoryId && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingCategoryId(null);
                        setCategoryName("");
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>

                <div className="border rounded-md mt-4 max-h-[350px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead>Category Name</TableHead>
                        <TableHead className="text-center w-[100px]">Items</TableHead>
                        <TableHead className="text-right w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((cat) => {
                        const count = menuItems.filter((i) => i.categoryId === cat.id).length;
                        return (
                          <TableRow key={cat.id}>
                            <TableCell className="font-medium text-gray-900">{cat.name}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="muted" className="text-xs">
                                {count} {count === 1 ? "dish" : "dishes"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditingCategoryId(cat.id);
                                    setCategoryName(cat.name);
                                  }}
                                  title="Edit category"
                                >
                                  <Edit className="w-4 h-4 text-gray-500 hover:text-blue-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteCategory(cat.id)}
                                  title="Delete category"
                                >
                                  <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-600" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {categories.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-gray-500 py-6">
                            No categories yet. Click "Load Menu from menu.md" or add a new category above.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Add Item Button */}
          <Button onClick={openCreateItemModal} className="bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
            <Plus className="w-4 h-4 mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Category Filter Pills Bar */}
      {categories.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setSelectedCategoryId("ALL")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                selectedCategoryId === "ALL"
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              All Items ({menuItems.length})
            </button>
            {categories.map((cat) => {
              const count = menuItems.filter((i) => i.categoryId === cat.id).length;
              const isSelected = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                    isSelected
                      ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {cat.name} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search and Quick Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search dish, ingredients, or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8 bg-white h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
            <button
              onClick={() => setVegFilter("ALL")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                vegFilter === "ALL" ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setVegFilter("VEG")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                vegFilter === "VEG" ? "bg-emerald-600 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Veg Only
            </button>
            <button
              onClick={() => setVegFilter("NON_VEG")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                vegFilter === "NON_VEG" ? "bg-red-600 text-white" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Non-Veg
            </button>
          </div>

          <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
            Showing {filteredItems.length} of {menuItems.length}
          </span>
        </div>
      </div>

      {/* Menu Table Card */}
      <Card className="shadow-xs border-gray-200">
        <CardHeader className="bg-gray-50/60 border-b border-gray-100 py-3.5 px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle className="text-base font-semibold text-gray-900">
                  {selectedCategoryId === "ALL"
                    ? "All Menu Items"
                    : categories.find((c) => c.id === selectedCategoryId)?.name || "Category Items"}
                </CardTitle>
                <CardDescription className="text-xs">
                  {filteredItems.length} items currently displayed
                </CardDescription>
              </div>
            </div>
            {menuItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOutletChange(currentOutletId)}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Refresh
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <p className="text-sm">Loading menu items from {currentOutletName}...</p>
            </div>
          ) : menuItems.length === 0 ? (
            <div className="py-12 px-4">
              <EmptyState
                icon={UtensilsCrossed}
                title={`No menu items in ${currentOutletName}`}
                description="This outlet does not have any dishes configured yet. You can load all 105 dishes and 12 categories from menu.md instantly, or add custom dishes."
                action={{
                  label: "Load Gusto's Standard Menu (menu.md)",
                  onClick: () => {
                    setReplaceExisting(true);
                    setIsLoadStandardModalOpen(true);
                  },
                }}
              />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 px-4">
              <EmptyState
                title="No matching dishes found"
                description="Try clearing your search keyword or changing the category filter."
                action={{
                  label: "Clear All Filters",
                  onClick: () => {
                    setSelectedCategoryId("ALL");
                    setSearchQuery("");
                    setVegFilter("ALL");
                  },
                }}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                  <TableHead className="w-[320px]">Dish & Ingredients</TableHead>
                  <TableHead className="w-[140px]">Category</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead className="w-[180px]">Price & Sizes</TableHead>
                  <TableHead className="w-[80px]">GST</TableHead>
                  <TableHead className="w-[130px]">In Stock</TableHead>
                  <TableHead className="text-right w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  let parsedVariants: VariantRow[] = [];
                  if (item.variants) {
                    try {
                      const v = JSON.parse(item.variants);
                      if (Array.isArray(v)) parsedVariants = v;
                    } catch {
                      parsedVariants = [];
                    }
                  }

                  const categoryName = categoryMap.get(item.categoryId) || "Uncategorized";

                  return (
                    <TableRow key={item.id} className="hover:bg-blue-50/20 transition-colors">
                      {/* Dish Name & Description */}
                      <TableCell className="align-top py-3">
                        <div className="space-y-1">
                          <span className="font-semibold text-gray-900 text-sm">{item.name}</span>
                          {item.description && (
                            <p className="text-xs text-gray-500 font-normal line-clamp-2 leading-relaxed">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </TableCell>

                      {/* Category */}
                      <TableCell className="align-top py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200">
                          {categoryName}
                        </span>
                      </TableCell>

                      {/* Veg / Non-Veg */}
                      <TableCell className="align-top py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${
                            item.isVeg
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              item.isVeg ? "bg-emerald-600" : "bg-red-600"
                            }`}
                          />
                          {item.isVeg ? "Veg" : "Non-Veg"}
                        </span>
                      </TableCell>

                      {/* Price & Variants */}
                      <TableCell className="align-top py-3">
                        {parsedVariants.length > 0 ? (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {parsedVariants.map((v, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200"
                                >
                                  {v.name}: ₹{Number(v.price).toFixed(0)}
                                </span>
                              ))}
                            </div>
                            <span className="text-[10px] text-gray-400 block">Base: ₹{Number(item.price).toFixed(2)}</span>
                          </div>
                        ) : (
                          <span className="text-gray-900 font-semibold text-sm">
                            ₹{Number(item.price).toFixed(2)}
                          </span>
                        )}
                      </TableCell>

                      {/* GST */}
                      <TableCell className="align-top py-3">
                        <span className="text-gray-600 font-mono text-xs">{item.gstRate}%</span>
                      </TableCell>

                      {/* In Stock Inline Switch (Task 3.3) */}
                      <TableCell className="align-top py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`avail-${item.id}`}
                            checked={item.isAvailable}
                            onCheckedChange={(checked) => handleToggleAvailability(item.id, checked)}
                          />
                          <Label
                            htmlFor={`avail-${item.id}`}
                            className={`text-xs cursor-pointer ${
                              item.isAvailable ? "text-emerald-700 font-medium" : "text-gray-400"
                            }`}
                          >
                            {item.isAvailable ? "Available" : "Off"}
                          </Label>
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right align-top py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onClick={() => openEditItemModal(item)}>
                              <Edit className="w-4 h-4 mr-2 text-blue-600" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => handleDeleteItem(item.id)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Load Gusto Standard Menu Modal ─── */}
      <Dialog open={isLoadStandardModalOpen} onOpenChange={setIsLoadStandardModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Sparkles className="w-5 h-5 text-amber-600" />
              </div>
              <DialogTitle className="text-lg">Load Menu from menu.md</DialogTitle>
            </div>
            <DialogDescription>
              Populate the authentic Gusto's restaurant menu directly into{" "}
              <span className="font-semibold text-gray-900">{currentOutletName}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3 text-sm">
            <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 space-y-2 text-amber-900">
              <p className="font-medium flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                Includes all official sections:
              </p>
              <ul className="text-xs space-y-1 list-disc list-inside text-amber-800 ml-1">
                <li>Starters (Tasca & Spiccio D'aglio with 8" & 12" variants)</li>
                <li>Salads & Bruschetta (Authentic sourdough recipes)</li>
                <li>Sandwiches & Calzones (Panuozzo, Panzerotti, Tricolor)</li>
                <li>Regular Pizzas (30 handcrafted varieties)</li>
                <li>Premium Pizzas (15 artisanal varieties)</li>
                <li>Pastas (Dough bowl pasta dishes) & Desserts</li>
                <li>Refreshments, Half N Half Specials, Combos & Add-Ons</li>
              </ul>
            </div>

            <div className="flex items-start space-x-3 pt-2">
              <Switch
                id="replaceExisting"
                checked={replaceExisting}
                onCheckedChange={setReplaceExisting}
              />
              <div className="space-y-0.5">
                <Label htmlFor="replaceExisting" className="font-medium cursor-pointer text-gray-900">
                  Clean & Replace existing items
                </Label>
                <p className="text-xs text-gray-500">
                  If enabled, existing dishes and categories for this outlet will be cleanly refreshed with the standard menu.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsLoadStandardModalOpen(false)}
              disabled={isLoadingStandard}
            >
              Cancel
            </Button>
            <Button
              onClick={handleLoadStandardMenu}
              disabled={isLoadingStandard}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isLoadingStandard && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isLoadingStandard ? "Loading Menu..." : "Load Menu into Outlet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Add / Edit Item Modal ─── */}
      <Dialog open={isItemModalOpen} onOpenChange={setIsItemModalOpen}>
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          <form onSubmit={form.handleSubmit(handleSaveItem)}>
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit Menu Dish" : "Add New Dish"}</DialogTitle>
              <DialogDescription>
                {editingItem
                  ? "Update recipe, pricing, and variant sizes for this dish."
                  : `Create a new dish or product in ${currentOutletName}.`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Category & Outlet */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <select
                    id="category"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    {...form.register("categoryId")}
                  >
                    {categories.length === 0 && (
                      <option value="" disabled>
                        No categories available
                      </option>
                    )}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {form.formState.errors.categoryId && (
                    <p className="text-red-500 text-xs font-medium">
                      {form.formState.errors.categoryId.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gstRate">GST Rate</Label>
                  <select
                    id="gstRate"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    {...form.register("gstRate")}
                  >
                    <option value="0">0% (Exempt)</option>
                    <option value="5">5% (Standard Restaurant GST)</option>
                    <option value="12">12%</option>
                    <option value="18">18%</option>
                    <option value="28">28%</option>
                  </select>
                  {form.formState.errors.gstRate && (
                    <p className="text-red-500 text-xs font-medium">
                      {form.formState.errors.gstRate.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Item Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Dish Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Margherita Panuozzo, Garlic Butter Bruschetta..."
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <p className="text-red-500 text-xs font-medium">{form.formState.errors.name.message}</p>
                )}
              </div>

              {/* Description / Ingredients */}
              <div className="space-y-2">
                <Label htmlFor="description">Ingredients / Recipe Description</Label>
                <Textarea
                  id="description"
                  placeholder="Hand-stretched dough, San Marzano sauce, fresh mozzarella..."
                  className="resize-none h-20 text-sm"
                  {...form.register("description")}
                />
                {form.formState.errors.description && (
                  <p className="text-red-500 text-xs font-medium">
                    {form.formState.errors.description.message}
                  </p>
                )}
              </div>

              {/* Base Price & Type */}
              <div className="grid grid-cols-2 gap-4 items-center">
                <div className="space-y-2">
                  <Label htmlFor="price">Base Price (₹)</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="500"
                    {...form.register("price", { valueAsNumber: true })}
                  />
                  {form.formState.errors.price && (
                    <p className="text-red-500 text-xs font-medium">
                      {form.formState.errors.price.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2 pt-6">
                  <div className="flex items-center space-x-2">
                    <Controller
                      name="isVeg"
                      control={form.control}
                      render={({ field }) => (
                        <Switch id="isVeg" checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                    <Label htmlFor="isVeg" className="font-medium cursor-pointer text-sm">
                      Vegetarian Dish
                    </Label>
                  </div>
                </div>
              </div>

              {/* Interactive Sizes / Variants Builder */}
              <div className="border border-gray-200 rounded-lg p-3.5 bg-gray-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <Label htmlFor="hasVariantsToggle" className="font-medium text-sm cursor-pointer">
                      Size Variants (e.g. 8" & 12" Pizzas)
                    </Label>
                  </div>
                  <Switch
                    id="hasVariantsToggle"
                    checked={hasVariants}
                    onCheckedChange={(checked) => {
                      setHasVariants(checked);
                      if (checked && variantList.length === 0) {
                        applyPizzaPreset();
                      }
                    }}
                  />
                </div>

                {hasVariants && (
                  <div className="space-y-2.5 pt-1">
                    <div className="flex justify-between items-center text-xs text-gray-500">
                      <span>Specify sizes and respective pricing:</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={applyPizzaPreset}
                        className="text-xs h-7 text-blue-600 hover:text-blue-800"
                      >
                        Reset to 8" & 12"
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {variantList.map((v, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <Input
                            placeholder="Size Label (e.g. 8&quot;)"
                            value={v.name}
                            onChange={(e) => updateVariantRow(idx, "name", e.target.value)}
                            className="bg-white h-8 text-xs flex-1"
                          />
                          <div className="relative w-32">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                              ₹
                            </span>
                            <Input
                              type="number"
                              min="0"
                              placeholder="Price"
                              value={v.price || ""}
                              onChange={(e) => updateVariantRow(idx, "price", e.target.value)}
                              className="pl-6 bg-white h-8 text-xs"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeVariantRow(idx)}
                            className="h-8 w-8 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addVariantRow}
                      className="w-full text-xs h-8 bg-white"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add Size / Variant
                    </Button>
                  </div>
                )}
              </div>

              {/* Status Toggle (if editing) */}
              {editingItem && (
                <div className="flex items-center space-x-2 pt-1">
                  <Controller
                    name="isAvailable"
                    control={form.control}
                    render={({ field }) => (
                      <Switch id="isAvailable" checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                  <Label htmlFor="isAvailable" className="font-normal text-sm cursor-pointer">
                    Dish is Available (In Stock for Orders)
                  </Label>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsItemModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingItem ? "Save Changes" : "Save Dish"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
