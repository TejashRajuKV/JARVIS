"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Chat panel — the heart of the HUD.
//  • header: arc-core + wordmark + persona chip + voice-state chip
//  • messages: auto-scroll list, user/assistant bubbles, meta chips
//    (intent / route / confidence / emotion), rich ToolResultData cards,
//    clarification buttons, optional "How I understood you" trace
//  • typing reveal animation for the latest assistant message (skip on click)
//  • thinking indicator + empty-state suggestion grid
//  • footer: proactive banner + input bar
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BatteryMedium,
  BellRing,
  Bot,
  ChevronDown,
  CircleCheck,
  Cpu,
  ExternalLink,
  Globe,
  HardDrive,
  ListChecks,
  Wifi,
} from "lucide-react";
import { ArcCore } from "@/components/jarvis/arc-core";
import { InputBar } from "@/components/jarvis/input-bar";
import { ProactiveBanner } from "@/components/jarvis/proactive-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJarvisStore, type ChatMessage } from "@/lib/jarvis/store";
import type { SearchResultItem, ToolResultData } from "@/lib/jarvis/types";
import { parseMessageMeta, sendChatMessage } from "@/lib/jarvis/client/ui-helpers";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What can you do?",
  "System status",
  "Remind me in 20 minutes to stretch",
  "Remember my exam is on Friday",
  "Search today's tech news",
];

const ROUTE_STYLES: Record<string, string> = {
  rule: "border-cyan-400/40 text-cyan-300",
  llm: "border-teal-400/40 text-teal-300",
  tool: "border-amber-400/40 text-amber-300",
  search: "border-teal-400/40 text-teal-300",
  agent: "border-amber-400/40 text-amber-300",
  error: "border-red-400/40 text-red-300",
};

const VOICE_CHIP: Record<string, { label: string; cls: string; dot: string }> = {
  idle: { label: "IDLE", cls: "border-cyan-400/25 text-muted-foreground", dot: "bg-cyan-400/40" },
  listening: { label: "LISTENING", cls: "border-teal-300/50 text-teal-200", dot: "bg-teal-300 animate-pulse" },
  thinking: { label: "THINKING", cls: "border-amber-300/50 text-amber-200", dot: "bg-amber-300 animate-pulse" },
  speaking: { label: "SPEAKING", cls: "border-cyan-300/50 text-cyan-200", dot: "bg-cyan-300 animate-pulse" },
};

function summaryIcon(line: string) {
  const l = line.toLowerCase();
  if (l.includes("batter")) return BatteryMedium;
  if (l.includes("storage") || l.includes("disk") || l.includes("space")) return HardDrive;
  if (l.includes("network") || l.includes("wifi") || l.includes("net") || l.includes("online"))
    return Wifi;
  if (l.includes("cpu") || l.includes("core") || l.includes("memory") || l.includes("device"))
    return Cpu;
  if (l.includes("uptime") || l.includes("fps")) return Activity;
  if (l.includes("reminder")) return BellRing;
  if (l.includes("task")) return ListChecks;
  return ChevronDown;
}

