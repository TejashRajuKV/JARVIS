"use client";

// ─────────────────────────────────────────────────────────────────────────────
// REMINDERS panel — CRUD against /api/reminders. Overdue scheduled items are
// highlighted amber. Add form defaults to +10 minutes. Each row shows the
// fire time (user locale) plus a live countdown.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { ReminderDTO } from "@/lib/jarvis/types";
import {
  asArray,
  fetchJson,
  formatDateTime,
  timeAgo,
  toLocalInputValue,
} from "@/lib/jarvis/client/ui-helpers";
import { EmptyHint, PanelShell } from "@/components/jarvis/panel-shell";
import { cn } from "@/lib/utils";

export function RemindersPanel() {
  const reminders = useJarvisStore((s) => s.reminders);
  const setReminders = useJarvisStore((s) => s.setReminders);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [fireAt, setFireAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 10 * 60_000))
  );
  const [, setTick] = useState(0);

  // refresh countdowns every 15s
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchJson<unknown>("/api/reminders");
    if (err) setError(err);
    setReminders(asArray<ReminderDTO>(data, ["reminders"]));
    setLoading(false);
  }, [setReminders]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    const t = title.trim();
    if (!t || !fireAt) return;
    const { error: err } = await fetchJson("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, fireAt: new Date(fireAt).toISOString() }),
    });
    if (err) setError(err);
    setTitle("");
    void refresh();
  };

  const patch = async (id: string, status: ReminderDTO["status"]) => {
    const { error: err } = await fetchJson("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (err) setError(err);
    void refresh();
  };

  const remove = async (id: string) => {
    const { error: err } = await fetchJson(
      `/api/reminders?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (err) setError(err);
    void refresh();
  };

  const sorted = [...reminders].sort(
    (a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime()
  );
  const scheduledCount = sorted.filter((r) => r.status === "scheduled").length;

  return (
    <PanelShell
      title="Reminders"
      count={scheduledCount}
      onRefresh={() => void refresh()}
      refreshing={loading}
      error={error}
    >
      {/* add form */}
      <div className="flex flex-col gap-1.5 rounded-md border border-cyan-400/15 bg-cyan-400/[0.03] p-2">
        <div className="flex gap-1.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Remind me to…"
            aria-label="Reminder title"
            className="h-9 flex-1 border-cyan-400/25 bg-transparent font-mono text-xs"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Add reminder"
            onClick={() => void add()}
            disabled={!title.trim() || !fireAt}
            className="size-9 shrink-0 rounded bg-cyan-500/90 text-[#02181d] hover:bg-cyan-400"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <Input
          type="datetime-local"
          value={fireAt}
          onChange={(e) => setFireAt(e.target.value)}
          aria-label="Fire time"
          className="h-8 border-cyan-400/20 bg-transparent font-mono text-[11px] text-cyan-100/80"
        />
      </div>

      {/* list */}
      {sorted.length === 0 ? (
        <EmptyHint>No reminders scheduled. Try &quot;remind me in 20 minutes to stretch&quot;.</EmptyHint>
      ) : (
        <ul className="hud-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {sorted.map((r) => {
            const overdue =
              r.status === "scheduled" && new Date(r.fireAt).getTime() < Date.now();
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2 py-2",
                  overdue
                    ? "border-amber-300/40 bg-amber-400/[0.06]"
                    : "border-cyan-400/15 bg-cyan-400/[0.03]"
                )}
              >
                <BellRing
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    overdue ? "text-amber-300" : "text-cyan-400/70"
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs leading-snug text-cyan-50/90">
                    {r.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-widest">
                    <span className={cn("text-muted-foreground", overdue && "text-amber-300")}>
                      {formatDateTime(r.fireAt)}
                    </span>
                    <span
                      className={cn(
                        r.status === "scheduled"
                          ? overdue
                            ? "text-amber-300"
                            : "text-cyan-300"
                          : "text-muted-foreground"
                      )}
                    >
                      {r.status === "scheduled" ? timeAgo(r.fireAt) : r.status}
                    </span>
                  </div>
                </div>
                {r.status === "scheduled" && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Mark done: ${r.title}`}
                      onClick={() => void patch(r.id, "done")}
                      className="size-7 shrink-0 text-muted-foreground hover:text-teal-300"
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Cancel reminder: ${r.title}`}
                      onClick={() => void patch(r.id, "cancelled")}
                      className="size-7 shrink-0 text-muted-foreground hover:text-amber-300"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete reminder: ${r.title}`}
                  onClick={() => void remove(r.id)}
                  className="size-7 shrink-0 text-muted-foreground hover:text-red-300"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
