"use client";

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY panel — long-term facts CRUD against /api/memory. Debounced search
// hits GET /api/memory?q=… ; cards show key chip, value, kind badge, relative
// created time, delete.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Plus, Search, Trash2 } from "lucide-react";
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
import type { MemoryFactDTO } from "@/lib/jarvis/types";
import { asArray, fetchJson, timeAgo } from "@/lib/jarvis/client/ui-helpers";
import { EmptyHint, PanelShell } from "@/components/jarvis/panel-shell";

const KINDS: MemoryFactDTO["kind"][] = ["fact", "preference", "project", "person"];

export function MemoryPanel() {
  const memories = useJarvisStore((s) => s.memories);
  const setMemories = useJarvisStore((s) => s.setMemories);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<MemoryFactDTO["kind"]>("fact");
  const debounceRef = useRef<number | null>(null);

  const fetchMemories = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      const url = q
        ? `/api/memory?q=${encodeURIComponent(q)}`
        : "/api/memory";
      const { data, error: err } = await fetchJson<unknown>(url);
      if (err) setError(err);
      setMemories(asArray<MemoryFactDTO>(data, ["facts", "memories"]));
      setLoading(false);
    },
    [setMemories]
  );

  useEffect(() => {
    // one-shot mount fetch — intentional effect (backend may 404 while 2-b lands)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMemories("");
  }, [fetchMemories]);

  // debounced search
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void fetchMemories(query.trim());
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, fetchMemories]);

  const add = async () => {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v) return;
    const { error: err } = await fetchJson("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: k, value: v, kind }),
    });
    if (err) setError(err);
    setKey("");
    setValue("");
    void fetchMemories(query.trim());
  };

  const remove = async (id: string) => {
    const { error: err } = await fetchJson(
      `/api/memory?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (err) setError(err);
    void fetchMemories(query.trim());
  };

  return (
    <PanelShell
      title="Memory lattice"
      count={memories.length}
      onRefresh={() => void fetchMemories(query.trim())}
      refreshing={loading}
      error={error}
    >
      {/* search */}
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories…"
          aria-label="Search memory"
          className="h-9 border-cyan-400/25 bg-transparent pl-8 font-mono text-xs"
        />
      </div>

      {/* add form */}
      <div className="flex flex-col gap-1.5 rounded-md border border-cyan-400/15 bg-cyan-400/[0.03] p-2">
        <div className="flex gap-1.5">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="key (e.g. exam.date)"
            aria-label="Memory key"
            className="h-9 flex-1 border-cyan-400/25 bg-transparent font-mono text-xs"
          />
          <Select value={kind} onValueChange={(v) => setKind(v as MemoryFactDTO["kind"])}>
            <SelectTrigger
              size="sm"
              aria-label="Memory kind"
              className="h-9 w-[104px] shrink-0 border-cyan-400/25 bg-transparent px-2 font-mono text-[10px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1.5">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="value…"
            aria-label="Memory value"
            className="h-9 flex-1 border-cyan-400/25 bg-transparent font-mono text-xs"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Save memory"
            onClick={() => void add()}
            disabled={!key.trim() || !value.trim()}
            className="size-9 shrink-0 rounded bg-cyan-500/90 text-[#02181d] hover:bg-cyan-400"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* cards */}
      {memories.length === 0 ? (
        <EmptyHint>
          Memory empty. Say &quot;remember my exam is on Friday&quot; or teach a fact above.
        </EmptyHint>
      ) : (
        <ul className="hud-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {memories.map((f) => (
            <li
              key={f.id}
              className="flex items-start gap-2 rounded-md border border-cyan-400/15 bg-cyan-400/[0.03] px-2 py-2"
            >
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-cyan-400/70" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-px font-mono text-[10px] text-cyan-200">
                    {f.key}
                  </span>
                  <span className="rounded border border-teal-400/30 px-1 py-px font-mono text-[9px] uppercase tracking-widest text-teal-300">
                    {f.kind}
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {timeAgo(f.createdAt)}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs leading-snug text-cyan-50/90">
                  {f.value}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Forget ${f.key}`}
                onClick={() => void remove(f.id)}
                className="size-7 shrink-0 text-muted-foreground hover:text-red-300"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
