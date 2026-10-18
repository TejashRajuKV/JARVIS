// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Web Console — shared types & API contract.
// Both frontend (components) and backend (route handlers) import from here.
// ─────────────────────────────────────────────────────────────────────────────

export type Persona = "jarvis" | "friday";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type PanelId =
  | "system"
  | "tasks"
  | "reminders"
  | "memory"
  | "agent"
  | "log";

export type Emotion =
  | "neutral"
  | "happy"
  | "excited"
  | "curious"
  | "frustrated"
  | "sad"
  | "stressed"
  | "grateful"
  | "urgent";

// ── Telemetry (collected client-side, sent with every chat request) ─────────

export interface BatteryInfo {
  level: number; // 0..1
  charging: boolean;
  chargingTime?: number; // seconds, Infinity if unknown
  dischargingTime?: number; // seconds, Infinity if unknown
}

export interface StorageInfo {
  usage: number; // bytes
  quota: number; // bytes
}

export interface NetworkInfo {
  online: boolean;
  effectiveType?: string; // "4g" etc.
  downlink?: number; // Mb/s estimate
  rtt?: number; // ms estimate
  saveData?: boolean;
}

export interface DeviceInfo {
  cores?: number; // hardwareConcurrency
  memoryGB?: number; // deviceMemory (approx)
  platform?: string;
  language?: string;
}

export interface TelemetrySnapshot {
  battery?: BatteryInfo | null;
  storage?: StorageInfo | null;
  network?: NetworkInfo | null;
  device?: DeviceInfo | null;
  fps?: number;
  uptimeMs?: number;
  clientTime?: string; // ISO timestamp from client clock (user timezone)
  timezone?: string; // e.g. "Asia/Calcutta"
}

// ── Chat pipeline ────────────────────────────────────────────────────────────

export interface ChatAction {
  type:
    | "none"
    | "openPanel" // payload: PanelId
    | "sound" // payload: sound name
    | "setSetting" // payload: "key=value"
    | "clearChat"
    | "toggleVoice"
    | "toggleMute"
    | "panic" // pause all automation
    | "resume"
    | "focusInput";
  payload?: string | number | boolean;
}

export interface RuleTrace {
  engine: "rule";
  intent: string;
  confidence: number;
  normalized: string;
  corrections: string[];
}

export interface LlmTrace {
  engine: "llm";
  intent: string;
  confidence: number;
  emotion: Emotion;
  modelLatencyMs?: number;
}

export interface ChatTrace {
  decision: string; // human-readable: "rule engine (0.96) → reminder_set"
  rule?: RuleTrace;
  llm?: LlmTrace;
  latencyMs: number;
  localVsOnline: "local" | "online" | "hybrid";
}

export interface ChatRequest {
  text: string;
  sessionId?: string;
  clientContext?: TelemetrySnapshot;
}

export interface ChatResponse {
  ok: boolean;
  reply: string;
  heard: string; // normalized + speech-corrected text
  corrections: string[]; // e.g. ["front and → frontend"]
  intent: string;
  route: string; // rule | llm | tool | search | agent | error
  confidence: number;
  emotion: Emotion | null;
  needsClarification: boolean;
  clarifyQuestion?: string;
  clarifyOptions?: string[];
  actions: ChatAction[];
  /** Panel data returned by tool execution, rendered as rich cards in chat. */
  data?: ToolResultData | null;
  trace: ChatTrace;
  messageId?: string;
  error?: string;
}

export type ToolResultData =
  | { kind: "system"; telemetry: TelemetrySnapshot; summary: string[] }
  | { kind: "tasks"; tasks: TaskDTO[] }
  | { kind: "reminders"; reminders: ReminderDTO[] }
  | { kind: "memory"; facts: MemoryFactDTO[] }
  | { kind: "search"; results: SearchResultItem[]; query: string }
  | { kind: "agent"; runId: string };

