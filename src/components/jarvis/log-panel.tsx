"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LOG panel — activity feed: GET /api/log?limit=100 merged with client-pushed
// store logs (dedup by id), color-coded dots by kind, relative timestamps.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { EventLogDTO } from "@/lib/jarvis/types";
import { asArray, fetchJson, timeAgo } from "@/lib/jarvis/client/ui-helpers";
import { EmptyHint, PanelShell } from "@/components/jarvis/panel-shell";
import { cn } from "@/lib/utils";

const KIND_DOT: Record<EventLogDTO["kind"], string> = {
  info: "bg-cyan-400/70",
  success: "bg-teal-300",
  warning: "bg-amber-300",
  error: "bg-red-400",
  system: "bg-cyan-200/40",
};

const KIND_TEXT: Record<EventLogDTO["kind"], string> = {
  info: "text-cyan-100/80",
  success: "text-teal-100/90",
  warning: "text-amber-100/90",
  error: "text-red-200/90",
  system: "text-muted-foreground",
};

export function LogPanel() {
  const storeLogs = useJarvisStore((s) => s.logs);
  const [remote, setRemote] = useState<EventLogDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchJson<unknown>("/api/log?limit=100");
    if (err) setError(err);
    setRemote(asArray<EventLogDTO>(data, ["logs", "events"]));
    setLoading(false);
  }, []);

  useEffect(() => {
    // one-shot mount fetch — intentional effect (backend may 404 while 2-b lands)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const merged = useMemo<EventLogDTO[]>(() => {
    const byId = new Map<string, EventLogDTO>();
    for (const l of [...remote, ...storeLogs]) {
      if (!byId.has(l.id)) byId.set(l.id, l);
    }
    return [...byId.values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 120);
  }, [remote, storeLogs]);

  return (
    <PanelShell
      title="Activity log"
      count={merged.length}
      onRefresh={() => void refresh()}
      refreshing={loading}
      error={error}
    >
      {merged.length === 0 ? (
        <EmptyHint>Log empty — activity from the core will stream here.</EmptyHint>
      ) : (
        <ul className="hud-scroll max-h-96 space-y-1 overflow-y-auto pr-1">
          {merged.map((l) => (
            <li
              key={l.id}
              className="flex items-start gap-2 rounded px-1.5 py-1 font-mono text-[11px] leading-snug hover:bg-cyan-400/5"
            >
              <span
                aria-hidden="true"
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", KIND_DOT[l.kind] ?? KIND_DOT.info)}
              />
              <span className={cn("min-w-0 flex-1 break-words", KIND_TEXT[l.kind] ?? KIND_TEXT.info)}>
                {l.message}
              </span>
              <span className="shrink-0 pt-px text-[9px] tabular-nums text-muted-foreground">
                {timeAgo(l.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
