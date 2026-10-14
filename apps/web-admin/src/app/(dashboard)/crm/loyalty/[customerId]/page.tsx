"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { type LoyaltyTransaction, type AdjustLoyalty, adjustLoyaltySchema } from "@gusto/api-contracts";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Star, Loader2, ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function LoyaltyPage() {
  const { toast } = useToast();
  const params = useParams();
  const customerId = params.customerId as string;

  const [customerData, setCustomerData] = useState<{ name?: string; phone?: string; loyaltyPoints?: number } | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AdjustLoyalty>({
    resolver: zodResolver(adjustLoyaltySchema) as any,
    defaultValues: { customerId, points: 0, description: "" },
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    const [loyaltyRes, historyRes] = await Promise.all([
      apiFetch<{ customer: { name?: string; phone?: string; loyaltyPoints?: number }; balance: number }>(`/crm/loyalty/${customerId}`),
      apiFetch<LoyaltyTransaction[]>(`/crm/loyalty/${customerId}/history?limit=50`),
    ]);
    if (loyaltyRes.success && loyaltyRes.data) {
      setCustomerData(loyaltyRes.data.customer);
    } else {
      setError(loyaltyRes.message || "Failed to load loyalty data.");
    }
    if (historyRes.success && historyRes.data) {
      setTransactions(historyRes.data);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [customerId]);

  const handleAdjust = async (data: AdjustLoyalty) => {
    setIsSubmitting(true);
    const res = await apiFetch<LoyaltyTransaction>("/crm/loyalty/adjust", {
      method: "POST",
      body: JSON.stringify({ ...data, customerId }),
    });
    if (res.success && res.data) {
      setTransactions([res.data, ...transactions]);
      if (customerData) {
        setCustomerData({ ...customerData, loyaltyPoints: res.data.balanceAfter });
      }
      setIsAdjustModalOpen(false);
      form.reset({ customerId, points: 0, description: "" });
      toast({ title: "Adjustment applied", variant: "success" });
    } else {
      toast({ title: "Adjustment failed", description: res.message, variant: "error" });
    }
    setIsSubmitting(false);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "EARN": return "bg-emerald-100 text-emerald-700";
      case "REDEEM": return "bg-red-100 text-red-700";
      case "ADJUST": return "bg-blue-100 text-blue-700";
      case "EXPIRE": return "bg-gray-100 text-gray-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/customers">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Loyalty — {customerData?.name || "Customer"}
            </h1>
            <p className="text-gray-500">Loyalty points and transaction history.</p>
          </div>
        </div>
        <Dialog open={isAdjustModalOpen} onOpenChange={setIsAdjustModalOpen}>
          <Button onClick={() => { form.reset({ customerId, points: 0, description: "" }); setIsAdjustModalOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
            <Star className="w-4 h-4 mr-2" />Manual Adjust
          </Button>
          <DialogContent className="sm:max-w-[400px]">
            <form onSubmit={form.handleSubmit(handleAdjust)}>
              <DialogHeader>
                <DialogTitle>Manual Points Adjustment</DialogTitle>
                <DialogDescription>Add or remove loyalty points. Use negative value to deduct.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Points (positive to add, negative to deduct)</Label>
                  <Input type="number" {...form.register("points", { valueAsNumber: true })} />
                  {form.formState.errors.points && <p className="text-red-500 text-xs">{(form.formState.errors.points as any).message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Input placeholder="e.g. Birthday bonus" {...form.register("description")} />
                  {form.formState.errors.description && <p className="text-red-500 text-xs">{(form.formState.errors.description as any).message}</p>}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAdjustModalOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Apply Adjustment
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span><span>{error}</span>
        </div>
      )}

      {/* Balance Card */}
      {customerData && (
        <Card className="shadow-xs border-gray-100">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-50">
                <Star className="w-6 h-6 text-amber-500 fill-amber-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-900">{(customerData.loyaltyPoints ?? 0).toLocaleString("en-IN")} pts</p>
                <p className="text-sm text-gray-500">{customerData.name} · {customerData.phone}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-xs border-gray-100">
        <CardHeader className="bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Transaction History</CardTitle>
              <CardDescription>All loyalty point transactions for this customer.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading transactions...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Type</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Balance After</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(tx.type)}`}>
                        {tx.type}
                      </span>
                    </TableCell>
                    <TableCell className={`font-semibold ${tx.points >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {tx.points >= 0 ? `+${tx.points}` : tx.points}
                    </TableCell>
                    <TableCell className="text-gray-700 font-medium">{tx.balanceAfter}</TableCell>
                    <TableCell className="text-gray-500">{tx.description || "—"}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{new Date(tx.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  </TableRow>
                ))}
                {transactions.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500 py-8">No transactions found.</TableCell>
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
