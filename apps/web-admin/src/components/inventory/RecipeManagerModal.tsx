"use client";

import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/lib/toast";
import { InventoryItem, Recipe, createRecipeSchema } from "@gusto/api-contracts";

interface RecipeManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuItemId: string;
  menuItemName: string;
  existingRecipe?: Recipe | null;
  onSave: () => void;
}

export function RecipeManagerModal({
  isOpen,
  onClose,
  menuItemId,
  menuItemName,
  existingRecipe,
  onSave,
}: RecipeManagerModalProps) {
  const { toast } = useToast();
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

interface RecipeFormValues {
  menuItemId: string;
  ingredients: {
    inventoryItemId: string;
    quantity: number;
    unit: string;
  }[];
}

  const form = useForm<RecipeFormValues>({
    resolver: zodResolver(createRecipeSchema),
    defaultValues: {
      menuItemId: menuItemId,
      ingredients: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  useEffect(() => {
    if (isOpen) {
      loadInventoryItems();
      if (existingRecipe) {
        form.reset({
          menuItemId: existingRecipe.menuItemId,
          ingredients: existingRecipe.ingredients.map(i => ({
            inventoryItemId: i.inventoryItemId,
            quantity: i.quantity,
            unit: i.unit,
          }))
        });
      } else {
        form.reset({
          menuItemId,
          ingredients: [],
        });
      }
    }
  }, [isOpen, existingRecipe, menuItemId]);

  const loadInventoryItems = async () => {
    setIsLoadingItems(true);
    const res = await apiFetch<InventoryItem[]>("/inventory");
    if (res.success && res.data) {
      setInventoryItems(res.data);
    }
    setIsLoadingItems(false);
  };

  const handleSave = async (data: RecipeFormValues) => {
    setIsSubmitting(true);
    const res = await apiFetch("/recipes", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (res.success) {
      toast({ title: "Recipe saved", description: "The recipe was successfully saved." });
      onSave();
      onClose();
    } else {
      toast({ title: "Failed to save", description: res.message, variant: "error" });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recipe for {menuItemName}</DialogTitle>
          <DialogDescription>
            Map raw ingredients to this menu item. Whenever an order containing this item is completed, the sync worker will deduct these exact quantities from your stock.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSave)} className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Ingredients List</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ inventoryItemId: "", quantity: 1, unit: "kg" })}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Ingredient
              </Button>
            </div>

            {fields.length === 0 && (
              <div className="text-center p-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <p className="text-sm text-gray-500 mb-2">No ingredients added yet.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ inventoryItemId: "", quantity: 1, unit: "kg" })}
                >
                  Start Building Recipe
                </Button>
              </div>
            )}

            {fields.map((field, index) => (
              <div key={field.id} className="flex gap-3 items-start bg-gray-50 p-3 rounded-md border border-gray-100">
                <div className="flex-1 space-y-2">
                  <Label>Ingredient</Label>
                  <select
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                    {...form.register(`ingredients.${index}.inventoryItemId`)}
                  >
                    <option value="" disabled>Select material...</option>
                    {inventoryItems.map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  {form.formState.errors.ingredients && (form.formState.errors.ingredients as any)[index]?.inventoryItemId && (
                    <p className="text-red-500 text-xs">{(form.formState.errors.ingredients as any)[index]?.inventoryItemId?.message}</p>
                  )}
                </div>
                
                <div className="w-24 space-y-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0.001"
                    {...form.register(`ingredients.${index}.quantity` as const, { valueAsNumber: true })}
                  />
                </div>

                <div className="w-24 space-y-2">
                  <Label>Unit</Label>
                  <select
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                    {...form.register(`ingredients.${index}.unit` as const)}
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="pcs">pcs</option>
                  </select>
                </div>

                <div className="pt-8">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            
            {(form.formState.errors.ingredients as any)?.root && (
              <p className="text-red-500 text-sm font-medium">{(form.formState.errors.ingredients as any).root.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isLoadingItems}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Recipe
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
