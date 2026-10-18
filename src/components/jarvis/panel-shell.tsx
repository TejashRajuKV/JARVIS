"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Shared side-panel chrome: title row with count + refresh, error strip,
// empty-state hint. Used by all six panels.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PanelShell({
  title,
  count,
  onRefresh,
  refreshing,
  error,
  children,
  className,
}: {
  title: string;
  count?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 p-3", className)}>
      <div className="flex items-center gap-2">
        <h3 className="micro-label text-cyan-300/80">{title}</h3>
        {typeof count === "number" && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            [{String(count).padStart(2, "0")}]
          </span>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Refresh ${title.toLowerCase()}`}
            disabled={refreshing}
            onClick={onRefresh}
            className="ml-auto size-7 text-muted-foreground hover:text-cyan-300"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-400/30 bg-red-400/5 px-2 py-1.5 font-mono text-[11px] text-red-300"
        >
          LINK ERROR · {error}
        </p>
      )}
      <div className="flex min-h-0 flex-col gap-2">{children}</div>
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-cyan-400/20 px-3 py-6 text-center font-mono text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}
