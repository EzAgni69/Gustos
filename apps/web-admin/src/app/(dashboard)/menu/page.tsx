"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createMenuItemSchema, type CreateMenuItem, type MenuItem, type MenuCategory, type Outlet, type UpdateMenuItem } from "@gusto/api-contracts";
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
  DialogTrigger,
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
import { UtensilsCrossed, Plus, MoreHorizontal, Loader2, Edit, Trash2, FolderEdit } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export default function MenuPage() {
  const { toast } = useToast();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Item Modal State
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const form = useForm<CreateMenuItem & { isActive?: boolean }>({
    resolver: zodResolver(createMenuItemSchema) as any, // bypass strict schema check
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
    }
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    let initialOutletId = "";
    
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      if (outletsRes.data[0]) {
        initialOutletId = outletsRes.data[0].id;
        setCurrentOutletId(initialOutletId);
        form.setValue("outletId", initialOutletId);
      }
      
      const [itemsRes, catRes] = await Promise.all([
        apiFetch<MenuItem[]>(`/menu/items?outletId=${initialOutletId}`),
        apiFetch<MenuCategory[]>(`/menu/categories?outletId=${initialOutletId}`),
      ]);

      if (catRes.success && catRes.data) {
        setCategories(catRes.data);
        if (catRes.data.length > 0 && catRes.data[0]) {
          form.setValue("categoryId", catRes.data[0].id);
        }
      }

      if (itemsRes.success && itemsRes.data) {
        setMenuItems(itemsRes.data);
      }
    } else {
      setError(outletsRes.message || "Failed to load outlets. Ensure the API server is running.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateItemModal = () => {
    setEditingItem(null);
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

  const handleSaveItem = async (data: any) => {
    setIsSubmitting(true);

    if (editingItem) {
      // Update
      const res = await apiFetch<MenuItem>(`/menu/items/${editingItem.id}`, {
        method: "PUT",
        body: JSON.stringify({
          categoryId: data.categoryId,
          name: data.name,
          description: data.description || undefined,
          price: data.price,
          gstRate: data.gstRate,
          isVeg: data.isVeg,
          isAvailable: data.isAvailable,
          sortOrder: data.sortOrder,
          variants: data.variants || undefined,
        }),
      });

      if (res.success && res.data) {
        setMenuItems(menuItems.map(m => m.id === editingItem.id ? res.data! : m));
        setIsItemModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message || "Failed to update menu item", variant: "error" });
      }
    } else {
      // Create
      const res = await apiFetch<MenuItem>("/menu/items", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          description: data.description || undefined,
          variants: data.variants || undefined,
        }),
      });

      if (res.success && res.data) {
        setMenuItems([...menuItems, res.data]);
        setIsItemModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create menu item", variant: "error" });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    const res = await apiFetch(`/menu/items/${id}`, { method: "DELETE" });
    if (res.success) {
      setMenuItems(menuItems.filter(m => m.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete item", variant: "error" });
    }
  };

  // Category Management Methods
  const handleSaveCategory = async () => {
    if (!categoryName.trim() || !currentOutletId) return;

    if (editingCategoryId) {
      const res = await apiFetch<MenuCategory>(`/menu/categories/${editingCategoryId}`, {
        method: "PUT",
        body: JSON.stringify({ name: categoryName }),
      });
      if (res.success && res.data) {
        setCategories(categories.map(c => c.id === editingCategoryId ? res.data! : c));
        setEditingCategoryId(null);
        setCategoryName("");
      }
    } else {
      const res = await apiFetch<MenuCategory>("/menu/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName, outletId: currentOutletId }),
      });
      if (res.success && res.data) {
        setCategories([...categories, res.data]);
        setCategoryName("");
      }
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Are you sure? This will fail if there are items inside this category.")) return;
    const res = await apiFetch(`/menu/categories/${id}`, { method: "DELETE" });
    if (res.success) {
      setCategories(categories.filter(c => c.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete category", variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Menu Management</h1>
          <p className="text-gray-500">Manage categories, dishes, and pricing across your outlets.</p>
        </div>
        
        <div className="flex gap-2">
          {/* Manage Categories Modal */}
          <Dialog open={isCategoryModalOpen} onOpenChange={setIsCategoryModalOpen}>
            <DialogTrigger>
              <Button variant="outline" className="bg-white">
                <FolderEdit className="w-4 h-4 mr-2" />
                Manage Categories
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Manage Categories</DialogTitle>
                <DialogDescription>
                  Create, rename, or delete menu categories for the current outlet.
                </DialogDescription>
              </DialogHeader>
              
              <div className="py-4 space-y-4">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-2">
                    <Label>{editingCategoryId ? "Edit Category Name" : "New Category Name"}</Label>
                    <Input 
                      value={categoryName} 
                      onChange={e => setCategoryName(e.target.value)} 
                      placeholder="e.g. Starters, Main Course..."
                    />
                  </div>
                  <Button onClick={handleSaveCategory} className="bg-blue-600 hover:bg-blue-700">
                    {editingCategoryId ? "Update" : "Add"}
                  </Button>
                  {editingCategoryId && (
                    <Button variant="outline" onClick={() => { setEditingCategoryId(null); setCategoryName(""); }}>
                      Cancel
                    </Button>
                  )}
                </div>

                <div className="border rounded-md mt-4 max-h-[300px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category Name</TableHead>
                        <TableHead className="text-right w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((cat) => (
                        <TableRow key={cat.id}>
                          <TableCell className="font-medium">{cat.name}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => { setEditingCategoryId(cat.id); setCategoryName(cat.name); }}>
                                <Edit className="w-4 h-4 text-gray-500 hover:text-blue-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteCategory(cat.id)}>
                                <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-600" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {categories.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-gray-500 py-4">
                            No categories found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isItemModalOpen} onOpenChange={setIsItemModalOpen}>
            <Button onClick={openCreateItemModal} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
            <DialogContent className="sm:max-w-[500px]">
              <form onSubmit={form.handleSubmit(handleSaveItem)}>
                <DialogHeader>
                  <DialogTitle>{editingItem ? "Edit Menu Item" : "Add Menu Item"}</DialogTitle>
                  <DialogDescription>
                    {editingItem ? "Update the details of this menu item." : "Create a new dish or product to sell in your outlet."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  {!editingItem && (
                    <div className="space-y-2">
                      <Label htmlFor="outlet">Outlet</Label>
                      <select
                        id="outlet"
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                        {...form.register("outletId")}
                      >
                        {outlets.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                      {form.formState.errors.outletId && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.outletId.message}</p>
                      )}
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <select
                      id="category"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...form.register("categoryId")}
                    >
                      {categories.length === 0 && <option value="" disabled>No categories available</option>}
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {form.formState.errors.categoryId && (
                      <p className="text-red-500 text-xs font-medium">{form.formState.errors.categoryId.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Item Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g. Margherita Pizza"
                      {...form.register("name")}
                    />
                    {form.formState.errors.name && (
                      <p className="text-red-500 text-xs font-medium">{form.formState.errors.name.message}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Ingredients or details..."
                      className="resize-none"
                      {...form.register("description")}
                    />
                    {form.formState.errors.description && (
                      <p className="text-red-500 text-xs font-medium">{form.formState.errors.description.message}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="variants">Variants (JSON format)</Label>
                    <Textarea
                      id="variants"
                      placeholder='[{"name": "8\"", "price": 100}, {"name": "12\"", "price": 200}]'
                      className="resize-none font-mono text-xs"
                      {...form.register("variants")}
                    />
                    {form.formState.errors.variants && (
                      <p className="text-red-500 text-xs font-medium">{form.formState.errors.variants.message}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="price">Price (₹)</Label>
                      <Input
                        id="price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="399"
                        {...form.register("price", { valueAsNumber: true })}
                      />
                      {form.formState.errors.price && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.price.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gstRate">GST Rate</Label>
                      <select
                        id="gstRate"
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                        {...form.register("gstRate")}
                      >
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="12">12%</option>
                        <option value="18">18%</option>
                        <option value="28">28%</option>
                      </select>
                      {form.formState.errors.gstRate && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.gstRate.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 pt-2">
                    <div className="flex items-center space-x-2">
                      <Controller
                        name="isVeg"
                        control={form.control}
                        render={({ field }) => (
                          <Switch
                            id="isVeg"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        )}
                      />
                      <Label htmlFor="isVeg" className="font-normal cursor-pointer">
                        Vegetarian
                      </Label>
                    </div>
                    
                    {editingItem && (
                      <div className="flex items-center space-x-2">
                        <Controller
                          name="isAvailable"
                          control={form.control}
                          render={({ field }) => (
                            <Switch
                              id="isAvailable"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          )}
                        />
                        <Label htmlFor="isAvailable" className="font-normal cursor-pointer">
                          Available (In Stock)
                        </Label>
                      </div>
                    )}
                  </div>
                </div>
                
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsItemModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingItem ? "Save Changes" : "Save Item"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-blue-600" />            <div>
              <CardTitle className="text-lg">All Menu Items</CardTitle>
              <CardDescription>Comprehensive list of all dishes and items.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Loading menu items...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead className="w-[250px]">Item Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {menuItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-gray-900">
                      <div>
                        {item.name}
                        {item.description && (
                          <p className="text-xs text-gray-400 font-normal">{item.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                          item.isVeg
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {item.isVeg ? "Veg" : "Non-Veg"}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-900 font-medium">₹{Number(item.price).toFixed(2)}</TableCell>
                    <TableCell className="text-gray-500 font-mono text-xs">{item.gstRate}%</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          item.isAvailable ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.isAvailable ? "Available" : "Out of Stock"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditItemModal(item)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {menuItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                      No menu items found. Add some!
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
