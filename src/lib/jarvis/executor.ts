// ─────────────────────────────────────────────────────────────────────────────
// executor.ts — single execution funnel: runs tool intents (rule or LLM
// sourced) against the database / telemetry and composes persona replies.
// Backend only.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import type {
  ChatAction,
  Emotion,
  PanelId,
  SettingsDTO,
  TelemetrySnapshot,
  ToolResultData,
} from "./types";
import { parseWhen } from "./nlu";
import {
  formatDuration,
  logEvent,
  memoryKeyFrom,
  summarizeTelemetry,
  toMemoryDTO,
  toReminderDTO,
  toTaskDTO,
  upsertMemory,
} from "./server-utils";

export interface ExecContext {
  settings: SettingsDTO;
  telemetry?: TelemetrySnapshot;
  clientTime: Date;
  timezone?: string;
  heard: string;
}

export interface ExecOutcome {
  reply: string;
  actions: ChatAction[];
  data: ToolResultData | null;
  /** extra note surfaced in the intent trace */
  note?: string;
}

const VOICE = (persona: SettingsDTO["persona"]) =>
  persona === "friday"
    ? {
        ack: "Done",
        open: "Opening",
        set: "Set",
      }
    : {
        ack: "Very good",
        open: "Opening",
        set: "Set",
      };

function fmtWhen(date: Date, timezone?: string): string {
  try {
    return date.toLocaleString("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
      hour12: false,
    });
  } catch {
    return date.toUTCString().slice(0, 22);
  }
}

