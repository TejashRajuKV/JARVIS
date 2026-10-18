"use client";

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Web Console — frontend client helpers (task 2-a).
// Small utilities shared by HUD components:
//   • CustomEvent dispatch helpers (sound / speak / voice / focus contracts)
//   • graceful fetch wrapper (API may 404 while task 2-b builds in parallel)
//   • formatting helpers (clock, durations, bytes, relative time, greeting)
//   • message-meta parsing + the chat send pipeline (optimistic user message,
//     POST /api/chat, assistant message, action processing, TTS dispatch)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AgentRunDTO,
  ChatAction,
  ChatResponse,
  EventLogDTO,
  PanelId,
  SettingsDTO,
  TelemetrySnapshot,
  ToolResultData,
  ChatTrace,
} from "@/lib/jarvis/types";
import { DEFAULT_SETTINGS } from "@/lib/jarvis/types";
import { useJarvisStore } from "@/lib/jarvis/store";

// ── Event contract (task 3 engines consume these) ───────────────────────────

export const EV = {
  sound: "jarvis:sound",
  speak: "jarvis:speak",
  toggleVoice: "jarvis:toggle-voice",
  focusInput: "jarvis:focus-input",
  newTask: "jarvis:new-task",
} as const;

export type SoundName =
  | "boot"
  | "listen-start"
  | "listen-stop"
  | "send"
  | "receive"
  | "alert"
  | "success"
  | "error"
  | "gesture";

export function emit(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function playSound(name: SoundName): void {
  emit(EV.sound, { name });
}

export function speak(text: string, interrupt = false): void {
  emit(EV.speak, { text, interrupt });
}

// ── Network helpers (tolerant to missing / non-JSON APIs) ───────────────────

export interface FetchResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  status: number;
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    let parsed: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null; // non-JSON body (e.g. dev 404 HTML page)
      }
    }
    if (!res.ok) {
      const maybe = parsed as { error?: string } | null;
      return {
        ok: false,
        data: null,
        error: maybe?.error ?? `Request failed (${res.status})`,
        status: res.status,
      };
    }
    if (parsed === null) {
      return {
        ok: false,
        data: null,
        error: "Empty or non-JSON response",
        status: res.status,
      };
    }
    return { ok: true, data: parsed as T, status: res.status };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Network error",
      status: 0,
    };
  }
}

/** Defensive list unwrap: accepts `T[]` or `{ [wrapKey]: T[] }`. */
export function asArray<T>(data: unknown, wrapKeys: string[] = []): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    for (const k of wrapKeys) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export function normalizeAgentRun(data: unknown): AgentRunDTO | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.id === "string" && typeof obj.goal === "string") {
    return data as AgentRunDTO;
  }
  const run = obj.run as AgentRunDTO | undefined;
  if (run && typeof run.id === "string" && typeof run.goal === "string") {
    return run;
  }
  return null;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function timeAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs < 10_000) return diff >= 0 ? "imminent" : "just now";
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diff >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}

export function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.max(1, Math.round(seconds))}s`;
}

export function formatBytes(bytes?: number | null, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(digits)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.round(bytes)} B`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** ISO string → value usable by <input type="datetime-local"> */
export function toLocalInputValue(d: Date): string {
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ── Message meta parsing ────────────────────────────────────────────────────

export interface MessageMeta {
  heard?: string;
  corrections?: string[];
  trace?: ChatTrace | null;
  data?: ToolResultData | null;
  clarify?: { question: string; options: string[] } | null;
}

export function parseMessageMeta(meta?: string | null): MessageMeta | null {
  if (!meta) return null;
  try {
    const v: unknown = JSON.parse(meta);
    if (v && typeof v === "object") return v as MessageMeta;
    return null;
  } catch {
    return null;
  }
}

// ── Client context for the brain ────────────────────────────────────────────

export function buildClientContext(
  telemetry: TelemetrySnapshot
): TelemetrySnapshot {
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* keep UTC */
  }
  return { ...telemetry, clientTime: new Date().toISOString(), timezone };
}

// ── Settings persistence (debounced POST /api/settings) ─────────────────────

const pendingSettings = new Map<string, string | number | boolean>();
let settingsTimer: ReturnType<typeof setTimeout> | null = null;

export function pushSetting(key: string, value: string | number | boolean) {
  pendingSettings.set(key, value);
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, 300);
}

