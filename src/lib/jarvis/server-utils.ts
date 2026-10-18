// ─────────────────────────────────────────────────────────────────────────────
// server-utils.ts — shared server helpers: settings, event log, memory upsert,
// DTO mappers, safe arithmetic evaluator, telemetry summarization.
// Backend only — never import from client components.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  type EventLogDTO,
  type MemoryFactDTO,
  type ReminderDTO,
  type SettingsDTO,
  type TaskDTO,
  type TelemetrySnapshot,
} from "./types";

// ── Settings ────────────────────────────────────────────────────────────────

const BOOL_KEYS: (keyof SettingsDTO)[] = [
  "voiceEnabled",
  "soundEnabled",
  "wakeWordEnabled",
  "gesturesEnabled",
  "showIntentTrace",
  "dnd",
];

export async function getSettings(): Promise<SettingsDTO> {
  const rows = await db.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged: SettingsDTO = { ...DEFAULT_SETTINGS };
  if (map.persona === "jarvis" || map.persona === "friday") merged.persona = map.persona;
  if (typeof map.userName === "string" && map.userName.length > 0) merged.userName = map.userName;
  for (const k of BOOL_KEYS) {
    if (map[k] === "true") (merged[k] as boolean) = true;
    if (map[k] === "false") (merged[k] as boolean) = false;
  }
  if (map.autonomy === "proactive" || map.autonomy === "standard") {
    merged.autonomy = map.autonomy as SettingsDTO["autonomy"];
  }
  return merged;
}

const SETTING_KEYS = new Set<string>([
  "persona",
  "userName",
  "voiceEnabled",
  "soundEnabled",
  "wakeWordEnabled",
  "gesturesEnabled",
  "showIntentTrace",
  "dnd",
  "autonomy",
]);

export async function setSettingKV(key: string, rawValue: string): Promise<SettingsDTO> {
  if (!SETTING_KEYS.has(key)) throw new Error(`Unknown setting: ${key}`);
  let value = String(rawValue);
  if (BOOL_KEYS.includes(key as keyof SettingsDTO)) {
    value = value === "true" ? "true" : "false";
  }
  if (key === "persona" && value !== "jarvis" && value !== "friday") {
    throw new Error("persona must be jarvis or friday");
  }
  if (key === "autonomy" && value !== "proactive" && value !== "standard") {
    throw new Error("autonomy must be proactive or standard");
  }
  if (key === "userName") {
    value = value.trim().slice(0, 32) || "sir";
  }
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  return getSettings();
}

// ── Event log ───────────────────────────────────────────────────────────────

export async function logEvent(
  kind: "info" | "success" | "warning" | "error" | "system",
  message: string,
  meta?: unknown
): Promise<void> {
  try {
    await db.eventLog.create({
      data: {
        kind,
        message: message.slice(0, 500),
        meta: meta === undefined ? undefined : JSON.stringify(meta).slice(0, 1000),
      },
    });
  } catch {
    // logging must never break the pipeline
  }
}

// ── Memory ──────────────────────────────────────────────────────────────────

export function memoryKeyFrom(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "my", "is", "on", "that", "this", "with"].includes(w))
    .slice(0, 3);
  return words.join("_") || "note";
}

export async function upsertMemory(
  key: string,
  value: string,
  kind: MemoryFactDTO["kind"] = "fact",
  source?: string
): Promise<MemoryFactDTO> {
  const cleanKey = key.toLowerCase().replace(/\s+/g, "_").slice(0, 64);
  const row = await db.memoryFact.upsert({
    where: { key: cleanKey },
    update: { value, kind, source: source ?? undefined },
    create: { key: cleanKey, value, kind, source },
  });
  return toMemoryDTO(row);
}

export function toMemoryDTO(row: {
  id: string;
  key: string;
  value: string;
  kind: string;
  source: string | null;
  createdAt: Date;
}): MemoryFactDTO {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    kind: (["fact", "preference", "project", "person"].includes(row.kind)
      ? row.kind
      : "fact") as MemoryFactDTO["kind"],
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── DTO mappers ─────────────────────────────────────────────────────────────

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  project: string | null;
  dueAt: Date | null;
  createdAt: Date;
};

