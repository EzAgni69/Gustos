"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createOutletSchema, type CreateOutlet, type Outlet, type Franchise } from "@gusto/api-contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { Switch } from "@/components/ui/switch";
import { Store, Plus, MoreHorizontal, Loader2, Edit, Trash2, Activity, Wifi } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export default function OutletsPage() {
  const { toast } = useToast();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);
  
  const form = useForm<CreateOutlet & { isActive?: boolean }>({
    resolver: zodResolver(createOutletSchema) as any, // bypassing strict schema to allow isActive for edits
    defaultValues: {
      franchiseId: "",
      name: "",
      address: "",
      phone: "",
      gstNumber: "",
      isActive: true,
    }
  });

  const loadData = async () => {
    setLoading(true);
    setError("");

    const [outletsRes, franchisesRes] = await Promise.all([
      apiFetch<Outlet[]>("/outlets"),
      apiFetch<Franchise[]>("/franchises"),
    ]);

    if (franchisesRes.success && franchisesRes.data) {
      setFranchises(franchisesRes.data);
      if (franchisesRes.data.length > 0 && franchisesRes.data[0]) {
        form.setValue("franchiseId", franchisesRes.data[0].id);
      }
    }

    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);
    } else {
      setError(outletsRes.message || "Failed to load outlets");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingOutlet(null);
    form.reset({
      franchiseId: franchises[0]?.id || "",
      name: "",
      address: "",
      phone: "",
      gstNumber: "",
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (outlet: Outlet) => {
    setEditingOutlet(outlet);
    form.reset({
      franchiseId: outlet.franchiseId,
      name: outlet.name,
      address: outlet.address,
      phone: outlet.phone || "",
      gstNumber: outlet.gstNumber || "",
      isActive: outlet.isActive,
    });
    setIsModalOpen(true);
  };

  const handleSaveOutlet = async (data: any) => {
    setIsSubmitting(true);

    if (editingOutlet) {
      // Update
      const res = await apiFetch<Outlet>(`/outlets/${editingOutlet.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name,
          address: data.address,
          phone: data.phone || null,
          gstNumber: data.gstNumber || null,
          isActive: data.isActive,
        }),
      });

      if (res.success && res.data) {
        setOutlets(outlets.map(o => o.id === editingOutlet.id ? res.data! : o));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message || "Failed to update outlet", variant: "error" });
      }
    } else {
      // Create
      const res = await apiFetch<Outlet>("/outlets", {
        method: "POST",
        body: JSON.stringify({
          franchiseId: data.franchiseId,
          name: data.name,
          address: data.address,
          phone: data.phone || undefined,
          gstNumber: data.gstNumber || undefined,
        }),
      });

      if (res.success && res.data) {
        setOutlets([...outlets, res.data]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create outlet", variant: "error" });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteOutlet = async (id: string) => {
    if (!confirm("Are you sure you want to delete this outlet? This will cascade delete its tables, menus, and orders!")) return;
    
    const res = await apiFetch(`/outlets/${id}`, { method: "DELETE" });
    if (res.success) {
      setOutlets(outlets.filter(o => o.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete outlet", variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Outlets</h1>
          <p className="text-gray-500">Manage restaurants, branches, and point-of-sale locations.</p>
        </div>
        
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Outlet
          </Button>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={form.handleSubmit(handleSaveOutlet)}>
              <DialogHeader>
                <DialogTitle>{editingOutlet ? "Edit Outlet" : "Add New Outlet"}</DialogTitle>
                <DialogDescription>
                  {editingOutlet ? "Update the details for this outlet." : "Create a new point-of-sale location for your restaurant."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {!editingOutlet && (
                  <div className="space-y-2">
                    <Label htmlFor="franchise">Franchise / Brand</Label>
                    <select
                      id="franchise"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      {...form.register("franchiseId")}
                    >
                      <option value="" disabled>Select a franchise...</option>
                      {franchises.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    {form.formState.errors.franchiseId && (
                      <p className="text-red-500 text-xs font-medium">{form.formState.errors.franchiseId.message}</p>
                    )}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="name">Outlet Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Downtown Express"
                    {...form.register("name")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-red-500 text-xs font-medium">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Full Address</Label>
                  <Input
                    id="address"
                    placeholder="123 Main St..."
                    {...form.register("address")}
                  />
                  {form.formState.errors.address && (
                    <p className="text-red-500 text-xs font-medium">{form.formState.errors.address.message}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      placeholder="+91..."
                      {...form.register("phone")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gstNumber">GST Number</Label>
                    <Input
                      id="gstNumber"
                      placeholder="Optional"
                      {...form.register("gstNumber")}
                    />
                  </div>
                </div>

                {editingOutlet && (
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch
                      id="isActive"
                      checked={form.watch("isActive")}
                      onCheckedChange={(checked) => form.setValue("isActive", checked)}
                    />
                    <Label htmlFor="isActive" className="font-normal cursor-pointer">
                      Outlet is active
                    </Label>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingOutlet ? "Save Changes" : "Save Outlet"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="outlets" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="outlets" className="gap-2">
            <Store className="w-4 h-4" />
            Outlets
          </TabsTrigger>
          <TabsTrigger value="sync_monitor" className="gap-2">
            <Activity className="w-4 h-4" />
            Edge Sync Monitor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outlets">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">All Outlets</CardTitle>
                  <CardDescription>A complete list of registered outlets.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  Loading outlets...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                      <TableHead className="w-[250px]">Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outlets.map((outlet) => (
                      <TableRow key={outlet.id}>
                        <TableCell className="font-medium text-gray-900">{outlet.name}</TableCell>
                        <TableCell className="text-gray-500">{outlet.address}</TableCell>
                        <TableCell className="text-gray-500">{outlet.phone || "—"}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              outlet.isActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {outlet.isActive ? "Active" : "Inactive"}
                          </span>
                        </TableCell>
                        <TableCell className="text-gray-500">
                          {new Date(outlet.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditModal(outlet)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteOutlet(outlet.id)}>
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync_monitor">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Wifi className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Edge Sync Monitor</CardTitle>
                  <CardDescription>Real-time monitor of local POS servers syncing to cloud.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              Dashboard for sync latency and online/offline heartbeats coming soon.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
