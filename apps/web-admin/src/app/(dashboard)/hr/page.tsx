"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { type Shift, type Outlet, type CreateShift, createShiftSchema } from "@gusto/api-contracts";
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
import { Clock, Plus, Loader2, MoreHorizontal, Edit, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";

export default function HRShiftsPage() {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [currentOutletId, setCurrentOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const form = useForm<CreateShift>({
    resolver: zodResolver(createShiftSchema) as any,
    defaultValues: { outletId: "", name: "", startTime: "09:00", endTime: "17:00", isActive: true },
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      const outletId = outletsRes.data[0]!.id;
      setCurrentOutletId(outletId);
      form.setValue("outletId", outletId);
      const shiftsRes = await apiFetch<Shift[]>(`/hr/shifts?outletId=${outletId}`);
      if (shiftsRes.success && shiftsRes.data) {
        setShifts(shiftsRes.data);
      } else {
        setError(shiftsRes.message || "Failed to load shifts.");
      }
    } else {
      setError(outletsRes.message || "Failed to load outlets.");
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const openCreateModal = () => {
    setEditingShift(null);
    form.reset({ outletId: currentOutletId, name: "", startTime: "09:00", endTime: "17:00", isActive: true });
    setIsModalOpen(true);
  };

  const openEditModal = (shift: Shift) => {
    setEditingShift(shift);
    form.reset({ outletId: shift.outletId, name: shift.name, startTime: shift.startTime, endTime: shift.endTime, isActive: shift.isActive });
    setIsModalOpen(true);
  };

  const handleSaveShift = async (data: any) => {
    setIsSubmitting(true);
    if (editingShift) {
      const res = await apiFetch<Shift>(`/hr/shifts/${editingShift.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: data.name, startTime: data.startTime, endTime: data.endTime, isActive: data.isActive }),
      });
      if (res.success && res.data) {
        setShifts(shifts.map(s => s.id === editingShift.id ? res.data! : s));
        setIsModalOpen(false);
      } else {
        toast({ title: "Update failed", description: res.message, variant: "error" });
      }
    } else {
      const res = await apiFetch<Shift>("/hr/shifts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (res.success && res.data) {
        setShifts([...shifts, res.data]);
        setIsModalOpen(false);
      } else {
        toast({ title: "Creation failed", description: res.message, variant: "error" });
      }
    }
    setIsSubmitting(false);
  };

  const handleDeleteShift = async (id: string) => {
    if (!confirm("Delete this shift?")) return;
    const res = await apiFetch(`/hr/shifts/${id}`, { method: "DELETE" });
    if (res.success) {
      setShifts(shifts.filter(s => s.id !== id));
    } else {
      toast({ title: "Delete failed", description: res.message, variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">HR — Shifts</h1>
          <p className="text-gray-500">Manage work shifts and schedules for your outlets.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/hr/attendance">
            <Button variant="outline" className="bg-white">Attendance</Button>
          </Link>
          <Link href="/hr/payroll">
            <Button variant="outline" className="bg-white">Payroll</Button>
          </Link>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />Add Shift
            </Button>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={form.handleSubmit(handleSaveShift)}>
                <DialogHeader>
                  <DialogTitle>{editingShift ? "Edit Shift" : "Add Shift"}</DialogTitle>
                  <DialogDescription>{editingShift ? "Update this shift." : "Create a new work shift."}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  {!editingShift && (
                    <div className="space-y-2">
                      <Label>Outlet</Label>
                      <select className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register("outletId")}>
                        {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Shift Name</Label>
                    <Input placeholder="e.g. Morning Shift" {...form.register("name")} />
                    {form.formState.errors.name && <p className="text-red-500 text-xs">{form.formState.errors.name.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input type="time" {...form.register("startTime")} />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input type="time" {...form.register("endTime")} />
                    </div>
                  </div>
                  {editingShift && (
                    <div className="flex items-center space-x-2 pt-2">
                      <Switch checked={form.watch("isActive")} onCheckedChange={v => form.setValue("isActive", v)} />
                      <Label className="font-normal cursor-pointer">Shift is active</Label>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingShift ? "Save Changes" : "Save Shift"}
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
            <Clock className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Work Shifts</CardTitle>
              <CardDescription>All configured shifts for your outlets.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading shifts...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Shift Name</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map(shift => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium text-gray-900">{shift.name}</TableCell>
                    <TableCell className="text-gray-500 font-mono">{shift.startTime}</TableCell>
                    <TableCell className="text-gray-500 font-mono">{shift.endTime}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${shift.isActive ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"}`}>
                        {shift.isActive ? "Active" : "Inactive"}
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
                          <DropdownMenuItem onClick={() => openEditModal(shift)}>
                            <Edit className="w-4 h-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteShift(shift.id)}>
                            <Trash2 className="w-4 h-4 mr-2" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {shifts.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500 py-8">No shifts configured. Add one to get started.</TableCell>
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
