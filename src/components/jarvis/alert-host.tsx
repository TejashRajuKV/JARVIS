"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Alert host — renders store.pendingAlerts as fixed top-right HUD cards
// (framer-motion slide-in). Amber = battery, cyan = reminder, red = system.
// "Acknowledge" marks reminder alerts done via PATCH /api/reminders.
// Custom cards (no sonner) to keep the HUD look.
// ─────────────────────────────────────────────────────────────────────────────

import { AnimatePresence, motion } from "framer-motion";
import { BatteryMedium, BellRing, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { ReminderDTO } from "@/lib/jarvis/types";
import { asArray, fetchJson } from "@/lib/jarvis/client/ui-helpers";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<
  "reminder" | "battery" | "system",
  { border: string; bg: string; text: string; icon: typeof BellRing; label: string }
> = {
  reminder: {
    border: "border-cyan-300/40",
    bg: "bg-cyan-400/[0.08]",
    text: "text-cyan-100",
    icon: BellRing,
    label: "REMINDER",
  },
  battery: {
    border: "border-amber-300/40",
    bg: "bg-amber-400/[0.08]",
    text: "text-amber-100",
    icon: BatteryMedium,
    label: "POWER",
  },
  system: {
    border: "border-red-400/40",
    bg: "bg-red-400/[0.07]",
    text: "text-red-100",
    icon: ShieldAlert,
    label: "SYSTEM",
  },
};

export function AlertHost() {
  const alerts = useJarvisStore((s) => s.pendingAlerts);
  const dismissAlert = useJarvisStore((s) => s.dismissAlert);

  const acknowledge = async (id: string) => {
    // reminder alert ids mirror the reminder DTO id
    await fetchJson("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    // refresh the reminders cache so the row flips to done
    const res = await fetchJson<unknown>("/api/reminders");
    useJarvisStore.getState().setReminders(asArray<ReminderDTO>(res.data, ["reminders"]));
    dismissAlert(id);
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-3 top-3 z-[55] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2"
    >
      <AnimatePresence>
        {alerts.map((a) => {
          const style = KIND_STYLE[a.kind];
          const Icon = style.icon;
          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 48 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              role="alert"
              className={cn(
                "hud-corners pointer-events-auto rounded-md border px-3 py-2.5 backdrop-blur-md",
                style.border,
                style.bg
              )}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    a.kind === "battery" ? "text-amber-300" : a.kind === "system" ? "text-red-300" : "text-cyan-300"
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("micro-label", a.kind === "battery" ? "text-amber-300/80" : a.kind === "system" ? "text-red-300/80" : "text-cyan-300/80")}>
                    {style.label}
                  </p>
                  <p className={cn("mt-0.5 break-words font-mono text-xs leading-snug", style.text)}>
                    {a.title}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Dismiss alert: ${a.title}`}
                  onClick={() => dismissAlert(a.id)}
                  className="size-7 shrink-0 text-muted-foreground hover:text-cyan-200"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismissAlert(a.id)}
                  className="h-7 rounded px-2 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-cyan-200"
                >
                  DISMISS
                </Button>
                <Button
                  size="sm"
                  onClick={() => void acknowledge(a.id)}
                  className="h-7 rounded border border-cyan-300/40 bg-cyan-400/15 px-2 font-mono text-[10px] tracking-widest text-cyan-200 hover:bg-cyan-400/25"
                >
                  ACKNOWLEDGE
                </Button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
