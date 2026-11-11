"use client";

/**
 * Franchise (brand) dialogs for the Outlets page: create / rename, and a
 * delete confirmation that spells out what goes with the franchise.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { Franchise } from "@gusto/api-contracts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/lib/toast";

export function FranchiseFormDialog({
  open,
  franchise,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** The franchise being renamed, or null to create a new one */
  franchise: Franchise | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (franchise: Franchise, created: boolean) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(franchise?.name ?? "");
      setError(null);
    }
  }, [open, franchise]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name for the franchise.");
    if (trimmed.length > 255) return setError("Name must be 255 characters or less.");
    if (franchise && trimmed === franchise.name) return onOpenChange(false);

    setSaving(true);
    setError(null);
    const res = franchise
      ? await apiFetch<Franchise>(`/franchises/${franchise.id}`, { method: "PUT", body: JSON.stringify({ name: trimmed }) })
      : await apiFetch<Franchise>("/franchises", { method: "POST", body: JSON.stringify({ name: trimmed }) });
    setSaving(false);

    if (!res.success || !res.data) return setError(res.message ?? "Could not save the franchise.");
    toast({ title: franchise ? "Franchise renamed" : `Franchise "${res.data.name}" created` });
    onSaved(res.data, !franchise);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{franchise ? "Rename franchise" : "New franchise"}</DialogTitle>
          <DialogDescription>
            {franchise
              ? "The new name appears everywhere this franchise is shown."
              : "A franchise (or brand) groups outlets together. Create one, then add outlets to it."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="franchise-name">Franchise name</Label>
            <Input
              id="franchise-name"
              autoFocus
              value={name}
              maxLength={255}
              placeholder="e.g. Gusto's — Mumbai"
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
            />
            {error && (
              <p role="alert" className="text-sm text-rose-600">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {franchise ? "Save name" : "Create franchise"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FranchiseDeleteDialog({
  franchise,
  outletCount,
  onOpenChange,
  onDeleted,
}: {
  franchise: Franchise | null;
  outletCount: number;
  onOpenChange: (open: boolean) => void;
  onDeleted: (franchise: Franchise) => void;
}) {
  const { toast } = useToast();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTyped("");
    setError(null);
  }, [franchise]);

  if (!franchise) return null;
  // A franchise with outlets takes their menus, tables and order history with it — make that deliberate
  const needsTyping = outletCount > 0;
  const confirmed = !needsTyping || typed.trim() === franchise.name;

  const remove = async () => {
    setDeleting(true);
    setError(null);
    const res = await apiFetch(`/franchises/${franchise.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.success) return setError(res.message ?? "Could not delete the franchise.");
    toast({ title: `Franchise "${franchise.name}" deleted` });
    onDeleted(franchise);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
            Delete “{franchise.name}”?
          </DialogTitle>
          <DialogDescription>
            {outletCount === 0
              ? "This franchise has no outlets. It will be removed permanently."
              : `This permanently deletes the franchise and its ${outletCount} outlet${outletCount === 1 ? "" : "s"} — including their menus, tables, staff assignments and order history. This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        {needsTyping && (
          <div className="space-y-1.5 py-2">
            <Label htmlFor="franchise-confirm">
              Type <span className="font-semibold">{franchise.name}</span> to confirm
            </Label>
            <Input id="franchise-confirm" value={typed} disabled={deleting} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Keep franchise
          </Button>
          <Button className="bg-rose-600 hover:bg-rose-700" onClick={remove} disabled={!confirmed || deleting}>
            {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Delete franchise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
