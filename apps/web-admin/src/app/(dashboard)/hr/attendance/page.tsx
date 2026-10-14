"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { type Attendance, type Outlet, type User, type Shift } from "@gusto/api-contracts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Clock, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";

export default function AttendancePage() {
  const { toast } = useToast();
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isClockInModalOpen, setIsClockInModalOpen] = useState(false);
  const [clockInUserId, setClockInUserId] = useState("");
  const [clockInShiftId, setClockInShiftId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError("");
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      const outletId = outletsRes.data[0]!.id;
      setSelectedOutletId(outletId);

      const [attendanceRes, staffRes, shiftsRes] = await Promise.all([
        apiFetch<Attendance[]>(`/hr/attendance?outletId=${outletId}&month=${selectedMonth}&limit=50`),
        apiFetch<User[]>("/users"),
        apiFetch<Shift[]>(`/hr/shifts?outletId=${outletId}`),
      ]);

      if (attendanceRes.success && attendanceRes.data) {
        setAttendances(attendanceRes.data);
      } else {
        setError(attendanceRes.message || "Failed to load attendance records.");
      }
      if (staffRes.success && staffRes.data) setStaff(staffRes.data);
      if (shiftsRes.success && shiftsRes.data) setShifts(shiftsRes.data);
    } else {
      setError(outletsRes.message || "Failed to load outlets.");
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleClockIn = async () => {
    if (!clockInUserId || !selectedOutletId) return;
    setIsSubmitting(true);
    const res = await apiFetch<Attendance>("/hr/attendance/clock-in", {
      method: "POST",
      body: JSON.stringify({
        userId: clockInUserId,
        outletId: selectedOutletId,
        shiftId: clockInShiftId || undefined,
      }),
    });
    if (res.success && res.data) {
      setAttendances([res.data, ...attendances]);
      setIsClockInModalOpen(false);
      toast({ title: "Clocked in", variant: "success" });
    } else {
      toast({ title: "Clock-in failed", description: res.message, variant: "error" });
    }
    setIsSubmitting(false);
  };

  const handleClockOut = async (attendanceId: string) => {
    const res = await apiFetch<Attendance>("/hr/attendance/clock-out", {
      method: "POST",
      body: JSON.stringify({ attendanceId }),
    });
    if (res.success && res.data) {
      setAttendances(attendances.map(a => a.id === attendanceId ? res.data! : a));
      toast({ title: "Clocked out", variant: "success" });
    } else {
      toast({ title: "Clock-out failed", description: res.message, variant: "error" });
    }
  };

  const getUserName = (userId: string) => staff.find(u => u.id === userId)?.name || userId;
  const getShiftName = (shiftId?: string) => shiftId ? (shifts.find(s => s.id === shiftId)?.name || shiftId) : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">HR — Attendance</h1>
          <p className="text-gray-500">Track daily clock-in and clock-out times.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="w-auto"
          />
          <Link href="/hr">
            <Button variant="outline" className="bg-white">Shifts</Button>
          </Link>
          <Link href="/hr/payroll">
            <Button variant="outline" className="bg-white">Payroll</Button>
          </Link>
          <Dialog open={isClockInModalOpen} onOpenChange={setIsClockInModalOpen}>
            <Button onClick={() => setIsClockInModalOpen(true)} className="bg-blue-600 hover:bg-blue-700">
              <Clock className="w-4 h-4 mr-2" />Clock In
            </Button>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>Clock In Employee</DialogTitle>
                <DialogDescription>Record attendance for an employee.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={clockInUserId}
                    onChange={e => setClockInUserId(e.target.value)}
                  >
                    <option value="">Select employee...</option>
                    {staff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Shift (optional)</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={clockInShiftId}
                    onChange={e => setClockInShiftId(e.target.value)}
                  >
                    <option value="">No shift</option>
                    {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsClockInModalOpen(false)}>Cancel</Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleClockIn} disabled={isSubmitting || !clockInUserId}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Clock In
                </Button>
              </DialogFooter>
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
              <CardTitle className="text-lg">Attendance Records</CardTitle>
              <CardDescription>Showing records for {selectedMonth}.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading attendance...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendances.map(att => (
                  <TableRow key={att.id}>
                    <TableCell className="font-medium text-gray-900">{getUserName(att.userId)}</TableCell>
                    <TableCell className="text-gray-500">{att.date}</TableCell>
                    <TableCell className="text-gray-500">{getShiftName(att.shiftId)}</TableCell>
                    <TableCell className="text-gray-500 font-mono text-xs">
                      {att.clockIn ? new Date(att.clockIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-500 font-mono text-xs">
                      {att.clockOut ? new Date(att.clockOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {att.hoursWorked ? `${att.hoursWorked.toFixed(1)}h` : "—"}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        att.status === "PRESENT" ? "bg-emerald-100 text-emerald-800" :
                        att.status === "ABSENT" ? "bg-red-100 text-red-800" :
                        att.status === "HALF_DAY" ? "bg-amber-100 text-amber-800" :
                        "bg-gray-100 text-gray-800"
                      }`}>
                        {att.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {att.clockIn && !att.clockOut && (
                        <Button variant="outline" size="sm" onClick={() => handleClockOut(att.id)}>
                          Clock Out
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {attendances.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-500 py-8">No attendance records found for this period.</TableCell>
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
