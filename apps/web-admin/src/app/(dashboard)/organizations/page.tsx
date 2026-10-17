"use client";

import { useToast } from "@/lib/toast";

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
import { Building2, MoreHorizontal, Loader2, Edit } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { type Organization, updateOrganizationSchema, type UpdateOrganization } from "@gusto/api-contracts";

export default function OrganizationsPage() {
  const { toast } = useToast();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<UpdateOrganization>({
    resolver: zodResolver(updateOrganizationSchema) as any,
    defaultValues: {
      name: "",
      gstNumber: "",
    }
  });

  const loadOrganizations = async () => {
    setLoading(true);
    setError("");

    try {
      // First get current user profile to get org ID
      const userRes = await apiFetch<{ organizationId: string }>("/auth/me");
      if (userRes.success && userRes.data?.organizationId) {
        const orgId = userRes.data.organizationId;
        const orgRes = await apiFetch<Organization>(`/organizations/${orgId}`);
        
        if (orgRes.success && orgRes.data) {
          setOrganizations([orgRes.data]);
        } else {
          setError(orgRes.message || "Failed to load organization details.");
        }
      } else {
        setError(userRes.message || "Failed to load organization. Please check your connection.");
      }
    } catch (err) {
      console.error("Failed to load organization", err);
      setError("An unexpected error occurred while loading organization data.");
    }
    
    setLoading(false);
  };

  useEffect(() => {
    loadOrganizations();
  }, []);

  const handleEditClick = (org: Organization) => {
    setEditingOrg(org);
    form.reset({
      name: org.name,
      gstNumber: org.gstNumber || "",
    });
    setIsEditModalOpen(true);
  };

  const handleUpdateOrganization = async (data: UpdateOrganization) => {
    if (!editingOrg) return;
    
    setIsSubmitting(true);
    const res = await apiFetch<Organization>(`/organizations/${editingOrg.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...data,
        gstNumber: data.gstNumber || null
      }),
    });

    if (res.success && res.data) {
      setOrganizations(orgs => orgs.map(o => o.id === editingOrg.id ? res.data! : o));
      setIsEditModalOpen(false);
    } else {
      toast({ title: "Update failed", description: res.message || "Failed to update organization", variant: "error" });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Organizations</h1>
          <p className="text-gray-500">Manage your tenant organizations and their billing details.</p>
        </div>
        {/* We do not allow adding new organizations from this view as it's tenant scoped */}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={form.handleSubmit(handleUpdateOrganization)}>
            <DialogHeader>
              <DialogTitle>Edit Organization</DialogTitle>
              <DialogDescription>
                Update your organization details.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Gusto's Global Group"
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <p className="text-red-500 text-xs font-medium">{form.formState.errors.name.message}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="gstNumber">GST Number</Label>
                <Input
                  id="gstNumber"
                  placeholder="Optional"
                  {...form.register("gstNumber")}
                />
                {form.formState.errors.gstNumber && (
                  <p className="text-red-500 text-xs font-medium">{form.formState.errors.gstNumber.message}</p>
                )}
              </div>
            </div>
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Registered Organization</CardTitle>
              <CardDescription>Your tenant organization details in the ERP.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Loading organization details...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead className="w-[300px]">Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>GST Number</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium text-gray-900">{org.name}</TableCell>
                    <TableCell className="text-gray-500 font-mono text-sm">{org.slug}</TableCell>
                    <TableCell className="text-gray-500">{org.gstNumber || "—"}</TableCell>
                    <TableCell className="text-gray-500">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditClick(org)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
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
    </div>
  );
}