export interface SearchResultItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date?: string;
}

// ── Entities ────────────────────────────────────────────────────────────────

export interface MessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string | null;
  route?: string | null;
  confidence?: number | null;
  emotion?: string | null;
  meta?: string | null; // JSON: { heard, corrections, trace, data, clarify }
  createdAt: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  status: "open" | "doing" | "done";
  priority: "low" | "normal" | "high";
  project?: string | null;
  dueAt?: string | null;
  createdAt: string;
}

export interface ReminderDTO {
  id: string;
  title: string;
  fireAt: string;
  status: "scheduled" | "fired" | "cancelled" | "done";
  createdAt: string;
}

export interface MemoryFactDTO {
  id: string;
  key: string;
  value: string;
  kind: "fact" | "preference" | "project" | "person";
  source?: string | null;
  createdAt: string;
}

export interface AgentStepDTO {
  id: string;
  index: number;
  action: string;
  input: string;
  output?: string | null;
  status: "pending" | "running" | "verified" | "failed" | "recovered" | "skipped";
  note?: string | null;
}

export interface AgentRunDTO {
  id: string;
  goal: string;
  status: "planning" | "running" | "done" | "failed" | "cancelled";
  plan?: string | null; // JSON array of { action, input, why }
  result?: string | null;
  stepsTotal: number;
  stepsDone: number;
  steps?: AgentStepDTO[];
  createdAt: string;
}

export interface EventLogDTO {
  id: string;
  kind: "info" | "success" | "warning" | "error" | "system";
  message: string;
  createdAt: string;
}

export interface SettingsDTO {
  persona: Persona;
  userName: string;
  voiceEnabled: boolean;
  soundEnabled: boolean;
  wakeWordEnabled: boolean;
  gesturesEnabled: boolean;
  showIntentTrace: boolean;
  dnd: boolean; // do-not-disturb: suppress proactive alerts
  autonomy: "standard" | "proactive"; // proactive → allow gentle suggestions
}

export const DEFAULT_SETTINGS: SettingsDTO = {
  persona: "jarvis",
  userName: "sir",
  voiceEnabled: true,
  soundEnabled: true,
  wakeWordEnabled: false,
  gesturesEnabled: true,
  showIntentTrace: false,
  dnd: false,
  autonomy: "proactive",
};

// ── Agent tools whitelist (server-side agent executor) ──────────────────────

export const AGENT_TOOLS = [
  "web_search", // { query } → search results summary
  "calc", // { expression } → safe math evaluation
  "summarize", // { text } → LLM summary
  "memory_save", // { key, value }
  "memory_search", // { query } → matching facts
  "task_add", // { title, priority?, project?, dueAt? }
  "task_list", // {} → open tasks
  "reminder_set", // { title, fireAt }
  "time_now", // {} → current client time
  "draft", // { topic, instructions } → LLM writes a short text
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number];

export interface AgentPlanStep {
  action: AgentToolName;
  input: string; // human-readable input / JSON-ish args
  why: string; // one-line reason shown in HUD
}

// ── Gesture vocabulary (client-side stroke recognizer) ──────────────────────

export interface GestureDefinition {
  name: string;
  label: string;
  description: string;
  action: string; // action id dispatched by the HUD
}

export const GESTURES: GestureDefinition[] = [
  { name: "circle", label: "○ Circle", description: "Clear the conversation", action: "clearChat" },
  { name: "vshape", label: "✓ V-shape", description: "Toggle voice mode", action: "toggleVoice" },
  { name: "mshape", label: "ᨓ M-shape", description: "Mute / unmute responses", action: "toggleMute" },
  { name: "zshape", label: "⌇ Z-shape", description: "Panic — pause automation", action: "panic" },
  { name: "caret", label: "⌃ Caret", description: "Open command palette", action: "openPalette" },
  { name: "nshape", label: "ᥒ N-shape", description: "New task", action: "newTask" },
];
