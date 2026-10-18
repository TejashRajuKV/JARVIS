"use client";

// ─────────────────────────────────────────────────────────────────────────────
// TASKS panel — CRUD against /api/tasks. Status cycling (open → doing → done),
// priority select, delete, add form (title + optional due + project).
// Listens for the "jarvis:new-task" CustomEvent to focus the add input.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Circle,
  CircleDot,
  CircleCheck,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { TaskDTO } from "@/lib/jarvis/types";
import { EV, asArray, fetchJson, formatDateTime } from "@/lib/jarvis/client/ui-helpers";
import { EmptyHint, PanelShell } from "@/components/jarvis/panel-shell";
import { cn } from "@/lib/utils";

const NEXT_STATUS: Record<TaskDTO["status"], TaskDTO["status"]> = {
  open: "doing",
  doing: "done",
  done: "open",
};

export function TasksPanel() {
  const tasks = useJarvisStore((s) => s.tasks);
  const setTasks = useJarvisStore((s) => s.setTasks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchJson<unknown>("/api/tasks");
    if (err) setError(err);
    setTasks(asArray<TaskDTO>(data, ["tasks"]));
    setLoading(false);
  }, [setTasks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // command palette / gestures: "new task" → focus the add form
  useEffect(() => {
    const onNewTask = () => addInputRef.current?.focus();
    window.addEventListener(EV.newTask, onNewTask);
    return () => window.removeEventListener(EV.newTask, onNewTask);
  }, []);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    const body: Record<string, unknown> = { title: t };
    if (due) body.dueAt = new Date(due).toISOString();
    if (project.trim()) body.project = project.trim();
    const { error: err } = await fetchJson("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (err) setError(err);
    setTitle("");
    setDue("");
    setProject("");
    void refresh();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const { error: err } = await fetchJson("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (err) setError(err);
    void refresh();
  };

  const remove = async (id: string) => {
    const { error: err } = await fetchJson(
      `/api/tasks?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (err) setError(err);
    void refresh();
  };

  const openCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <PanelShell
      title="Tasks"
      count={openCount}
      onRefresh={() => void refresh()}
      refreshing={loading}
      error={error}
    >
      {/* add form */}
      <div className="flex flex-col gap-1.5 rounded-md border border-cyan-400/15 bg-cyan-400/[0.03] p-2">
        <div className="flex gap-1.5">
          <Input
            ref={addInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="New task…"
            aria-label="Task title"
            className="h-9 flex-1 border-cyan-400/25 bg-transparent font-mono text-xs"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Add task"
            onClick={() => void add()}
            disabled={!title.trim()}
            className="size-9 shrink-0 rounded bg-cyan-500/90 text-[#02181d] hover:bg-cyan-400"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date (optional)"
            className="h-8 flex-1 border-cyan-400/20 bg-transparent font-mono text-[11px] text-cyan-100/80"
          />
          <Input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="Project"
            aria-label="Project (optional)"
            className="h-8 w-24 border-cyan-400/20 bg-transparent font-mono text-[11px]"
          />
        </div>
      </div>

      {/* list */}
      {tasks.length === 0 ? (
        <EmptyHint>No tasks yet, sir. Dictate one or add it above.</EmptyHint>
      ) : (
        <ul className="hud-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {tasks.map((t) => {
            const overdue =
              t.dueAt && t.status !== "done" && new Date(t.dueAt).getTime() < Date.now();
            return (
              <li
                key={t.id}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2 py-2",
                  t.status === "done"
                    ? "border-cyan-400/10 bg-transparent opacity-60"
                    : "border-cyan-400/15 bg-cyan-400/[0.03]"
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Cycle status from ${t.status}`}
                  onClick={() => void patch(t.id, { status: NEXT_STATUS[t.status] })}
                  className="mt-0.5 size-7 shrink-0"
                >
                  {t.status === "open" && (
                    <Circle className="size-4 text-cyan-400/70" aria-hidden="true" />
                  )}
                  {t.status === "doing" && (
                    <CircleDot className="size-4 animate-pulse text-cyan-300" aria-hidden="true" />
                  )}
                  {t.status === "done" && (
                    <CircleCheck className="size-4 text-teal-400" aria-hidden="true" />
                  )}
                </Button>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "break-words text-xs leading-snug text-cyan-50/90",
                      t.status === "done" && "text-muted-foreground line-through"
                    )}
                  >
                    {t.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    {t.project && (
                      <span className="rounded border border-teal-400/30 px-1 py-px text-teal-300">
                        {t.project}
                      </span>
                    )}
                    {t.dueAt && (
                      <span className={cn(overdue && "text-amber-300")}>
                        {formatDateTime(t.dueAt)}
                      </span>
                    )}
                    <span
                      className={cn(t.priority === "high" && "text-amber-300")}
                    >
                      {t.priority}
                    </span>
                  </div>
                </div>
                <Select
                  value={t.priority}
                  onValueChange={(v) => void patch(t.id, { priority: v })}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Priority for ${t.title}`}
                    className="h-7 w-[74px] shrink-0 border-cyan-400/20 bg-transparent px-1.5 font-mono text-[10px] text-muted-foreground"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">low</SelectItem>
                    <SelectItem value="normal">normal</SelectItem>
                    <SelectItem value="high">high</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete task ${t.title}`}
                  onClick={() => void remove(t.id)}
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