function ToolResultCard({ data }: { data: ToolResultData }) {
  const setActiveRunId = useJarvisStore((s) => s.setActiveRunId);
  const setPanel = useJarvisStore((s) => s.setPanel);

  const cardCls =
    "mt-2 rounded-md border border-cyan-400/15 bg-[#04101a]/70 p-2.5 text-left";

  if (data.kind === "system") {
    return (
      <div className={cardCls}>
        <p className="micro-label mb-1.5 text-cyan-300/70">System readout</p>
        <ul className="space-y-1">
          {data.summary.map((line, i) => {
            const Icon = summaryIcon(line);
            return (
              <li key={i} className="flex items-center gap-2 font-mono text-[11px] text-cyan-100/85">
                <Icon className="size-3 shrink-0 text-cyan-400/70" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{line}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (data.kind === "tasks") {
    return (
      <div className={cardCls}>
        <p className="micro-label mb-1.5 text-cyan-300/70">Tasks</p>
        <ul className="space-y-1">
          {data.tasks.slice(0, 8).map((t) => (
            <li key={t.id} className="flex items-center gap-2 font-mono text-[11px]">
              {t.status === "done" ? (
                <CircleCheck className="size-3 shrink-0 text-teal-400" aria-hidden="true" />
              ) : (
                <ListChecks className="size-3 shrink-0 text-cyan-400/70" aria-hidden="true" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  t.status === "done" && "text-muted-foreground line-through"
                )}
              >
                {t.title}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[9px] uppercase tracking-widest",
                  t.priority === "high" ? "text-amber-300" : "text-muted-foreground"
                )}
              >
                {t.priority}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (data.kind === "reminders") {
    return (
      <div className={cardCls}>
        <p className="micro-label mb-1.5 text-cyan-300/70">Reminders</p>
        <ul className="space-y-1">
          {data.reminders.slice(0, 8).map((r) => (
            <li key={r.id} className="flex items-center gap-2 font-mono text-[11px]">
              <BellRing className="size-3 shrink-0 text-cyan-400/70" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="shrink-0 text-muted-foreground">
                {new Date(r.fireAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (data.kind === "memory") {
    return (
      <div className={cardCls}>
        <p className="micro-label mb-1.5 text-cyan-300/70">Memory</p>
        <div className="flex flex-wrap gap-1.5">
          {data.facts.slice(0, 12).map((f) => (
            <span
              key={f.id}
              className="rounded border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-100"
            >
              <span className="text-cyan-300">{f.key}</span> · {f.value}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (data.kind === "search") {
    return (
      <div className={cardCls}>
        <p className="micro-label mb-1.5 text-cyan-300/70">
          Web results · {data.query}
        </p>
        <ul className="space-y-2">
          {data.results.slice(0, 5).map((r: SearchResultItem, i: number) => (
            <li key={`${r.url}-${i}`}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded px-1.5 py-1 transition-colors hover:bg-cyan-400/5"
              >
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-cyan-200 underline-offset-2 group-hover:underline">
                  {r.name}
                  <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                </span>
                <span className="block font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  {r.host_name}
                </span>
                <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-cyan-100/70">
                  {r.snippet}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // kind === "agent"
  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-amber-300" aria-hidden="true" />
        <p className="micro-label flex-1 text-amber-300/80">Agent mission launched</p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setActiveRunId(data.runId);
          setPanel("agent");
        }}
        className="mt-2 h-8 w-full rounded border border-amber-300/40 bg-amber-400/10 font-mono text-[10px] tracking-[0.2em] text-amber-200 hover:bg-amber-300/20"
      >
        OPEN AGENT PANEL
      </Button>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const updateMessage = useJarvisStore((s) => s.updateMessage);
  const showIntentTrace = useJarvisStore((s) => s.settings.showIntentTrace);
  const meta = useMemo(() => parseMessageMeta(message.meta), [message.meta]);

  if (message.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="flex justify-end"
      >
        <div
          className={cn(
            "max-w-[85%] rounded-lg rounded-br-sm border border-amber-300/30 bg-amber-400/[0.06] px-3 py-2 text-sm leading-relaxed text-amber-50/90",
            message.pending && "opacity-60"
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </motion.div>
    );
  }

  const len = message.content.length;
  const revealed = Math.min(message.revealed ?? len, len);
  const isTyping = revealed < len;
  const shown = isTyping ? message.content.slice(0, revealed) : message.content;
  const route = message.route ?? "rule";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex justify-start"
    >
      <div className="max-w-[92%] rounded-lg rounded-bl-sm border border-cyan-400/25 bg-cyan-400/[0.04] px-3 py-2 shadow-[0_0_14px_rgba(34,211,238,0.05)]">
        {message.intent && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-cyan-300">
              {message.intent}
            </span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em]",
                ROUTE_STYLES[route] ?? ROUTE_STYLES.rule
              )}
            >
              {route}
            </span>
            {typeof message.confidence === "number" && message.confidence > 0 && (
              <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                {Math.round(message.confidence * 100)}%
              </span>
            )}
            {message.emotion && message.emotion !== "neutral" && (
              <Badge
                variant="outline"
                className="border-amber-300/40 px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.15em] text-amber-300"
              >
                {message.emotion}
              </Badge>
            )}
          </div>
        )}

        <p
          role={isTyping ? "status" : undefined}
          onClick={() => isTyping && updateMessage(message.id, { revealed: len })}
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-relaxed text-cyan-50/90",
            isTyping && "hud-caret cursor-pointer"
          )}
        >
          {shown}
        </p>

        {meta?.data && <ToolResultCard data={meta.data} />}

        {meta?.clarify && (
          <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-400/[0.05] p-2.5">
            <p className="text-xs text-amber-100/90">{meta.clarify.question}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meta.clarify.options
                .filter((o) => !/^(yes|no)$/i.test(o.trim()))
                .map((opt) => (
                  <Button
                    key={opt}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void sendChatMessage(opt)}
                    className="h-8 rounded border-amber-300/40 px-2.5 font-mono text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-300/15"
                  >
                    {opt}
                  </Button>
                ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void sendChatMessage("Yes")}
                className="h-8 rounded border-cyan-400/40 px-2.5 font-mono text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/15"
              >
                Yes
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void sendChatMessage("No")}
                className="h-8 rounded border-cyan-400/40 px-2.5 font-mono text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/15"
              >
                No
              </Button>
            </div>
          </div>
        )}

        {showIntentTrace && meta?.trace && (
          <details className="group mt-2 rounded border border-cyan-400/15 bg-[#04101a]/60">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-cyan-300">
              How I understood you
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <dl className="space-y-1 border-t border-cyan-400/10 px-2 py-2 font-mono text-[10px] text-cyan-100/75">
              {meta.heard && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-muted-foreground">HEARD</dt>
                  <dd className="min-w-0 break-words">{meta.heard}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">DECISION</dt>
                <dd className="min-w-0 break-words">{meta.trace.decision}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">MODE</dt>
                <dd>{meta.trace.localVsOnline}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">LATENCY</dt>
                <dd>{meta.trace.latencyMs} ms</dd>
              </div>
              {meta.corrections && meta.corrections.length > 0 && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-muted-foreground">FIXED</dt>
                  <dd className="min-w-0 break-words text-amber-200/80">
                    {meta.corrections.join(" · ")}
                  </dd>
                </div>
              )}
            </dl>
          </details>
        )}
      </div>
    </motion.div>
  );
}

function ThinkingRow() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex justify-start"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 rounded-lg rounded-bl-sm border border-cyan-400/20 bg-cyan-400/[0.03] px-3 py-2.5">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pulse rounded-full bg-cyan-300"
              style={{ animationDelay: `${i * 220}ms` }}
            />
          ))}
        </span>
        <span className="micro-label text-cyan-300/70">Processing</span>
      </div>
    </motion.div>
  );
}

export function ChatPanel() {
  const messages = useJarvisStore((s) => s.messages);
  const busy = useJarvisStore((s) => s.busy);
  const persona = useJarvisStore((s) => s.settings.persona);
  const voiceState = useJarvisStore((s) => s.voiceState);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // live interim transcript from the voice engine (workstream B)
  useEffect(() => {
    const onInterim = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text ?? "";
      setInput(text);
    };
    window.addEventListener("jarvis:interim", onInterim);
    return () => window.removeEventListener("jarvis:interim", onInterim);
  }, []);

  // auto-scroll on new messages / busy toggle
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // typing reveal for the latest not-fully-revealed assistant message
  const revealingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && (m.revealed ?? 0) < m.content.length) return m.id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!revealingId) return;
    const id = window.setInterval(() => {
      const s = useJarvisStore.getState();
      const m = s.messages.find((x) => x.id === revealingId);
      if (!m) return;
      const step = Math.max(2, Math.ceil(m.content.length / 80));
      const next = Math.min(m.content.length, (m.revealed ?? 0) + step);
      s.updateMessage(m.id, { revealed: next });
      if (next >= m.content.length) window.clearInterval(id);
    }, 28);
    return () => window.clearInterval(id);
  }, [revealingId]);

  const handleSend = useCallback((text: string) => {
    setInput("");
    void sendChatMessage(text);
  }, []);

  const voiceChip = VOICE_CHIP[voiceState] ?? VOICE_CHIP.idle;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-cyan-400/15 px-3 py-3 sm:px-4">
        <ArcCore size={64} className="hidden sm:block" />
        <ArcCore size={48} className="sm:hidden" />
        <div className="min-w-0">
          <h2 className="hud-glow-text font-mono text-sm font-semibold tracking-[0.35em] text-cyan-200">
            J.A.R.V.I.S.
          </h2>
          <p className="micro-label mt-0.5 hidden sm:block">
            Just A Rather Very Intelligent System
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="rounded border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-teal-300">
            {persona}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em]",
              voiceChip.cls
            )}
            role="status"
            aria-label={`Voice state: ${voiceState}`}
          >
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", voiceChip.dot)} />
            <span className="hidden sm:inline">{voiceChip.label}</span>
          </span>
        </div>
      </header>

      {/* messages */}
      <div
        ref={scrollRef}
        className="hud-scroll min-h-[45vh] flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4 lg:min-h-0"
      >
        {messages.length === 0 && !busy ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
            <div className="text-center">
              <p className="hud-glow-text font-mono text-sm tracking-[0.3em] text-cyan-200">
                SYSTEMS ONLINE
              </p>
              <p className="micro-label mt-2">
                Natural language in — no syntax required
              </p>
            </div>
            <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s, i) => (
                <motion.button
                  key={s}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 * i, duration: 0.25 }}
                  onClick={() => setInput(s)}
                  className={cn(
                    "min-h-11 rounded-md border border-cyan-400/20 bg-cyan-400/[0.03] px-3 py-2 text-left font-mono text-[11px] text-cyan-100/80 transition-colors hover:border-cyan-300/40 hover:bg-cyan-400/10 hover:text-cyan-100",
                    i === SUGGESTIONS.length - 1 && "sm:col-span-2"
                  )}
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
            {busy && <ThinkingRow />}
          </>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-cyan-400/15 p-3">
        <ProactiveBanner />
        <InputBar value={input} onChange={setInput} onSend={handleSend} disabled={busy} />
      </div>
    </div>
  );
}