export async function executeIntent(
  intent: string,
  args: Record<string, string>,
  ctx: ExecContext
): Promise<ExecOutcome> {
  const v = VOICE(ctx.settings.persona);
  const you = ctx.settings.userName;

  switch (intent) {
    // ── conversation-level ────────────────────────────────────────────────
    case "greeting": {
      const h = ctx.clientTime.getHours();
      const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
      return {
        reply:
          ctx.settings.persona === "friday"
            ? `${part}, ${you}! Systems are green — what are we doing?`
            : `${part}, ${you}. All systems are online and awaiting your instructions.`,
        actions: [],
        data: null,
      };
    }
    case "time": {
      const now = new Date();
      return {
        reply: `It is ${fmtWhen(now, ctx.timezone).split(", ").slice(1).join(", ")} ${you ? ", " + you : ""}.`,
        actions: [],
        data: null,
      };
    }
    case "date": {
      const now = new Date();
      const d = ctx.timezone
        ? now.toLocaleDateString("en-GB", { timeZone: ctx.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : now.toDateString();
      return { reply: `Today is ${d}.`, actions: [], data: null };
    }

    // ── telemetry ─────────────────────────────────────────────────────────
    case "system_status":
    case "battery_query":
    case "network_query":
    case "storage_query": {
      const summary = summarizeTelemetry(ctx.telemetry, ctx.timezone);
      let lines = summary;
      if (intent === "battery_query" && ctx.telemetry?.battery) {
        const b = ctx.telemetry.battery;
        lines = [
          `Battery ${Math.round(b.level * 100)}% ${b.charging ? "charging" : "discharging"}`,
          b.charging && b.chargingTime && isFinite(b.chargingTime) ? `Full in ${formatDuration(b.chargingTime)}` : "",
          b.level <= 0.2 && !b.charging ? "Warning: low battery — consider plugging in." : "",
        ].filter(Boolean);
      }
      if (intent === "network_query" && ctx.telemetry?.network) {
        const n = ctx.telemetry.network;
        lines = [
          `Connection ${n.online ? "online" : "offline"}`,
          n.effectiveType ? `Type ${n.effectiveType}` : "",
          n.downlink ? `~${n.downlink} Mb/s downlink` : "",
          n.rtt ? `${n.rtt} ms round-trip` : "",
        ].filter(Boolean);
      }
      if (intent === "storage_query" && ctx.telemetry?.storage) {
        const s = ctx.telemetry.storage;
        const pct = s.quota ? Math.round((s.usage / s.quota) * 100) : 0;
        lines = [`${pct}% of the browser storage quota in use`];
      }
      const reply = lines[0] ? `${lines[0]}.` : "The telemetry bus hasn't reported yet — keep the console open a moment.";
      return {
        reply,
        actions: [{ type: "openPanel", payload: "system" }],
        data: { kind: "system", telemetry: ctx.telemetry ?? {}, summary: lines },
      };
    }

    // ── tasks ─────────────────────────────────────────────────────────────
    case "task_add": {
      const title = (args.title ?? "").trim();
      if (!title) return { reply: "What should the task say, exactly?", actions: [], data: null };
      const priority = ["low", "normal", "high"].includes(args.priority) ? args.priority : "normal";
      const dueAt = args.dueAt ? new Date(args.dueAt) : null;
      const task = await db.task.create({
        data: {
          title: title.slice(0, 200),
          priority,
          project: args.project?.slice(0, 80) || null,
          dueAt: dueAt && !isNaN(dueAt.getTime()) ? dueAt : null,
        },
      });
      await logEvent("info", `Task added: ${task.title}`);
      const tasks = (await db.task.findMany({ orderBy: { updatedAt: "desc" }, take: 25 })).map(toTaskDTO);
      return {
        reply: `${v.ack} — task logged: "${task.title}"${task.dueAt ? `, due ${fmtWhen(task.dueAt, ctx.timezone)}` : ""}.`,
        actions: [{ type: "openPanel", payload: "tasks" }],
        data: { kind: "tasks", tasks },
      };
    }
    case "task_list": {
      const tasks = (await db.task.findMany({ orderBy: { updatedAt: "desc" }, take: 25 })).map(toTaskDTO);
      const open = tasks.filter((t) => t.status !== "done");
      return {
        reply: open.length
          ? `You have ${open.length} open task${open.length === 1 ? "" : "s"}, led by "${open[0].title}".`
          : `Your board is clear, ${you}. Satisfaction guaranteed.`,
        actions: [{ type: "openPanel", payload: "tasks" }],
        data: { kind: "tasks", tasks },
      };
    }
    case "task_done": {
      const match = (args.match ?? "").trim().toLowerCase();
      const candidates = await db.task.findMany({
        where: { status: { not: "done" } },
        orderBy: { updatedAt: "desc" },
        take: 25,
      });
      const target = match
        ? candidates.find((t) => t.title.toLowerCase().includes(match))
        : candidates[0];
      if (!target) {
        return { reply: "I can't find an open task matching that. Nothing was changed.", actions: [], data: null };
      }
      await db.task.update({ where: { id: target.id }, data: { status: "done" } });
      await logEvent("success", `Task completed: ${target.title}`);
      const tasks = (await db.task.findMany({ orderBy: { updatedAt: "desc" }, take: 25 })).map(toTaskDTO);
      return {
        reply: `Marked "${target.title}" as done. Well handled.`,
        actions: [{ type: "openPanel", payload: "tasks" }],
        data: { kind: "tasks", tasks },
      };
    }

    // ── reminders ─────────────────────────────────────────────────────────
    case "reminder_set": {
      let fireAt: Date | null = args.fireAt ? new Date(args.fireAt) : null;
      let title = (args.title ?? "").trim();
      if (!fireAt || isNaN(fireAt.getTime())) {
        const when = parseWhen(ctx.heard, ctx.clientTime);
        fireAt = when.fireAt;
        if (!title) title = when.title;
      }
      if (!fireAt || isNaN(fireAt.getTime())) {
        return {
          reply: "When should that reminder fire? Say something like 'in 20 minutes' or 'at 5pm'.",
          actions: [],
          data: null,
          note: "reminder without a parseable time",
        };
      }
      if (fireAt.getTime() < ctx.clientTime.getTime() - 1000) {
        fireAt = new Date(ctx.clientTime.getTime() + 60_000);
      }
      if (!title) title = "Reminder";
      const r = await db.reminder.create({ data: { title: title.slice(0, 200), fireAt } });
      await logEvent("info", `Reminder set: ${r.title} at ${r.fireAt.toISOString()}`);
      const reminders = (await db.reminder.findMany({ orderBy: { fireAt: "asc" }, take: 30 })).map(toReminderDTO);
      return {
        reply: `${v.set}: "${r.title}" — ${fmtWhen(r.fireAt, ctx.timezone)}${args.repeat ? ` (repeats: ${args.repeat})` : ""}.`,
        actions: [{ type: "openPanel", payload: "reminders" }],
        data: { kind: "reminders", reminders },
      };
    }
    case "reminder_list": {
      const reminders = (await db.reminder.findMany({ orderBy: { fireAt: "asc" }, take: 30 })).map(toReminderDTO);
      const scheduled = reminders.filter((r) => r.status === "scheduled");
      return {
        reply: scheduled.length
          ? `${scheduled.length} reminder${scheduled.length === 1 ? "" : "s"} pending — next is "${scheduled[0].title}" at ${fmtWhen(new Date(scheduled[0].fireAt), ctx.timezone)}.`
          : `No reminders pending, ${you}.`,
        actions: [{ type: "openPanel", payload: "reminders" }],
        data: { kind: "reminders", reminders },
      };
    }

    // ── memory ────────────────────────────────────────────────────────────
    case "memory_remember": {
      const value = (args.value ?? "").trim();
      if (!value) return { reply: "What exactly should I remember?", actions: [], data: null };
      const key = (args.key ?? memoryKeyFrom(value)).slice(0, 64);
      const fact = await upsertMemory(key, value, "fact", ctx.heard.slice(0, 200));
      await logEvent("info", `Learned: ${fact.key} = ${fact.value}`);
      return {
        reply: `Noted, ${you} — I'll remember that${ctx.settings.persona === "jarvis" ? "." : "!"}`,
        actions: [{ type: "openPanel", payload: "memory" }],
        data: { kind: "memory", facts: [fact] },
      };
    }
    case "memory_recall": {
      const rows = await db.memoryFact.findMany({ orderBy: { updatedAt: "desc" }, take: 30 });
      const facts = rows.map(toMemoryDTO);
      return {
        reply: facts.length
          ? `Here's what I hold in memory: ${facts.slice(0, 5).map((f) => f.value).join("; ")}${facts.length > 5 ? ` — and ${facts.length - 5} more.` : ""}`
          : `Nothing yet, ${you}. Tell me "remember that ..." and it will stick.`,
        actions: [{ type: "openPanel", payload: "memory" }],
        data: { kind: "memory", facts },
      };
    }
    case "memory_forget": {
      const q = (args.value ?? args.key ?? "").trim().toLowerCase();
      if (!q) return { reply: "What should I forget?", actions: [], data: null };
      const rows = await db.memoryFact.findMany({ take: 50 });
      const target =
        rows.find((r) => r.key.toLowerCase().includes(q)) ??
        rows.find((r) => r.value.toLowerCase().includes(q));
      if (!target) {
        return { reply: "I don't hold anything matching that, so there's nothing to forget.", actions: [], data: null };
      }
      await db.memoryFact.delete({ where: { id: target.id } });
      await logEvent("info", `Forgot: ${target.key}`);
      return { reply: `Forgotten: "${target.value}".`, actions: [], data: null };
    }

    // ── UI control ────────────────────────────────────────────────────────
    case "open_panel": {
      const panel = (args.panel ?? "system") as PanelId;
      const valid: PanelId[] = ["system", "tasks", "reminders", "memory", "agent", "log"];
      const p = valid.includes(panel) ? panel : "system";
      return {
        reply: `${v.open} the ${p} panel, ${you}.`,
        actions: [{ type: "openPanel", payload: p }],
        data: null,
      };
    }
    case "clear_chat":
      return { reply: "Conversation cleared. A clean slate, as it were.", actions: [{ type: "clearChat" }], data: null };
    case "mute":
      return { reply: "Silenced. I'll keep my counsel until you unmute me.", actions: [{ type: "toggleMute" }], data: null };
    case "unmute":
      return { reply: "Voice restored.", actions: [{ type: "toggleMute" }], data: null };
    case "voice_start":
      return { reply: "Listening.", actions: [{ type: "toggleVoice" }], data: null };
    case "panic":
      return {
        reply: "Panic protocol engaged — all automation paused until you say 'resume'.",
        actions: [{ type: "panic" }, { type: "sound", payload: "alert" }],
        data: null,
      };
    case "resume":
      return { reply: "Resuming normal operations.", actions: [{ type: "resume" }], data: null };

    // ── meta ──────────────────────────────────────────────────────────────
    case "identity":
      return {
        reply:
          ctx.settings.persona === "friday"
            ? `FRIDAY — brisk, warm, and at your service. I'm the web evolution of the desktop JARVIS: local rules first, language core second, and I never act on a request I'm not sure about.`
            : `I am J.A.R.V.I.S. — a web-based evolution of the desktop assistant. I resolve what I can locally, consult my language core when needed, remember what matters, and I do not act on ambiguous commands without asking.`,
        actions: [],
        data: null,
      };
    case "help":
      return {
        reply:
          "At your service: chat naturally (no exact syntax needed), set reminders and tasks, I remember facts you tell me, I read live system telemetry, I can search the web, and I run multi-step agents that verify their own work. Press Ctrl+K for the command palette; draw a circle on screen to clear, V to toggle voice, Z for panic mode.",
        actions: [],
        data: null,
      };
    case "personality_switch": {
      const persona = args.persona === "friday" ? "friday" : "jarvis";
      return {
        reply:
          persona === "friday"
            ? "FRIDAY online — brisk and warm, as requested."
            : "JARVIS back online, sir. Calm and dry, as always.",
        actions: [{ type: "setSetting", payload: `persona=${persona}` }],
        data: null,
      };
    }
    case "set_name": {
      const name = (args.name ?? "").trim();
      if (!name) return { reply: "What shall I call you?", actions: [], data: null };
      return {
        reply: `Very good — I shall call you ${name}.`,
        actions: [{ type: "setSetting", payload: `userName=${name}` }],
        data: null,
      };
    }

    default:
      return {
        reply: "That intent isn't wired into my executor yet.",
        actions: [],
        data: null,
        note: `unhandled intent ${intent}`,
      };
  }
}

// Emotion → micro-adjustment for canned confirmations (kept subtle)
export function emotionPreamble(emotion: Emotion, persona: SettingsDTO["persona"]): string {
  if (emotion === "frustrated") return persona === "friday" ? "Okay — let's fix this fast. " : "Understood — let's resolve this promptly. ";
  if (emotion === "stressed" || emotion === "sad") return "Take a breath — I have this. ";
  if (emotion === "urgent") return "";
  return "";
}
