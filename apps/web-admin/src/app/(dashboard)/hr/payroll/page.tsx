"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { type Payroll, type Outlet, type PayrollStatus } from "@gusto/api-contracts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IndianRupee, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";

const STATUS_CONFIG: Record<PayrollStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  CALCULATED: { label: "Calculated", className: "bg-blue-100 text-blue-700" },
  APPROVED: { label: "Approved", className: "bg-amber-100 text-amber-700" },
  PAID: { label: "Paid", className: "bg-emerald-100 text-emerald-700" },
};

export default function PayrollPage() {
  const { toast } = useToast();
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError("");
    const outletsRes = await apiFetch<Outlet[]>("/outlets");
    if (outletsRes.success && outletsRes.data && outletsRes.data.length > 0) {
      setOutlets(outletsRes.data);
      const outletId = outletsRes.data[0]!.id;
      setSelectedOutletId(outletId);
      const payrollsRes = await apiFetch<Payroll[]>(`/hr/payrolls?outletId=${outletId}&month=${selectedMonth}&limit=50`);
      if (payrollsRes.success && payrollsRes.data) {
        setPayrolls(payrollsRes.data);
      } else {
        setError(payrollsRes.message || "Failed to load payroll records.");
      }
    } else {
      setError(outletsRes.message || "Failed to load outlets.");
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleGeneratePayroll = async () => {
    if (!selectedOutletId) return;
    setIsGenerating(true);
    const res = await apiFetch<Payroll[]>("/hr/payrolls/generate", {
      method: "POST",
      body: JSON.stringify({ outletId: selectedOutletId, month: selectedMonth }),
    });
    if (res.success) {
      toast({ title: "Payroll generated", description: "Payroll records have been created.", variant: "success" });
      await loadData();
    } else {
      toast({ title: "Generation failed", description: res.message, variant: "error" });
    }
    setIsGenerating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">HR — Payroll</h1>
          <p className="text-gray-500">Review and manage employee payroll records.</p>
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
          <Link href="/hr/attendance">
            <Button variant="outline" className="bg-white">Attendance</Button>
          </Link>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleGeneratePayroll} disabled={isGenerating}>
            {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate Payroll
          </Button>
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
            <IndianRupee className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Payroll Records</CardTitle>
              <CardDescription>Payroll for {selectedMonth}.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading payroll...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Days Worked</TableHead>
                  <TableHead>Base Salary</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Bonus</TableHead>
                  <TableHead>Net Salary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrolls.map(payroll => {
                  const statusConfig = STATUS_CONFIG[payroll.status];
                  return (
                    <TableRow key={payroll.id}>
                      <TableCell className="font-mono text-xs text-gray-600">{payroll.userId.slice(0, 8)}...</TableCell>
                      <TableCell className="text-gray-700">{payroll.month}</TableCell>
                      <TableCell className="text-gray-600">{payroll.daysWorked}/{payroll.totalDays}</TableCell>
                      <TableCell className="font-medium">₹{Number(payroll.baseSalary).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-red-600">-₹{Number(payroll.deductions).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-emerald-600">+₹{Number(payroll.bonus).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="font-bold text-gray-900">₹{Number(payroll.netSalary).toLocaleString("en-IN")}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusConfig.className}`}>
                          {statusConfig.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs">
                        {payroll.paidAt ? new Date(payroll.paidAt).toLocaleDateString("en-IN") : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {payrolls.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                      No payroll records for this period. Click &quot;Generate Payroll&quot; to create them.
                    </TableCell>
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
