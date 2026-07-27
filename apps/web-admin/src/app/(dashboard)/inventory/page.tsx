"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Package, Plus, MoreHorizontal, AlertTriangle, Loader2, Edit, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { InventoryItem, createInventoryItemSchema, CreateInventoryItem } from "@gusto/api-contracts";

export default function InventoryPage() {
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const form = useForm<any>({
    resolver: zodResolver(createInventoryItemSchema),
    defaultValues: {
      name: "",
      unit: "kg",
      currentStock: 0,
      minimumStock: 0,
      costPerUnit: 0,
    }
  });

  const loadInventory = async () => {
    setLoading(true);
    const res = await apiFetch<InventoryItem[]>("/inventory");
    if (res.success && res.data) {
      setInventoryItems(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadInventory();
  }, []);

  const openCreateModal = () => {
    setEditingItem(null);
    form.reset({
      name: "",
      unit: "kg",
      currentStock: 0,
      minimumStock: 0,
      costPerUnit: 0,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    form.reset({
      name: item.name,
      unit: item.unit,
      currentStock: item.currentStock,
      minimumStock: item.minimumStock,
      costPerUnit: item.costPerUnit,
    });
    setIsModalOpen(true);
  };

  const handleSaveMaterial = async (data: any) => {
    setIsSubmitting(true);

    if (editingItem) {
      const res = await apiFetch<InventoryItem>(`/inventory/${editingItem.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });

      if (res.success && res.data) {
        setInventoryItems(inventoryItems.map(item => item.id === editingItem.id ? res.data! : item));
        setIsModalOpen(false);
      } else {
        alert(res.message || "Failed to update item");
      }
    } else {
      const res = await apiFetch<InventoryItem>("/inventory", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (res.success && res.data) {
        setInventoryItems([...inventoryItems, res.data]);
        setIsModalOpen(false);
      } else {
        alert(res.message || "Failed to create item");
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!confirm("Are you sure you want to delete this material?")) return;
    
    const res = await apiFetch(`/inventory/${id}`, { method: "DELETE" });
    if (res.success) {
      setInventoryItems(inventoryItems.filter(item => item.id !== id));
    } else {
      alert(res.message || "Failed to delete item");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Inventory & Recipes</h1>
          <p className="text-gray-500">Track raw materials, stock levels, and recipe deductions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="bg-white">Manage Recipes</Button>
          
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Material
            </Button>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={form.handleSubmit(handleSaveMaterial)}>
                <DialogHeader>
                  <DialogTitle>{editingItem ? "Edit Raw Material" : "Add Raw Material"}</DialogTitle>
                  <DialogDescription>
                    {editingItem ? "Update details for this material." : "Register a new ingredient or material in your inventory."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="name">Material Name</Label>
                      <Input
                        id="name"
                        placeholder="e.g. Olive Oil"
                        {...form.register("name")}
                      />
                      {form.formState.errors.name && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.name.message as string}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="unit">Unit</Label>
                      <select
                        id="unit"
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                        {...form.register("unit")}
                      >
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                        <option value="L">L</option>
                        <option value="ml">ml</option>
                        <option value="pcs">pcs</option>
                      </select>
                      {form.formState.errors.unit && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.unit.message as string}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="currentStock">Current Stock</Label>
                      <Input
                        id="currentStock"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        {...form.register("currentStock", { valueAsNumber: true })}
                      />
                      {form.formState.errors.currentStock && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.currentStock.message as string}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minimumStock">Min. Alert Level</Label>
                      <Input
                        id="minimumStock"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        {...form.register("minimumStock", { valueAsNumber: true })}
                      />
                      {form.formState.errors.minimumStock && (
                        <p className="text-red-500 text-xs font-medium">{form.formState.errors.minimumStock.message as string}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="costPerUnit">Cost Per Unit (₹)</Label>
                    <Input
                      id="costPerUnit"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 150"
                      {...form.register("costPerUnit", { valueAsNumber: true })}
                    />
                    {form.formState.errors.costPerUnit && (
                      <p className="text-red-500 text-xs font-medium">{form.formState.errors.costPerUnit.message as string}</p>
                    )}
                  </div>
                </div>
                
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingItem ? "Save Changes" : "Save Material"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Raw Materials</CardTitle>
              <CardDescription>Current stock levels across your organization.</CardDescription>
            </div>
          </div>
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
                            <DropdownMenuItem onClick={() => openEditModal(item)}>
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
    </div>
  );
}