function flushSettings() {
  settingsTimer = null;
  const entries = [...pendingSettings.entries()];
  pendingSettings.clear();
  for (const [key, value] of entries) {
    void fetchJson("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).then((res) => {
      if (!res.ok) logEvent("warning", `settings sync failed: ${key}`);
    });
  }
}

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsDTO)[];
function isSettingsKey(k: string): k is keyof SettingsDTO {
  return (SETTINGS_KEYS as string[]).includes(k);
}

// ── Activity log (optimistic + persisted) ───────────────────────────────────

export function logEvent(kind: EventLogDTO["kind"], message: string): void {
  const entry: EventLogDTO = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    message,
    createdAt: new Date().toISOString(),
  };
  useJarvisStore.getState().pushLog(entry);
  void fetchJson("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, message }),
  });
}

// ── Chat action processing ──────────────────────────────────────────────────

export function processActions(actions: ChatAction[]): void {
  const store = useJarvisStore.getState();
  for (const action of actions ?? []) {
    switch (action.type) {
      case "openPanel":
        store.setPanel(String(action.payload) as PanelId);
        break;
      case "sound":
        playSound(String(action.payload ?? "alert") as SoundName);
        break;
      case "setSetting": {
        const raw = String(action.payload ?? "");
        const idx = raw.indexOf("=");
        if (idx <= 0) break;
        const key = raw.slice(0, idx).trim();
        const val = raw.slice(idx + 1).trim();
        if (!isSettingsKey(key)) break;
        const parsed: string | boolean =
          val === "true" ? true : val === "false" ? false : val;
        store.setSettings({ [key]: parsed } as Partial<SettingsDTO>);
        pushSetting(key, parsed);
        break;
      }
      case "clearChat":
        store.clearMessages();
        break;
      case "toggleVoice":
        emit(EV.toggleVoice);
        break;
      case "toggleMute": {
        const next = !store.settings.voiceEnabled;
        store.setSettings({ voiceEnabled: next, soundEnabled: next });
        pushSetting("voiceEnabled", next);
        pushSetting("soundEnabled", next);
        break;
      }
      case "panic":
        store.setSettings({ dnd: true, autonomy: "standard" });
        pushSetting("dnd", true);
        pushSetting("autonomy", "standard");
        playSound("alert");
        break;
      case "resume":
        store.setSettings({ autonomy: "standard" });
        pushSetting("autonomy", "standard");
        break;
      case "focusInput":
        emit(EV.focusInput);
        break;
      default:
        break;
    }
  }
}

// ── Chat send pipeline ──────────────────────────────────────────────────────

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function sendChatMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const store = useJarvisStore.getState();
  if (store.busy) return;

  const userId = uid("u");
  store.addMessage({
    id: userId,
    role: "user",
    content: trimmed,
    createdAt: new Date().toISOString(),
    pending: true,
    revealed: trimmed.length,
  });
  store.setBusy(true);
  playSound("send");

  const { data, error } = await fetchJson<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: trimmed,
      sessionId: "default",
      clientContext: buildClientContext(useJarvisStore.getState().telemetry),
    }),
  });

  const s = useJarvisStore.getState();
  s.updateMessage(userId, { pending: false });

  const res = data as ChatResponse | null;
  if (res && typeof res.reply === "string" && res.ok !== false) {
    const meta: MessageMeta = {
      heard: res.heard,
      corrections: res.corrections,
      trace: res.trace ?? null,
      data: res.data ?? null,
      clarify: res.needsClarification
        ? {
            question: res.clarifyQuestion ?? "",
            options: res.clarifyOptions ?? [],
          }
        : null,
    };
    s.addMessage({
      id: res.messageId ?? uid("a"),
      role: "assistant",
      content: res.reply,
      intent: res.intent,
      route: res.route,
      confidence: res.confidence,
      emotion: res.emotion,
      meta: JSON.stringify(meta),
      createdAt: new Date().toISOString(),
      revealed: 0,
    });
    s.setBusy(false);
    playSound("receive");
    if (s.settings.voiceEnabled) speak(res.reply);
    processActions(res.actions ?? []);
  } else {
    s.setBusy(false);
    s.addMessage({
      id: uid("a"),
      role: "assistant",
      content:
        "I hit a snag contacting my core systems. The link should restore itself momentarily — please try again.",
      createdAt: new Date().toISOString(),
      revealed: 999,
    });
    playSound("error");
    logEvent("error", `chat pipeline failed: ${error ?? "unknown error"}`);
  }
}
