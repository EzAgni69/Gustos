"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createDiningTableSchema,
  type CreateDiningTable,
  type DiningTable,
  type Outlet,
  type TableStatus,
} from "@gusto/api-contracts";
import { getPersistedOutletId, setPersistedOutletId } from "@/lib/outlet-context";
import { OutletSwitcher } from "@/components/shared/OutletSwitcher";
import { EmptyState } from "@/components/shared/EmptyState";
import { LayoutGrid as TableIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import {
  LayoutGrid,
  Plus,
  Users,
  Loader2,
  Armchair,
  MoreVertical,
  Edit,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";

// ─── Status Config ───

const TABLE_STATUS_CONFIG: Record<
  TableStatus,
  { label: string; variant: "success" | "destructive" | "warning" | "muted"; bg: string; ring: string }
> = {
  AVAILABLE: {
    label: "Available",
    variant: "success",
    bg: "bg-emerald-50 hover:bg-emerald-100/70",
    ring: "ring-emerald-200",
  },
  OCCUPIED: {
    label: "Occupied",
    variant: "destructive",
    bg: "bg-red-50 hover:bg-red-100/70",
    ring: "ring-red-200",
  },
  RESERVED: {
    label: "Reserved",
    variant: "warning",
    bg: "bg-amber-50 hover:bg-amber-100/70",
    ring: "ring-amber-200",
  },
  CLEANING: {
    label: "Cleaning",
    variant: "muted",
    bg: "bg-gray-50 hover:bg-gray-100/70",
    ring: "ring-gray-200",
  },
};

// ─── Component ───

export default function TablesPage() {
  const { toast } = useToast();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [switcherLoading, setSwitcherLoading] = useState(false);
  const [error, setError] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTable, setEditingTable] = useState<DiningTable | null>(null);

  const form = useForm<any>({
    resolver: zodResolver(createDiningTableSchema),
    defaultValues: {
      outletId: "",
      name: "",
      capacity: undefined as unknown as number,
      section: "",
      sortOrder: 0,
    },
  });

  const loadData = async () => {
    setLoading(true);
    setError("");

    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    let initialOutletId = "";

    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);

      // Use persisted outlet ID if available and valid, otherwise fall back to Andheri West (or first outlet)
      const persistedId = getPersistedOutletId();
      const persistedOutlet = persistedId
        ? outletsRes.data.find((o) => o.id === persistedId)
        : null;

      if (persistedOutlet) {
        initialOutletId = persistedOutlet.id;
      } else {
        const defaultOutlet = outletsRes.data.find((o) => o.id === "00000000-0000-0000-0000-000000000003") || outletsRes.data[0];
        initialOutletId = defaultOutlet?.id || "";
      }

      setCurrentOutletId(initialOutletId);
      setPersistedOutletId(initialOutletId);
      form.setValue("outletId", initialOutletId);

      const tablesRes = await apiFetch<DiningTable[]>(
        `/tables?outletId=${initialOutletId}`
      );
      if (tablesRes.success && tablesRes.data) {
        setTables(tablesRes.data);
      } else {
        setError(tablesRes.message || "Failed to load tables.");
        setTables([]);
      }
    } else {
      setError(outletsRes.message || "Failed to load outlets. Cannot display floor plan.");
      setTables([]);
    }

    setLoading(false);
  };

  const handleOutletChange = async (newOutletId: string) => {
    setCurrentOutletId(newOutletId);
    setPersistedOutletId(newOutletId);
    form.setValue("outletId", newOutletId);

    // Clear previous tables before fetching new outlet data
    setTables([]);
    setSwitcherLoading(true);
    setError("");

    // Enforce 5-second timeout per requirement 2.5
    const timeoutId = setTimeout(() => {
      setSwitcherLoading(false);
      setError("Data could not be loaded in time. Please try again.");
    }, 5_000);

    try {
      const tablesRes = await apiFetch<DiningTable[]>(
        `/tables?outletId=${newOutletId}`
      );

      clearTimeout(timeoutId);

      if (tablesRes.success && tablesRes.data) {
        setTables(tablesRes.data);
      } else {
        setError(tablesRes.message || "Failed to load tables for the selected outlet.");
      }
    } catch {
      clearTimeout(timeoutId);
      setError("Failed to load tables for the selected outlet. Please try again.");
    } finally {
      setSwitcherLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Live sync polling: auto-refresh table statuses every 5 seconds
    const interval = setInterval(() => {
      const activeId = getPersistedOutletId() || currentOutletId;
      if (activeId) {
        apiFetch<DiningTable[]>(`/tables?outletId=${activeId}`).then((res) => {
          if (res.success && res.data) {
            setTables(res.data);
          }
        }).catch(() => {});
      }
    }, 5_000);

    return () => clearInterval(interval);
  }, []);

  const openCreateTableModal = () => {
    setEditingTable(null);
    form.reset({
      outletId: currentOutletId,
      name: "",
      capacity: undefined as unknown as number,
      section: "",
      sortOrder: 0,
    });
    setIsModalOpen(true);
  };

  const openEditTableModal = (table: DiningTable) => {
    setEditingTable(table);
    form.reset({
      outletId: table.outletId,
      name: table.name,
      capacity: table.capacity,
      section: table.section || "",
      sortOrder: table.sortOrder,
    });
    setIsModalOpen(true);
  };

  const handleSaveTable = async (data: any) => {
    setIsSubmitting(true);

    if (editingTable) {
      // Update
      const res = await apiFetch<DiningTable>(`/tables/${editingTable.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name,
          capacity: data.capacity,
          section: data.section || undefined,
          sortOrder: data.sortOrder,
        }),
      });

      if (res.success && res.data) {
        setTables(tables.map(t => t.id === editingTable.id ? res.data! : t));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message || "Failed to update table", variant: "error" });
      }
    } else {
      // Create
      const res = await apiFetch<DiningTable>("/tables", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          section: data.section || undefined,
        }),
      });

      if (res.success && res.data) {
        setTables([...tables, res.data]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create table", variant: "error" });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteTable = async (id: string) => {
    if (!confirm("Are you sure you want to delete this table?")) return;
    
    const res = await apiFetch(`/tables/${id}`, { method: "DELETE" });
    if (res.success) {
      setTables(tables.filter(t => t.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete table", variant: "error" });
    }
  };

  // Group tables by section
  const sections = new Map<string, DiningTable[]>();
  for (const table of tables) {
    const sectionName = table.section || "Unsectioned";
    if (!sections.has(sectionName)) {
      sections.set(sectionName, []);
    }
    sections.get(sectionName)!.push(table);
  }

  // Status counts
  const statusCounts: Record<TableStatus, number> = {
    AVAILABLE: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    CLEANING: 0,
  };
  for (const t of tables) {
    statusCounts[t.status]++;
  }

  return (
    <div className="space-y-6">
      {/* Outlet Switcher — visible at top of page, above all controls */}
      {outlets.length > 0 && (
        <OutletSwitcher
          outlets={outlets}
          currentOutletId={currentOutletId}
          onOutletChange={handleOutletChange}
          isLoading={switcherLoading}
          className="sm:w-auto w-full"
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Tables & Floor Plan
          </h1>
          <p className="text-gray-500">
            Manage dining tables, sections, and seating availability.
          </p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <Button onClick={openCreateTableModal} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Table
          </Button>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={form.handleSubmit(handleSaveTable)}>
              <DialogHeader>
                <DialogTitle>{editingTable ? "Edit Dining Table" : "Add Dining Table"}</DialogTitle>
                <DialogDescription>
                  {editingTable ? "Update details for this dining table." : "Register a new table for floor management and POS assignment."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {!editingTable && (
                  <div className="space-y-2">
                    <Label htmlFor="outlet">Outlet</Label>
                    <select
                      id="outlet"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...form.register("outletId")}
                    >
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    {form.formState.errors.outletId && (
                      <p className="text-red-500 text-xs font-medium">
                        {form.formState.errors.outletId?.message as string}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Table Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g. T1, VIP-1"
                      {...form.register("name")}
                    />
                    {form.formState.errors.name && (
                      <p className="text-red-500 text-xs font-medium">
                        {form.formState.errors.name?.message as string}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="capacity">Capacity</Label>
                    <Input
                      id="capacity"
                      type="number"
                      min="1"
                      placeholder="4"
                      {...form.register("capacity", {
                        valueAsNumber: true,
                      })}
                    />
                    {form.formState.errors.capacity && (
                      <p className="text-red-500 text-xs font-medium">
                        {form.formState.errors.capacity?.message as string}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="section">
                    Section{" "}
                    <span className="text-gray-400 font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="section"
                    placeholder="e.g. Main Hall, Terrace"
                    {...form.register("section")}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
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
                  {editingTable ? "Save Changes" : "Save Table"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Status Legend */}
      <div className="flex flex-wrap items-center gap-3">        {(Object.keys(TABLE_STATUS_CONFIG) as TableStatus[]).map((status) => (
          <div
            key={status}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-100 shadow-xs"
          >
            <Badge variant={TABLE_STATUS_CONFIG[status].variant} className="text-[11px] px-2 py-0">
              {TABLE_STATUS_CONFIG[status].label}
            </Badge>
            <span className="text-sm font-semibold text-gray-700">
              {statusCounts[status]}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-100 shadow-xs">
          <span className="text-sm text-gray-500">Total:</span>
          <span className="text-sm font-bold text-gray-900">{tables.length}</span>
        </div>
      </div>

      {/* Tables Grid by Section */}
      {loading ? (
        <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="font-medium">Loading floor plan...</p>
        </div>
      ) : tables.length === 0 && !error ? (
        <EmptyState
          icon={TableIcon}
          title="No tables for this outlet"
          description="Add your first dining table to start managing your floor plan."
          action={{ label: "+ Add Table", onClick: openCreateTableModal }}
        />
      ) : (
        Array.from(sections.entries()).map(([sectionName, sectionTables]) => (
          <Card key={sectionName} className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 py-4">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-blue-600" />
                <CardTitle className="text-base">{sectionName}</CardTitle>
                <span className="text-xs text-gray-400 font-medium">
                  {sectionTables.length} table{sectionTables.length !== 1 ? "s" : ""}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {sectionTables.map((table) => {
                  const config = TABLE_STATUS_CONFIG[table.status];
                  return (
                    <div
                      key={table.id}
                      className={`relative rounded-xl p-4 ring-1 transition-all ${config.bg} ${config.ring} group`}
                    >
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3 h-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditTableModal(table)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteTable(table.id)}>
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      
                      {/* Table Name */}
                      <div className="text-center mt-2">
                        <div className="w-10 h-10 mx-auto rounded-lg bg-white/70 flex items-center justify-center mb-2 shadow-xs cursor-pointer">
                          <Armchair className="w-5 h-5 text-gray-600" />
                        </div>
                        <p className="text-sm font-bold text-gray-900 cursor-pointer">
                          {table.name}
                        </p>
                        <div className="flex items-center justify-center gap-1 mt-1 text-gray-500">
                          <Users className="w-3 h-3" />
                          <span className="text-xs font-medium">
                            {table.capacity}
                          </span>
                        </div>
                        <Badge
                          variant={config.variant}
                          className="mt-2 text-[10px] px-2 py-0"
                        >
                          {config.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
