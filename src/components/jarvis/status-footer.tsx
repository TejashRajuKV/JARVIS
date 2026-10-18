"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Sticky status footer (mt-auto) — brand + core status dot, mini telemetry
// readout, mode chips (VOICE / DND / PANIC) and a live client clock.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { useJarvisStore } from "@/lib/jarvis/store";
import { formatClock } from "@/lib/jarvis/client/ui-helpers";
import { cn } from "@/lib/utils";

function ModeChip({
  label,
  active,
  tone = "cyan",
}: {
  label: string;
  active: boolean;
  tone?: "cyan" | "amber" | "red";
}) {
  const toneCls =
    tone === "amber"
      ? "border-amber-300/50 text-amber-300"
      : tone === "red"
        ? "border-red-400/50 text-red-300"
        : "border-cyan-300/40 text-cyan-300";
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.15em]",
        active ? toneCls : "border-cyan-400/15 text-muted-foreground/60"
      )}
    >
      {label}
    </span>
  );
}

export function StatusFooter() {
  const telemetry = useJarvisStore((s) => s.telemetry);
  const voiceEnabled = useJarvisStore((s) => s.settings.voiceEnabled);
  const dnd = useJarvisStore((s) => s.settings.dnd);
  const autonomy = useJarvisStore((s) => s.settings.autonomy);
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const battery = telemetry.battery;
  const net = telemetry.network;

  return (
    <footer className="mt-auto border-t border-cyan-400/15 bg-[#04090d]/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 pb-[4.25rem] py-2 lg:pb-2">
        {/* left — brand + core status */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.8)]"
          />
          <span className="truncate font-mono text-[10px] tracking-[0.2em] text-cyan-200/80">
            <span className="hidden sm:inline">J.A.R.V.I.S. WEB CONSOLE • </span>
            v2.0
          </span>
        </div>

        {/* center — mini telemetry */}
        <div
          className="mx-auto hidden items-center gap-3 font-mono text-[10px] tabular-nums text-muted-foreground md:flex"
          aria-label="Mini telemetry"
        >
          <span>
            BAT{" "}
            <span className="text-cyan-200/90">
              {battery ? `${Math.round(battery.level * 100)}%` : "—"}
            </span>
          </span>
          <span aria-hidden="true" className="text-cyan-400/25">
            │
          </span>
          <span>
            NET <span className="text-cyan-200/90">{net?.effectiveType ?? "—"}</span>
          </span>
          <span aria-hidden="true" className="text-cyan-400/25">
            │
          </span>
          <span>
            FPS{" "}
            <span className="text-cyan-200/90">
              {telemetry.fps != null ? Math.round(telemetry.fps) : "—"}
            </span>
          </span>
        </div>

        {/* right — mode chips + clock */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ModeChip label={voiceEnabled ? "VOICE ON" : "VOICE OFF"} active={voiceEnabled} />
          <ModeChip label="DND" active={dnd} tone="amber" />
          <ModeChip
            label="PANIC"
            active={dnd && autonomy === "standard"}
            tone="red"
          />
          <span
            className="ml-1 font-mono text-[11px] tabular-nums text-cyan-200"
            aria-label="Client time"
          >
            {clock}
          </span>
        </div>
      </div>
    </footer>
  );
}
