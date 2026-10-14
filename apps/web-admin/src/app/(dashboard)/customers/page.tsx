"use client";

import { useToast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCustomerSchema,
  type CreateCustomer,
  type Customer,
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users2,
  Plus,
  MoreHorizontal,
  Download,
  Loader2,
  Star,
  TrendingUp,
  Edit,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export default function CustomersPage() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const form = useForm<CreateCustomer>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      notes: "",
    },
  });

  const loadCustomers = async () => {
    setLoading(true);
    setError("");
    const res = await apiFetch<Customer[]>(`/customers?page=${page}&limit=20`);

    if (res.success && res.data) {
      setCustomers(res.data);
      if ((res as any).pagination) {
        setTotalPages((res as any).pagination.totalPages);
      }
    } else {
      setError(res.message || "Failed to load customers. Please check your connection.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCustomers();
  }, [page]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    form.reset({
      name: "",
      phone: "",
      email: "",
      notes: "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    form.reset({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      notes: customer.notes || "",
    });
    setIsModalOpen(true);
  };

  const handleSaveCustomer = async (data: CreateCustomer) => {
    setIsSubmitting(true);

    if (editingCustomer) {
      // Update
      const res = await apiFetch<Customer>(`/customers/${editingCustomer.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name,
          phone: data.phone,
          email: data.email || undefined,
          notes: data.notes || undefined,
        }),
      });

      if (res.success && res.data) {
        setCustomers(customers.map(c => c.id === editingCustomer.id ? res.data! : c));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message || "Failed to update customer", variant: "error" });
      }
    } else {
      // Create
      const res = await apiFetch<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          email: data.email || undefined,
          notes: data.notes || undefined,
        }),
      });

      if (res.success && res.data) {
        setCustomers([res.data, ...customers]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message || "Failed to create customer", variant: "error" });
      }
    }

    setIsSubmitting(false);
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer?")) return;
    
    const res = await apiFetch(`/customers/${id}`, { method: "DELETE" });
    if (res.success) {
      setCustomers(customers.filter(c => c.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message || "Failed to delete customer", variant: "error" });
    }
  };

  // Computed stats
  const totalCustomers = customers.length;
  const totalLoyaltyPoints = customers.reduce(
    (acc, c) => acc + c.loyaltyPoints,
    0
  );
  const avgSpend =
    totalCustomers > 0
      ? customers.reduce((acc, c) => acc + c.totalSpend, 0) / totalCustomers
      : 0;

  const timeAgo = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
    return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Customers (CRM)
          </h1>
          <p className="text-gray-500">
            Manage customer relationships, loyalty points, and history.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="bg-white">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Customer
            </Button>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={form.handleSubmit(handleSaveCustomer)}>
                <DialogHeader>
                  <DialogTitle>{editingCustomer ? "Edit Customer" : "Add New Customer"}</DialogTitle>
                  <DialogDescription>
                    {editingCustomer ? "Update details for this customer." : "Register a customer for loyalty tracking and order history."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g. Priya Kumar"
                      {...form.register("name")}
                    />
                    {form.formState.errors.name && (
                      <p className="text-red-500 text-xs font-medium">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        placeholder="+91 98765..."
                        {...form.register("phone")}
                      />
                      {form.formState.errors.phone && (
                        <p className="text-red-500 text-xs font-medium">
                          {form.formState.errors.phone.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">
                        Email{" "}
                        <span className="text-gray-400 font-normal">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@example.com"
                        {...form.register("email")}
                      />
                      {form.formState.errors.email && (
                        <p className="text-red-500 text-xs font-medium">
                          {form.formState.errors.email.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">
                      Notes{" "}
                      <span className="text-gray-400 font-normal">
                        (optional)
                      </span>
                    </Label>
                    <Textarea
                      id="notes"
                      placeholder="Allergies, preferences, special occasions..."
                      className="resize-none"
                      {...form.register("notes")}
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
                    {editingCustomer ? "Save Changes" : "Save Customer"}
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

      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-3">        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Users2 className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {totalCustomers}
                </p>
                <p className="text-xs text-gray-500 font-medium">
                  Total Customers
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50">
                <Star className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {totalLoyaltyPoints.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-gray-500 font-medium">
                  Loyalty Points
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  ₹{avgSpend.toLocaleString("en-IN", {
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="text-xs text-gray-500 font-medium">
                  Avg. Spend
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Customer Table */}
      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Users2 className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Customer Database</CardTitle>
              <CardDescription>
                All customers that have dined with you.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Loading customers...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead className="w-[250px]">Customer Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Loyalty Points</TableHead>
                  <TableHead>Visits</TableHead>
                  <TableHead>Total Spend</TableHead>
                  <TableHead>Last Visit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-gray-900">
                          {customer.name}
                        </p>
                        {customer.email && (
                          <p className="text-xs text-gray-400">
                            {customer.email}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {customer.phone}
                    </TableCell>
                    <TableCell>
                      <Badge variant="warning" className="gap-1">
                        <Star className="w-3 h-3" />
                        {customer.loyaltyPoints.toLocaleString("en-IN")} pts
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {customer.totalVisits}
                    </TableCell>
                    <TableCell className="text-gray-900 font-medium">
                      ₹{customer.totalSpend.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {timeAgo(customer.updatedAt)}
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
                          <DropdownMenuItem onClick={() => openEditModal(customer)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.location.href = `/crm/loyalty/${customer.id}`}>
                            <Star className="w-4 h-4 mr-2" />
                            View Loyalty
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteCustomer(customer.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {customers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                      No customers found.
                    </TableCell>
                  </TableRow>
                )}
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
    </div>
  );
}
