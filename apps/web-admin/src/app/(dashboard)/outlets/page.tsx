"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createOutletSchema,
  type CreateOutlet,
  type Outlet,
  type Franchise,
} from "@gusto/api-contracts";
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
import {
  Store,
  Plus,
  MoreHorizontal,
  Loader2,
  Edit,
  Trash2,
  Activity,
  Wifi,
  Building2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export default function OutletsPage() {
  const { toast } = useToast();

  // ─── Data State ───
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ─── Outlet Modal State ───
  const [isOutletModalOpen, setIsOutletModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);
  // When adding outlet from a franchise card, pre-fill the franchiseId
  const [prefilledFranchiseId, setPrefilledFranchiseId] = useState<string>("");

  // ─── Franchise Edit/Delete State (dialogs implemented in task 2.2 / 2.3) ───
  const [editingFranchise, setEditingFranchise] = useState<Franchise | null>(null);
  const [isFranchiseModalOpen, setIsFranchiseModalOpen] = useState(false);

  const outletForm = useForm<CreateOutlet & { isActive?: boolean }>({
    resolver: zodResolver(createOutletSchema) as any,
    defaultValues: {
      franchiseId: "",
      name: "",
      address: "",
      phone: "",
      gstNumber: "",
      isActive: true,
    },
  });

  // ─── Load Data ───
  const loadData = async () => {
    setLoading(true);
    setError("");

    const [franchisesRes, outletsRes] = await Promise.all([
      apiFetch<Franchise[]>("/franchises"),
      apiFetch<Outlet[]>("/outlets"),
    ]);

    if (franchisesRes.success && franchisesRes.data) {
      setFranchises(franchisesRes.data);
    } else {
      setError(franchisesRes.message || "Failed to load franchises");
    }

    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);
    } else if (!franchisesRes.success) {
      // already set error above
    } else {
      setError(outletsRes.message || "Failed to load outlets");
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // ─── Group outlets by franchiseId ───
  const franchiseIdSet = new Set(franchises.map((f) => f.id));

  const outletsByFranchise = outlets.reduce<Map<string, Outlet[]>>((map, outlet) => {
    // Only group outlets that belong to a known franchise
    if (franchiseIdSet.has(outlet.franchiseId)) {
      const list = map.get(outlet.franchiseId) ?? [];
      list.push(outlet);
      map.set(outlet.franchiseId, list);
    }
    return map;
  }, new Map());

  // Outlets whose franchiseId doesn't match any loaded franchise → "Unassigned"
  const unassignedOutlets = outlets.filter(
    (o) => !franchiseIdSet.has(o.franchiseId)
  );

  // ─── Outlet Modal Handlers ───
  const openCreateOutletModal = (franchiseId?: string) => {
    setEditingOutlet(null);
    const fid = franchiseId ?? franchises[0]?.id ?? "";
    setPrefilledFranchiseId(franchiseId ?? "");
    outletForm.reset({
      franchiseId: fid,
      name: "",
      address: "",
      phone: "",
      gstNumber: "",
      isActive: true,
    });
    setIsOutletModalOpen(true);
  };

  const openEditOutletModal = (outlet: Outlet) => {
    setEditingOutlet(outlet);
    setPrefilledFranchiseId("");
    outletForm.reset({
      franchiseId: outlet.franchiseId,
      name: outlet.name,
      address: outlet.address,
      phone: outlet.phone || "",
      gstNumber: outlet.gstNumber || "",
      isActive: outlet.isActive,
    });
    setIsOutletModalOpen(true);
  };

  const handleSaveOutlet = async (data: any) => {
    setIsSubmitting(true);

    if (editingOutlet) {
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
        setOutlets((prev) =>
          prev.map((o) => (o.id === editingOutlet.id ? res.data! : o))
        );
        setIsOutletModalOpen(false);
      } else {
        toast({
          title: "Update failed",
          description: res.message || "Failed to update outlet",
          variant: "error",
        });
      }
    } else {
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
        setOutlets((prev) => [...prev, res.data!]);
        setIsOutletModalOpen(false);
      } else {
        toast({
          title: "Creation failed",
          description: res.message || "Failed to create outlet",
          variant: "error",
        });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteOutlet = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this outlet? This will cascade delete its tables, menus, and orders!"
      )
    )
      return;

    const res = await apiFetch(`/outlets/${id}`, { method: "DELETE" });
    if (res.success) {
      setOutlets((prev) => prev.filter((o) => o.id !== id));
    } else {
      toast({
        title: "Delete failed",
        description: res.message || "Failed to delete outlet",
        variant: "error",
      });
    }
  };

  // ─── Franchise Edit / Delete Handlers ───
  // Full dialog UI is implemented in task 2.2 (edit) and task 2.3 (delete).
  // These stubs open the modal shell so the card actions are functional.
  const openEditFranchiseModal = (franchise: Franchise) => {
    setEditingFranchise(franchise);
    setIsFranchiseModalOpen(true);
  };

  const handleDeleteFranchise = (franchise: Franchise) => {
    // Full cascade-delete dialog (task 2.3); provisional confirm for now
    if (
      !confirm(
        `Delete franchise "${franchise.name}"? This will also delete all its outlets, tables, menus, and orders.`
      )
    )
      return;

    apiFetch(`/franchises/${franchise.id}`, { method: "DELETE" }).then((res) => {
      if (res.success) {
        setFranchises((prev) => prev.filter((f) => f.id !== franchise.id));
        // Also remove orphaned outlets from local state
        setOutlets((prev) =>
          prev.filter((o) => o.franchiseId !== franchise.id)
        );
      } else {
        toast({
          title: "Delete failed",
          description: res.message || "Failed to delete franchise",
          variant: "error",
        });
      }
    });
  };

  // ─── Shared outlet rows renderer ───
  const renderOutletTable = (outletList: Outlet[]) => (
    <Table>
      <TableHeader>
        <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
          <TableHead className="w-[220px]">Name</TableHead>
          <TableHead>Address</TableHead>
          <TableHead className="w-[100px]">Status</TableHead>
          <TableHead className="w-[180px]">Last Sync</TableHead>
          <TableHead className="text-right w-[80px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {outletList.map((outlet) => (
          <TableRow key={outlet.id}>
            <TableCell className="font-medium text-gray-900">
              {outlet.name}
            </TableCell>
            <TableCell className="text-gray-500 text-sm">
              {outlet.address}
            </TableCell>
            <TableCell>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  outlet.isActive
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {outlet.isActive ? "Active" : "Inactive"}
              </span>
            </TableCell>
            <TableCell className="text-gray-400 text-sm">
              {/* Most recent sync timestamp — shown when available */}
              —
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditOutletModal(outlet)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => handleDeleteOutlet(outlet.id)}
                  >
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
  );

  return (
    <div className="space-y-6">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Outlets
          </h1>
          <p className="text-gray-500">
            Manage restaurant brands, franchises, and their outlet locations.
          </p>
        </div>

        <Button
          onClick={() => openCreateOutletModal()}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Outlet
        </Button>
      </div>

      {/* ─── Tabs ─── */}
      <Tabs defaultValue="outlets" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="outlets" className="gap-2">
            <Store className="w-4 h-4" />
            Franchises &amp; Outlets
          </TabsTrigger>
          <TabsTrigger value="sync_monitor" className="gap-2">
            <Activity className="w-4 h-4" />
            Edge Sync Monitor
          </TabsTrigger>
        </TabsList>

        {/* ─── Franchises & Outlets Tab ─── */}
        <TabsContent value="outlets">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadData}
                className="ml-auto text-red-700 hover:text-red-900"
              >
                Retry
              </Button>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Loading franchises and outlets...
            </div>
          ) : franchises.length === 0 ? (
            <Card className="shadow-xs border-gray-100">
              <CardContent className="p-12 text-center">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 font-medium">No franchises configured yet.</p>
                <p className="text-gray-400 text-sm mt-1">
                  Create a franchise first, then add outlets beneath it.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* ─── One card per franchise ─── */}
              {franchises.map((franchise) => {
                const franchiseOutlets = outletsByFranchise.get(franchise.id) ?? [];

                return (
                  <Card key={franchise.id} className="shadow-xs border-gray-100">
                    {/* ─── Franchise Card Header ─── */}
                    <CardHeader className="bg-gray-50/50 border-b border-gray-100">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <Building2 className="w-5 h-5 text-blue-600 shrink-0" />
                          <div>
                            <CardTitle className="text-base">{franchise.name}</CardTitle>
                            <CardDescription>
                              {franchiseOutlets.length === 0
                                ? "No outlets"
                                : `${franchiseOutlets.length} outlet${franchiseOutlets.length === 1 ? "" : "s"}`}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openCreateOutletModal(franchise.id)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1.5" />
                            New Outlet
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-gray-400 hover:text-gray-600"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openEditFranchiseModal(franchise)}
                              >
                                <Edit className="w-4 h-4 mr-2" />
                                Edit Franchise
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => handleDeleteFranchise(franchise)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete Franchise
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardHeader>

                    {/* ─── Outlet Rows ─── */}
                    <CardContent className="p-0 overflow-x-auto">
                      {franchiseOutlets.length === 0 ? (
                        <div className="p-8 text-center">
                          <Store className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500 text-sm font-medium">
                            No outlets in this franchise yet.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => openCreateOutletModal(franchise.id)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1.5" />
                            Add Outlet
                          </Button>
                        </div>
                      ) : (
                        renderOutletTable(franchiseOutlets)
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* ─── Unassigned Outlets Section ─── */}
              {unassignedOutlets.length > 0 && (
                <Card className="shadow-xs border-amber-100">
                  <CardHeader className="bg-amber-50/50 border-b border-amber-100">
                    <div className="flex items-center gap-3">
                      <Store className="w-5 h-5 text-amber-500 shrink-0" />
                      <div>
                        <CardTitle className="text-base text-amber-800">
                          Unassigned
                        </CardTitle>
                        <CardDescription className="text-amber-600">
                          {unassignedOutlets.length} outlet
                          {unassignedOutlets.length === 1 ? "" : "s"} not linked to a franchise
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    {renderOutletTable(unassignedOutlets)}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ─── Edge Sync Monitor Tab ─── */}
        <TabsContent value="sync_monitor">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Wifi className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Edge Sync Monitor</CardTitle>
                  <CardDescription>
                    Real-time monitor of local POS servers syncing to cloud.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              Dashboard for sync latency and online/offline heartbeats coming soon.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Outlet Create / Edit Dialog ─── */}
      <Dialog open={isOutletModalOpen} onOpenChange={setIsOutletModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={outletForm.handleSubmit(handleSaveOutlet)}>
            <DialogHeader>
              <DialogTitle>
                {editingOutlet ? "Edit Outlet" : "Add New Outlet"}
              </DialogTitle>
              <DialogDescription>
                {editingOutlet
                  ? "Update the details for this outlet."
                  : "Create a new point-of-sale location for your restaurant."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Franchise selector — shown when creating and not pre-filled from a card */}
              {!editingOutlet && (
                <div className="space-y-2">
                  <Label htmlFor="franchise">Franchise / Brand</Label>
                  <select
                    id="franchise"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!!prefilledFranchiseId}
                    {...outletForm.register("franchiseId")}
                  >
                    <option value="" disabled>
                      Select a franchise...
                    </option>
                    {franchises.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  {outletForm.formState.errors.franchiseId && (
                    <p className="text-red-500 text-xs font-medium">
                      {outletForm.formState.errors.franchiseId.message}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Outlet Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Downtown Express"
                  {...outletForm.register("name")}
                />
                {outletForm.formState.errors.name && (
                  <p className="text-red-500 text-xs font-medium">
                    {outletForm.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Full Address</Label>
                <Input
                  id="address"
                  placeholder="123 Main St..."
                  {...outletForm.register("address")}
                />
                {outletForm.formState.errors.address && (
                  <p className="text-red-500 text-xs font-medium">
                    {outletForm.formState.errors.address.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    placeholder="+91..."
                    {...outletForm.register("phone")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gstNumber">GST Number</Label>
                  <Input
                    id="gstNumber"
                    placeholder="Optional"
                    {...outletForm.register("gstNumber")}
                  />
                </div>
              </div>

              {editingOutlet && (
                <div className="flex items-center space-x-2 pt-2">
                  <Switch
                    id="isActive"
                    checked={outletForm.watch("isActive")}
                    onCheckedChange={(checked) =>
                      outletForm.setValue("isActive", checked)
                    }
                  />
                  <Label htmlFor="isActive" className="font-normal cursor-pointer">
                    Outlet is active
                  </Label>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOutletModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={isSubmitting}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingOutlet ? "Save Changes" : "Save Outlet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Franchise Edit Dialog shell (full implementation in task 2.2) ─── */}
      <Dialog open={isFranchiseModalOpen} onOpenChange={setIsFranchiseModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Franchise</DialogTitle>
            <DialogDescription>
              Update the details for{" "}
              <span className="font-medium">{editingFranchise?.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-sm text-gray-500 text-center">
            Franchise edit form coming in the next task.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsFranchiseModalOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
