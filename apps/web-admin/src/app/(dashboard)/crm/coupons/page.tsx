"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { type Coupon, type CreateCoupon, createCouponSchema } from "@gusto/api-contracts";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tag, Plus, Loader2, MoreHorizontal, Edit, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";

export default function CouponsPage() {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  const form = useForm<CreateCoupon>({
    resolver: zodResolver(createCouponSchema) as any,
    defaultValues: {
      code: "",
      description: "",
      type: "PERCENTAGE",
      value: undefined as unknown as number,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 86400000),
      isActive: true,
    },
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    const res = await apiFetch<Coupon[]>("/crm/coupons?limit=50");
    if (res.success && res.data) {
      setCoupons(res.data);
    } else {
      setError(res.message || "Failed to load coupons.");
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const openCreateModal = () => {
    setEditingCoupon(null);
    form.reset({
      code: "",
      description: "",
      type: "PERCENTAGE",
      value: undefined as unknown as number,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 86400000),
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setIsModalOpen(true);
  };

  const handleSaveCoupon = async (data: any) => {
    setIsSubmitting(true);
    if (editingCoupon) {
      const res = await apiFetch<Coupon>(`/crm/coupons/${editingCoupon.id}`, {
        method: "PUT",
        body: JSON.stringify({ description: data.description, value: data.value, validFrom: data.validFrom, validUntil: data.validUntil, isActive: data.isActive }),
      });
      if (res.success && res.data) {
        setCoupons(coupons.map(c => c.id === editingCoupon.id ? res.data! : c));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message, variant: "error" });
      }
    } else {
      const res = await apiFetch<Coupon>("/crm/coupons", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (res.success && res.data) {
        setCoupons([res.data, ...coupons]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message, variant: "error" });
      }
    }
    setIsSubmitting(false);
  };

  const handleDeleteCoupon = async (id: string) => {
    if (!confirm("Delete this coupon?")) return;
    const res = await apiFetch(`/crm/coupons/${id}`, { method: "DELETE" });
    if (res.success) {
      setCoupons(coupons.filter(c => c.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message, variant: "error" });
    }
  };

  const isExpired = (coupon: Coupon) => new Date(coupon.validUntil) < new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">CRM — Coupons</h1>
          <p className="text-gray-500">Create and manage discount coupons.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/crm">
            <Button variant="outline" className="bg-white">Feedback</Button>
          </Link>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />Create Coupon
            </Button>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={form.handleSubmit(handleSaveCoupon)}>
                <DialogHeader>
                  <DialogTitle>{editingCoupon ? "Edit Coupon" : "Create Coupon"}</DialogTitle>
                  <DialogDescription>{editingCoupon ? "Update coupon details." : "Create a new discount coupon."}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  {!editingCoupon && (
                    <>
                      <div className="space-y-2">
                        <Label>Coupon Code</Label>
                        <Input placeholder="e.g. SAVE20" {...form.register("code")} />
                        {form.formState.errors.code && <p className="text-red-500 text-xs">{(form.formState.errors.code as any).message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register("type")}>
                          <option value="PERCENTAGE">Percentage (%)</option>
                          <option value="FLAT">Flat Amount (₹)</option>
                        </select>
                      </div>
                    </>
                  )}
                  <div className="space-y-2">
                    <Label>Value</Label>
                    <Input type="number" min={0} step="0.01" {...form.register("value", { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Input {...form.register("description")} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Valid From</Label>
                      <Input type="date" {...form.register("validFrom", { valueAsDate: true })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Valid Until</Label>
                      <Input type="date" {...form.register("validUntil", { valueAsDate: true })} />
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch checked={form.watch("isActive")} onCheckedChange={v => form.setValue("isActive", v)} />
                    <Label className="font-normal">Active</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingCoupon ? "Save Changes" : "Create Coupon"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span><span>{error}</span>
        </div>
      )}

      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Coupon List</CardTitle>
              <CardDescription>All active and expired coupons.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading coupons...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Valid Until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map(coupon => (
                  <TableRow key={coupon.id}>
                    <TableCell className="font-mono font-semibold text-gray-900">{coupon.code}</TableCell>
                    <TableCell className="text-gray-500">{coupon.type}</TableCell>
                    <TableCell className="font-medium">
                      {coupon.type === "PERCENTAGE" ? `${coupon.value}%` : `₹${coupon.value}`}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {coupon.usedCount}/{coupon.usageLimit ?? "∞"}
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {new Date(coupon.validUntil).toLocaleDateString("en-IN")}
                    </TableCell>
                    <TableCell>
                      {isExpired(coupon) ? (
                        <Badge variant="muted" className="text-[10px]">Expired</Badge>
                      ) : coupon.isActive ? (
                        <Badge variant="success" className="text-[10px] bg-emerald-100 text-emerald-700">Active</Badge>
                      ) : (
                        <Badge variant="muted" className="text-[10px]">Inactive</Badge>
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
                          <DropdownMenuItem onClick={() => openEditModal(coupon)}>
                            <Edit className="w-4 h-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteCoupon(coupon.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {coupons.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-500 py-8">No coupons created yet.</TableCell>
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
