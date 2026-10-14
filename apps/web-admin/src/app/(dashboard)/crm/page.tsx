"use client";

import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { type Feedback, type CreateFeedback, createFeedbackSchema, type Outlet } from "@gusto/api-contracts";
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
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Plus, Loader2, Star } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import Link from "next/link";

export default function CRMFeedbackPage() {
  const { toast } = useToast();
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CreateFeedback>({
    resolver: zodResolver(createFeedbackSchema) as any,
    defaultValues: { rating: 5, comment: "", source: "IN_APP" },
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    const [feedbacksRes, outletsRes] = await Promise.all([
      apiFetch<Feedback[]>("/crm/feedbacks?limit=50"),
      apiFetch<Outlet[]>("/outlets"),
    ]);
    if (feedbacksRes.success && feedbacksRes.data) {
      setFeedbacks(feedbacksRes.data);
    } else {
      setError(feedbacksRes.message || "Failed to load feedback records.");
    }
    if (outletsRes.success && outletsRes.data) setOutlets(outletsRes.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSaveFeedback = async (data: CreateFeedback) => {
    setIsSubmitting(true);
    const res = await apiFetch<Feedback>("/crm/feedbacks", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (res.success && res.data) {
      setFeedbacks([res.data, ...feedbacks]);
      setIsModalOpen(false);
      form.reset();
    } else {
      toast({ title: "Failed to save feedback", description: res.message, variant: "error" });
    }
    setIsSubmitting(false);
  };

  const getOutletName = (outletId?: string) => outletId ? (outlets.find(o => o.id === outletId)?.name || outletId) : "—";

  const renderStars = (rating: number) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= rating ? "text-amber-400 fill-amber-400" : "text-gray-300"}`} />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">CRM — Feedback</h1>
          <p className="text-gray-500">View and manage customer feedback and ratings.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/crm/coupons">
            <Button variant="outline" className="bg-white">Coupons</Button>
          </Link>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <Button onClick={() => { form.reset(); setIsModalOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />Record Feedback
            </Button>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={form.handleSubmit(handleSaveFeedback)}>
                <DialogHeader>
                  <DialogTitle>Record Feedback</DialogTitle>
                  <DialogDescription>Add a new customer feedback entry.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Outlet (optional)</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...form.register("outletId")}
                    >
                      <option value="">No specific outlet</option>
                      {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Rating (1–5)</Label>
                    <Input type="number" min={1} max={5} {...form.register("rating", { valueAsNumber: true })} />
                    {form.formState.errors.rating && <p className="text-red-500 text-xs">{form.formState.errors.rating.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Comment (optional)</Label>
                    <Textarea placeholder="Customer feedback..." {...form.register("comment")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Source</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...form.register("source")}
                    >
                      <option value="IN_APP">In-App</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="SMS">SMS</option>
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Feedback
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
            <MessageSquare className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">Customer Feedback</CardTitle>
              <CardDescription>All feedback and ratings from customers.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />Loading feedback...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead>Rating</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbacks.map(fb => (
                  <TableRow key={fb.id}>
                    <TableCell>{renderStars(fb.rating)}</TableCell>
                    <TableCell className="text-gray-700 max-w-[300px] truncate">{fb.comment || "—"}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {fb.source}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-500">{getOutletName(fb.outletId)}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{new Date(fb.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  </TableRow>
                ))}
                {feedbacks.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500 py-8">No feedback recorded yet.</TableCell>
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
