"use client";

import { Loader2 } from "lucide-react";
import { Outlet } from "@gusto/api-contracts";
import { cn } from "@/lib/utils";

interface OutletSwitcherProps {
  outlets: Outlet[];
  currentOutletId: string;
  onOutletChange: (id: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function OutletSwitcher({
  outlets,
  currentOutletId,
  onOutletChange,
  isLoading = false,
  className,
}: OutletSwitcherProps) {
  // Render nothing when there are no outlets
  if (outlets.length === 0) {
    return null;
  }

  // Render a static label when there is only one outlet
  if (outlets.length === 1) {
    const singleOutlet = outlets[0]!;
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-sm font-medium text-foreground">
          {singleOutlet.name}
        </span>
        {isLoading && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  // Render a select dropdown when there are two or more outlets
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <select
        value={currentOutletId}
        onChange={(e) => onOutletChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        disabled={isLoading}
        aria-label="Select outlet"
      >
        {outlets.map((outlet) => (
          <option key={outlet.id} value={outlet.id}>
            {outlet.name}
          </option>
        ))}
      </select>
      {isLoading && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
