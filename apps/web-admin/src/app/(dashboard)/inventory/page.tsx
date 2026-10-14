"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Package, Plus, MoreHorizontal, AlertTriangle, Loader2, Edit, Trash2, BookOpen, Clock, Truck, ShoppingCart, ClipboardList } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { InventoryItem, createInventoryItemSchema, MenuItem, Outlet, Recipe, StockTransaction } from "@gusto/api-contracts";
import { RecipeManagerModal } from "@/components/inventory/RecipeManagerModal";

export default function InventoryPage() {
  const { toast } = useToast();
  
  // Data States
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([]);
  
  // UI States
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("materials");

  // Material Modal State
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [isSubmittingMaterial, setIsSubmittingMaterial] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<InventoryItem | null>(null);

  // Recipe Modal State
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState<{ id: string; name: string } | null>(null);

  const materialForm = useForm<any>({
    resolver: zodResolver(createInventoryItemSchema),
    defaultValues: {
      name: "",
      unit: "kg",
      currentStock: 0,
      minimumStock: 0,
      costPerUnit: 0,
    }
  });

  const loadData = async () => {
    setLoading(true);
    
    // Load inventory items
    const invRes = await apiFetch<InventoryItem[]>("/inventory");
    if (invRes.success && invRes.data) {
      setInventoryItems(invRes.data);
    }

    // Load outlets & menu items
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      const initialOutletId = outletsRes.data[0]!.id;
      const itemsRes = await apiFetch<MenuItem[]>(`/menu/items?outletId=${initialOutletId}`);
      if (itemsRes.success && itemsRes.data) {
        setMenuItems(itemsRes.data);
      }
    }

    // Load recipes
    await loadRecipes();

    // Load stock transactions
    const txRes = await apiFetch<StockTransaction[]>("/stock/transactions?limit=50");
    if (txRes.success && txRes.data) {
      setStockTransactions(
        Array.isArray(txRes.data)
          ? txRes.data
          : (txRes.data as any)?.data || []
      );
    }

    setLoading(false);
  };

  const loadRecipes = async () => {
    const recRes = await apiFetch<Recipe[]>("/recipes");
    if (recRes.success && recRes.data) {
      setRecipes(recRes.data);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Material Handlers ---
  const openCreateMaterialModal = () => {
    setEditingMaterial(null);
    materialForm.reset({
      name: "", unit: "kg", currentStock: 0, minimumStock: 0, costPerUnit: 0,
    });
    setIsMaterialModalOpen(true);
  };

  const openEditMaterialModal = (item: InventoryItem) => {
    setEditingMaterial(item);
    materialForm.reset({
      name: item.name, unit: item.unit, currentStock: item.currentStock,
      minimumStock: item.minimumStock, costPerUnit: item.costPerUnit,
    });
    setIsMaterialModalOpen(true);
  };

  const handleSaveMaterial = async (data: any) => {
    setIsSubmittingMaterial(true);

    if (editingMaterial) {
      const res = await apiFetch<InventoryItem>(`/inventory/${editingMaterial.id}`, {
        method: "PUT", body: JSON.stringify(data),
      });

      if (res.success && res.data) {
        setInventoryItems(inventoryItems.map(item => item.id === editingMaterial.id ? res.data! : item));
        setIsMaterialModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message, variant: "error" });
      }
    } else {
      const res = await apiFetch<InventoryItem>("/inventory", {
        method: "POST", body: JSON.stringify(data),
      });

      if (res.success && res.data) {
        setInventoryItems([...inventoryItems, res.data]);
        setIsMaterialModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message, variant: "error" });
      }
    }

    setIsSubmittingMaterial(false);
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!confirm("Are you sure you want to delete this material?")) return;
    const res = await apiFetch(`/inventory/${id}`, { method: "DELETE" });
    if (res.success) {
      setInventoryItems(inventoryItems.filter(item => item.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message, variant: "error" });
    }
  };

  // --- Recipe Handlers ---
  const openRecipeModal = (menuItem: MenuItem) => {
    setSelectedMenuItem({ id: menuItem.id, name: menuItem.name });
    setIsRecipeModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Inventory & Recipes</h1>
          <p className="text-gray-500">Track raw materials, build recipes, and audit automated deductions.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="materials" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Raw Materials
          </TabsTrigger>
          <TabsTrigger value="recipes" className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Recipes
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Audit Trail
          </TabsTrigger>
          <TabsTrigger value="vendors" className="flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Vendors
          </TabsTrigger>
          <TabsTrigger value="purchase_orders" className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="grns" className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            GRNs
          </TabsTrigger>
        </TabsList>

        {/* ─── RAW MATERIALS TAB ─── */}
        <TabsContent value="materials">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Raw Materials</CardTitle>
                  <CardDescription>Current stock levels across your organization.</CardDescription>
                </div>
              </div>
              <Button onClick={openCreateMaterialModal} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Material
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  Loading inventory...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                      <TableHead className="w-[300px]">Item Name</TableHead>
                      <TableHead>Stock Level</TableHead>
                      <TableHead>Min. Threshold</TableHead>
                      <TableHead>Cost/Unit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryItems.map((item) => {
                      const isLowStock = item.currentStock <= item.minimumStock;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                          <TableCell className="text-gray-900 font-medium">
                            {item.currentStock} {item.unit}
                          </TableCell>
                          <TableCell className="text-gray-500">
                            {item.minimumStock} {item.unit}
                          </TableCell>
                          <TableCell className="text-gray-500">₹{item.costPerUnit}</TableCell>
                          <TableCell>
                            {isLowStock ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Low Stock
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                In Stock
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger>
                                <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditMaterialModal(item)}>
                                  <Edit className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteMaterial(item.id)}>
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {inventoryItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                          No inventory items found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── RECIPES TAB ─── */}
        <TabsContent value="recipes">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Recipe Builder</CardTitle>
                  <CardDescription>Link raw materials to menu items for automatic deduction upon sale.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  Loading recipes...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                      <TableHead className="w-[300px]">Menu Item</TableHead>
                      <TableHead>Recipe Status</TableHead>
                      <TableHead>Ingredients Count</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {menuItems.map((item) => {
                      const recipe = recipes.find(r => r.menuItemId === item.id);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                          <TableCell>
                            {recipe ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                Configured
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                Unconfigured
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-gray-500">
                            {recipe ? `${recipe.ingredients.length} ingredients` : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => openRecipeModal(item)}>
                              {recipe ? "Edit Recipe" : "Build Recipe"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {menuItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                          No menu items found. Please create menu items first.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── AUDIT TRAIL TAB ─── */}
        <TabsContent value="audit">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Inventory Audit Trail</CardTitle>
                  <CardDescription>History of automated stock deductions and manual adjustments.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  Loading audit trail...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Quantity Change</TableHead>
                      <TableHead>Balance After</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(stockTransactions || []).map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-sm text-gray-500">
                          {new Date(tx.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-medium text-gray-900">
                          {tx.inventoryItemName}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase ${
                            tx.type === "ORDER_DEDUCTION" ? "bg-purple-100 text-purple-700" :
                            tx.type === "MANUAL_ADD" ? "bg-emerald-100 text-emerald-700" :
                            "bg-gray-100 text-gray-700"
                          }`}>
                            {tx.type.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={tx.quantityChange < 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                            {tx.quantityChange > 0 ? "+" : ""}{tx.quantityChange}
                          </span>
                        </TableCell>
                        <TableCell className="text-gray-900 font-medium">
                          {tx.balanceAfter}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {tx.notes || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!stockTransactions || stockTransactions.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                          No transactions recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── VENDORS TAB ─── */}
        <TabsContent value="vendors">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Vendors</CardTitle>
                  <CardDescription>Manage your suppliers and vendors.</CardDescription>
                </div>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Vendor
              </Button>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              Vendor management coming soon.
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── PURCHASE ORDERS TAB ─── */}
        <TabsContent value="purchase_orders">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Purchase Orders</CardTitle>
                  <CardDescription>Create and track purchase orders.</CardDescription>
                </div>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Create PO
              </Button>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              Purchase order workflow coming soon.
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── GRNS TAB ─── */}
        <TabsContent value="grns">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Goods Received Notes</CardTitle>
                  <CardDescription>Record received stock against POs.</CardDescription>
                </div>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                New GRN
              </Button>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              GRN processing coming soon.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <Dialog open={isMaterialModalOpen} onOpenChange={setIsMaterialModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={materialForm.handleSubmit(handleSaveMaterial)}>
            <DialogHeader>
              <DialogTitle>{editingMaterial ? "Edit Raw Material" : "Add Raw Material"}</DialogTitle>
              <DialogDescription>
                {editingMaterial ? "Update details for this material." : "Register a new ingredient or material in your inventory."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="name">Material Name</Label>
                  <Input id="name" placeholder="e.g. Olive Oil" {...materialForm.register("name")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit</Label>
                  <select
                    id="unit"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                    {...materialForm.register("unit")}
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="pcs">pcs</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="currentStock">Current Stock</Label>
                  <Input id="currentStock" type="number" min="0" step="0.01" {...materialForm.register("currentStock", { valueAsNumber: true })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minimumStock">Min. Alert Level</Label>
                  <Input id="minimumStock" type="number" min="0" step="0.01" {...materialForm.register("minimumStock", { valueAsNumber: true })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="costPerUnit">Cost Per Unit (₹)</Label>
                <Input id="costPerUnit" type="number" min="0" step="0.01" {...materialForm.register("costPerUnit", { valueAsNumber: true })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsMaterialModalOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmittingMaterial}>
                {isSubmittingMaterial && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingMaterial ? "Save Changes" : "Save Material"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {selectedMenuItem && (
        <RecipeManagerModal
          isOpen={isRecipeModalOpen}
          onClose={() => setIsRecipeModalOpen(false)}
          menuItemId={selectedMenuItem.id}
          menuItemName={selectedMenuItem.name}
          existingRecipe={recipes.find(r => r.menuItemId === selectedMenuItem.id)}
          onSave={loadRecipes}
        />
      )}
    </div>
  );
}