export function toTaskDTO(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    title: row.title,
    status: (["open", "doing", "done"].includes(row.status) ? row.status : "open") as TaskDTO["status"],
    priority: (["low", "normal", "high"].includes(row.priority) ? row.priority : "normal") as TaskDTO["priority"],
    project: row.project,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

type ReminderRow = {
  id: string;
  title: string;
  fireAt: Date;
  status: string;
  createdAt: Date;
};

export function toReminderDTO(row: ReminderRow): ReminderDTO {
  return {
    id: row.id,
    title: row.title,
    fireAt: row.fireAt.toISOString(),
    status: (["scheduled", "fired", "cancelled", "done"].includes(row.status)
      ? row.status
      : "scheduled") as ReminderDTO["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLogDTO(row: {
  id: string;
  kind: string;
  message: string;
  createdAt: Date;
}): EventLogDTO {
  return {
    id: row.id,
    kind: (["info", "success", "warning", "error", "system"].includes(row.kind)
      ? row.kind
      : "info") as EventLogDTO["kind"],
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Safe arithmetic (agent "calc" tool) — tokenizer + shunting-yard ────────

export function safeCalc(expression: string): { ok: true; value: number } | { ok: false; error: string } {
  const clean = expression.replace(/[^0-9+\-*/().%\s^]/g, "").trim();
  if (!clean) return { ok: false, error: "empty expression" };
  const tokens = clean.match(/(\d+(?:\.\d+)?|[+\-*/()%^])/g);
  if (!tokens) return { ok: false, error: "no tokens" };

  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  const out: (number | string)[] = [];
  const ops: string[] = [];
  let prev: string | null = null;

  for (const tk of tokens) {
    if (/^\d/.test(tk)) {
      out.push(parseFloat(tk));
    } else if (tk === "(") {
      ops.push(tk);
    } else if (tk === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      if (!ops.length) return { ok: false, error: "unbalanced parentheses" };
      ops.pop();
    } else {
      // unary minus
      if (tk === "-" && (prev === null || prev === "(" || (typeof prev === "string" && prec[prev]))) {
        out.push(0);
      }
      while (ops.length && prec[ops[ops.length - 1]] >= prec[tk] && tk !== "^") {
        out.push(ops.pop()!);
      }
      ops.push(tk);
    }
    prev = tk;
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") return { ok: false, error: "unbalanced parentheses" };
    out.push(op);
  }

  const stack: number[] = [];
  for (const tk of out) {
    if (typeof tk === "number") stack.push(tk);
    else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return { ok: false, error: "invalid expression" };
      switch (tk) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": if (b === 0) return { ok: false, error: "division by zero" }; stack.push(a / b); break;
        case "%": stack.push(a % b); break;
        case "^": stack.push(Math.pow(a, b)); break;
        default: return { ok: false, error: `unknown op ${tk}` };
      }
    }
  }
  const result = stack.pop();
  if (result === undefined || !isFinite(result)) return { ok: false, error: "invalid result" };
  return { ok: true, value: result };
}

// ── Telemetry summarization ─────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function summarizeTelemetry(t: TelemetrySnapshot | undefined, timezone?: string): string[] {
  if (!t) return ["Telemetry bus is still warming up — give me a moment."];
  const lines: string[] = [];
  const local = (d: Date) =>
    timezone
      ? d.toLocaleString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
      : d.toISOString().slice(11, 16);

  if (t.battery) {
    lines.push(
      `Battery ${Math.round(t.battery.level * 100)}% — ${
        t.battery.charging
          ? `charging${t.battery.chargingTime && isFinite(t.battery.chargingTime) ? `, full in ${formatDuration(t.battery.chargingTime)}` : ""}`
          : `on battery${t.battery.dischargingTime && isFinite(t.battery.dischargingTime) ? `, ~${formatDuration(t.battery.dischargingTime)} remaining` : ""}`
      }`
    );
  }
  if (t.storage) {
    lines.push(
      `Storage ${formatBytes(t.storage.usage)} used of ${formatBytes(t.storage.quota)} available to this console`
    );
  }
  if (t.network) {
    lines.push(
      `Network ${t.network.online ? "online" : "OFFLINE"}${
        t.network.effectiveType ? ` · ${t.network.effectiveType}` : ""
      }${t.network.downlink ? ` · ~${t.network.downlink} Mb/s` : ""}${t.network.rtt ? ` · ${t.network.rtt} ms RTT` : ""}`
    );
  }
  if (t.device) {
    lines.push(
      `Device ${t.device.cores ? `${t.device.cores} logical cores` : "cores unknown"}${
        t.device.memoryGB ? ` · ~${t.device.memoryGB} GB RAM` : ""
      }${t.device.platform ? ` · ${t.device.platform}` : ""}`
    );
  }
  if (typeof t.fps === "number") lines.push(`Interface ${Math.round(t.fps)} FPS`);
  if (typeof t.uptimeMs === "number") {
    lines.push(`Console uptime ${formatDuration(t.uptimeMs / 1000)} (since ${local(new Date(Date.now() - t.uptimeMs))})`);
  }
  if (lines.length === 0) lines.push("This browser exposes no telemetry APIs — system panel will show what it can.");
  return lines;
}
