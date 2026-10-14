"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserSchema, type CreateUser, type User, type Outlet } from "@gusto/api-contracts";
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
import { Users, Plus, MoreHorizontal, Loader2, Edit, Trash2, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export default function StaffPage() {
  const { toast } = useToast();
  const [staff, setStaff] = useState<User[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const form = useForm<CreateUser & { isActive?: boolean }>({
    resolver: zodResolver(createUserSchema) as any, // bypass strict schema check to allow isActive for edits
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      role: "CASHIER",
      pin: "",
      outletId: "",
      isActive: true,
    }
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    const [staffRes, outletsRes] = await Promise.all([
      apiFetch<User[]>(`/users?page=${page}&limit=20`),
      apiFetch<Outlet[]>("/outlets")
    ]);

    if (outletsRes.success && outletsRes.data) {
      setOutlets(outletsRes.data);
    }

    if (staffRes.success && staffRes.data) {
      setStaff(staffRes.data);
      if ((staffRes as any).pagination) {
        setTotalPages((staffRes as any).pagination.totalPages);
      }
    } else {
      setError(staffRes.message || "Failed to load staff members. Please check your connection.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [page]);

  const openCreateModal = () => {
    setEditingUser(null);
    form.reset({
      name: "",
      email: "",
      phone: "",
      role: "CASHIER",
      pin: "",
      outletId: "",
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    form.reset({
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      role: user.role,
      pin: "", // Don't show existing pin
      outletId: user.outletId || "",
      isActive: user.isActive,
    });
    setIsModalOpen(true);
  };

  const handleSaveEmployee = async (data: any) => {
    setIsSubmitting(true);

    if (editingUser) {
      // Update
      const res = await apiFetch<User>(`/users/${editingUser.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name,
          email: data.email || undefined,
          phone: data.phone || undefined,
          role: data.role,
          pin: data.pin || undefined,
          outletId: data.outletId || null,
          isActive: data.isActive,
        }),
      });

      if (res.success && res.data) {
        setStaff(staff.map(s => s.id === editingUser.id ? res.data! : s));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message || "Failed to update employee", variant: "error" });
      }
    } else {
      // Create
      const res = await apiFetch<User>("/users", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          email: data.email || undefined,
          phone: data.phone || undefined,
          pin: data.pin || undefined,
          outletId: data.outletId || undefined,
        }),
      });

      if (res.success && res.data) {
        setStaff([...staff, res.data]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create employee", variant: "error" });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm("Are you sure you want to deactivate this user?")) return;
    
    const res = await apiFetch(`/users/${id}`, { method: "DELETE" });
    if (res.success) {
      // Update status to inactive locally since it's a soft delete
      setStaff(staff.map(s => s.id === id ? { ...s, isActive: false } : s));
    } else {
      toast({ title: "Deactivation failed", description: res.message || "Failed to deactivate employee", variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Staff & Access</h1>
          <p className="text-gray-500">Manage employee accounts, roles, and outlet assignments.</p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Employee
          </Button>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={form.handleSubmit(handleSaveEmployee)}>
              <DialogHeader>
                <DialogTitle>{editingUser ? "Edit Employee" : "Add New Employee"}</DialogTitle>
                <DialogDescription>
                  {editingUser ? "Update employee details and permissions." : "Register a new staff member and configure POS access."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    placeholder="Jane Doe"
                    {...form.register("name")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-red-500 text-xs font-medium">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Optional"
                      {...form.register("email")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      placeholder="+91..."
                      {...form.register("phone")}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <select
                      id="role"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      {...form.register("role")}
                    >
                      <option value="MANAGER">Manager</option>
                      <option value="CASHIER">Cashier</option>
                      <option value="WAITER">Waiter</option>
                      <option value="CHEF">Chef</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pin">POS PIN (4-digit)</Label>
                    <Input
                      id="pin"
                      placeholder={editingUser ? "Leave blank to keep" : "e.g. 1234"}
                      maxLength={4}
                      {...form.register("pin")}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outletId">Outlet Assignment</Label>
                  <select
                    id="outletId"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    {...form.register("outletId")}
                  >
                    <option value="">No specific outlet (Global)</option>
                    {outlets.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                
                {editingUser && (
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch
                      id="isActive"
                      checked={form.watch("isActive")}
                      onCheckedChange={(checked) => form.setValue("isActive", checked)}
                    />
                    <Label htmlFor="isActive" className="font-normal cursor-pointer">
                      User Account is active
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
                  {editingUser ? "Save Changes" : "Save Employee"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="staff" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="staff" className="gap-2">
            <Users className="w-4 h-4" />
            Staff Members
          </TabsTrigger>
          <TabsTrigger value="roles" className="gap-2">
            <ShieldCheck className="w-4 h-4" />
            Role & Permissions Matrix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="staff">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Team Members</CardTitle>
                  <CardDescription>A complete list of registered staff members.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  Loading staff members...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                      <TableHead className="w-[250px]">Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staff.map((employee) => (                      <TableRow key={employee.id}>
                        <TableCell className="font-medium text-gray-900">{employee.name}</TableCell>
                        <TableCell className="text-gray-500">{employee.email || "—"}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                            {employee.role}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              employee.isActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {employee.isActive ? "Active" : "Inactive"}
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
                              <DropdownMenuItem onClick={() => openEditModal(employee)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              {employee.isActive && (
                                <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteEmployee(employee.id)}>
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Deactivate
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card className="shadow-xs border-gray-100">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">Permission Matrix</CardTitle>
                  <CardDescription>Configure specific permissions for each role dynamically.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8 text-center text-gray-500">
              Permission UI editor coming soon.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
