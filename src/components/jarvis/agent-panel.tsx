"use client";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT panel — multi-step agent runs: goal → POST /api/agent/run, poll
// GET /api/agent/run?id= every 1200ms while planning/running, timeline of
// steps with per-status icons, verification/recovery notes, final report,
// cancel, and run history.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Circle,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Square,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { AgentPlanStep, AgentRunDTO, AgentStepDTO } from "@/lib/jarvis/types";
import {
  asArray,
  fetchJson,
  normalizeAgentRun,
  playSound,
  timeAgo,
} from "@/lib/jarvis/client/ui-helpers";
import { EmptyHint, PanelShell } from "@/components/jarvis/panel-shell";
import { cn } from "@/lib/utils";

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "PLANNING", cls: "border-amber-300/40 text-amber-300" },
  running: { label: "RUNNING", cls: "border-cyan-300/50 text-cyan-300" },
  done: { label: "DONE", cls: "border-teal-300/50 text-teal-300" },
  failed: { label: "FAILED", cls: "border-red-400/50 text-red-300" },
  cancelled: { label: "CANCELLED", cls: "border-cyan-400/20 text-muted-foreground" },
};

function StepStatusIcon({ status }: { status: AgentStepDTO["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-300" aria-hidden="true" />;
    case "verified":
      return <ShieldCheck className="size-3.5 shrink-0 text-teal-300" aria-hidden="true" />;
    case "failed":
      return <XCircle className="size-3.5 shrink-0 text-red-400" aria-hidden="true" />;
    case "recovered":
      return <RefreshCw className="size-3.5 shrink-0 text-amber-300" aria-hidden="true" />;
    case "skipped":
      return <SkipForward className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
    default:
      return <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}

const STEP_TONE: Record<AgentStepDTO["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-cyan-100",
  verified: "text-cyan-50",
  failed: "text-red-200",
  recovered: "text-amber-100",
  skipped: "text-muted-foreground",
};

export function AgentPanel() {
  const activeRunId = useJarvisStore((s) => s.activeRunId);
  const setActiveRunId = useJarvisStore((s) => s.setActiveRunId);
  const activeRun = useJarvisStore((s) => s.activeRun);
  const setActiveRun = useJarvisStore((s) => s.setActiveRun);
  const setPanel = useJarvisStore((s) => s.setPanel);

  const [goal, setGoal] = useState("");
  const [engaging, setEngaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AgentRunDTO[]>([]);
  const prevStatusRef = useRef<string | null>(null);

  const fetchRun = useCallback(
    async (id: string) => {
      const { data, error: err } = await fetchJson<unknown>(
        `/api/agent/run?id=${encodeURIComponent(id)}`
      );
      if (err) setError(err);
      const run = normalizeAgentRun(data);
      if (run) setActiveRun(run);
      return run;
    },
    [setActiveRun]
  );

  const fetchHistory = useCallback(async () => {
    const { data, error: err } = await fetchJson<unknown>("/api/agent/run");
    if (err) return; // history is best-effort
    setHistory(asArray<AgentRunDTO>(data, ["runs", "history"]));
  }, []);

  useEffect(() => {
    // one-shot mount fetch — intentional effect (backend may 404 while 2-b lands)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchHistory();
  }, [fetchHistory]);

  // load run referenced from chat tool cards / history clicks
  useEffect(() => {
    // intentional: fetch on demand when a run id is selected
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeRunId) void fetchRun(activeRunId);
  }, [activeRunId, fetchRun]);

  // completion sounds
  useEffect(() => {
    const st = activeRun?.status ?? null;
    if (st && prevStatusRef.current && prevStatusRef.current !== st) {
      if (st === "done") playSound("success");
      else if (st === "failed") playSound("error");
    }
    prevStatusRef.current = st;
  }, [activeRun?.status]);

  // poll while planning / running
  const runStatus = activeRun?.status;
  useEffect(() => {
    if (!activeRunId || (runStatus !== "planning" && runStatus !== "running")) return;
    const id = window.setInterval(() => {
      void fetchRun(activeRunId).then((run) => {
        if (run && run.status !== "planning" && run.status !== "running") {
          void fetchHistory();
        }
      });
    }, 1200);
    return () => window.clearInterval(id);
  }, [activeRunId, runStatus, fetchRun, fetchHistory]);

  const engage = async () => {
    const g = goal.trim();
    if (!g) return;
    setEngaging(true);
    setError(null);
    const { data, error: err } = await fetchJson<unknown>("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: g }),
    });
    setEngaging(false);
    if (err) {
      setError(err);
      playSound("error");
      return;
    }
    const run = normalizeAgentRun(data);
    if (run) {
      setActiveRunId(run.id);
      setActiveRun(run);
      setGoal("");
      playSound("receive");
      void fetchHistory();
    }
  };

  const cancel = async () => {
    if (!activeRunId) return;
    const { error: err } = await fetchJson("/api/agent/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeRunId }),
    });
    if (err) setError(err);
    void fetchRun(activeRunId);
  };

  const planSteps = useMemo<AgentPlanStep[]>(() => {
    if (!activeRun?.plan) return [];
    try {
      const parsed: unknown = JSON.parse(activeRun.plan);
      return Array.isArray(parsed) ? (parsed as AgentPlanStep[]) : [];
    } catch {
      return [];
    }
  }, [activeRun?.plan]);

  const steps = useMemo(
    () => [...(activeRun?.steps ?? [])].sort((a, b) => a.index - b.index),
    [activeRun?.steps]
  );

  const running = runStatus === "planning" || runStatus === "running";
  const statusChip = runStatus ? RUN_STATUS[runStatus] : null;

  return (
    <PanelShell
      title="Agent subsystem"
      error={error}
      onRefresh={activeRunId ? () => void fetchRun(activeRunId) : undefined}
      refreshing={running}
    >
      {/* goal composer */}
      <div className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.03] p-2">
        <Textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Mission goal — e.g. research the latest AR headsets and summarize the top three…"
          aria-label="Agent goal"
          rows={3}
          className="resize-none border-cyan-400/25 bg-transparent font-mono text-xs focus-visible:ring-cyan-400/25"
        />
        <Button
          type="button"
          onClick={() => void engage()}
          disabled={!goal.trim() || engaging || running}
          className="mt-1.5 h-9 w-full rounded bg-cyan-500/90 font-mono text-[10px] tracking-[0.3em] text-[#02181d] hover:bg-cyan-400"
        >
          {engaging || runStatus === "planning" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Bot className="size-4" aria-hidden="true" />
          )}
          ENGAGE AGENT
        </Button>
      </div>

      {/* active run */}
      {activeRun && (
        <div className="rounded-md border border-cyan-400/15 bg-[#04101a]/70 p-2.5">
          <div className="flex items-center gap-2">
            <Bot className="size-4 shrink-0 text-amber-300" aria-hidden="true" />
            <p className="min-w-0 flex-1 break-words font-mono text-xs text-cyan-50/90">
              {activeRun.goal}
            </p>
            {statusChip && (
              <span
                className={cn(
                  "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.2em]",
                  statusChip.cls
                )}
              >
                {statusChip.label}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Progress
              value={
                activeRun.stepsTotal > 0
                  ? (activeRun.stepsDone / activeRun.stepsTotal) * 100
                  : running
                    ? 15
                    : 0
              }
              aria-label="Agent progress"
              className="h-1 flex-1 bg-cyan-400/10"
            />
            <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
              {activeRun.stepsDone}/{activeRun.stepsTotal || "?"}
            </span>
            {running && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void cancel()}
                className="h-7 shrink-0 rounded border-red-400/40 px-2 font-mono text-[9px] tracking-widest text-red-300 hover:bg-red-400/10"
              >
                <Square className="size-3" aria-hidden="true" /> CANCEL
              </Button>
            )}
          </div>

          {/* plan */}
          {planSteps.length > 0 && (
            <div className="mt-2.5">
              <p className="micro-label mb-1 text-cyan-300/70">Plan</p>
              <ol className="space-y-0.5">
                {planSteps.map((p, i) => (
                  <li key={i} className="flex gap-2 font-mono text-[10px] leading-relaxed">
                    <span className="shrink-0 text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="text-cyan-300">{p.action}</span>
                      <span className="text-cyan-100/80"> — {p.input}</span>
                      {p.why && (
                        <span className="block text-muted-foreground">↳ {p.why}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* steps timeline */}
          {steps.length > 0 && (
            <div className="mt-2.5">
              <p className="micro-label mb-1 text-cyan-300/70">Execution timeline</p>
              <ul className="space-y-1.5 border-l border-cyan-400/20 pl-3">
                {steps.map((s) => (
                  <li key={s.id} className="relative">
                    <span className="absolute -left-[21px] top-0.5 flex size-4 items-center justify-center rounded-full bg-[#04101a]">
                      <StepStatusIcon status={s.status} />
                    </span>
                    <p
                      className={cn(
                        "font-mono text-[11px] leading-snug",
                        STEP_TONE[s.status]
                      )}
                    >
                      <span className="text-cyan-300">{s.action}</span>
                      <span className="text-cyan-100/70"> · {s.input}</span>
                    </p>
                    {s.note && (
                      <p
                        className={cn(
                          "mt-0.5 font-mono text-[10px] leading-snug",
                          s.status === "failed"
                            ? "text-red-300"
                            : s.status === "recovered"
                              ? "text-amber-300"
                              : "text-teal-300/80"
                        )}
                      >
                        {s.status === "verified" ? "✓ " : s.status === "recovered" ? "↻ " : "! "}
                        {s.note}
                      </p>
                    )}
                    {s.output && (
                      <p className="mt-0.5 line-clamp-2 font-mono text-[10px] leading-snug text-muted-foreground">
                        → {s.output}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* final result */}
          {activeRun.result && (
            <div className="mt-2.5 rounded border border-teal-300/25 bg-teal-400/[0.05] p-2">
              <p className="micro-label mb-1 text-teal-300/80">Final report</p>
              <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-cyan-50/90">
                {activeRun.result}
              </p>
            </div>
          )}
        </div>
      )}

      {/* history */}
      {history.length > 0 ? (
        <div>
          <p className="micro-label mb-1 flex items-center gap-1.5 text-cyan-300/70">
            <History className="size-3" aria-hidden="true" /> Run history
          </p>
          <ul className="hud-scroll max-h-48 space-y-1 overflow-y-auto pr-1">
            {history.map((r) => {
              const chip = RUN_STATUS[r.status] ?? RUN_STATUS.cancelled;
              const active = r.id === activeRunId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveRunId(r.id);
                      setPanel("agent");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors",
                      active
                        ? "border-cyan-300/40 bg-cyan-400/10"
                        : "border-cyan-400/15 bg-cyan-400/[0.02] hover:bg-cyan-400/10"
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1 py-px font-mono text-[8px] tracking-widest",
                        chip.cls
                      )}
                    >
                      {chip.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-cyan-100/80">
                      {r.goal}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      {timeAgo(r.createdAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        !activeRun && (
          <EmptyHint>
            No agent runs yet. Engage the agent with a multi-step goal — it plans,
            executes, verifies each step and self-recovers on failure.
          </EmptyHint>
        )
      )}
    </PanelShell>
  );
}
