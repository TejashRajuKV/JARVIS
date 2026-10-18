// ─────────────────────────────────────────────────────────────────────────────
// brain.ts — LLM decision layer: intent classification with strict JSON,
// persona-flavored conversation, emotion adaptation, context/follow-ups,
// memory extraction. Backend only (z-ai-web-dev-sdk).
// ─────────────────────────────────────────────────────────────────────────────

import {
  type Emotion,
  type MemoryFactDTO,
  type MessageDTO,
  type Persona,
  type SettingsDTO,
  type TelemetrySnapshot,
} from "./types";
import { summarizeTelemetry } from "./server-utils";

// ── SDK singleton ───────────────────────────────────────────────────────────

type ChatFn = (args: {
  messages: { role: string; content: string }[];
  thinking?: { type: "disabled" | "enabled" };
}) => Promise<{ choices?: { message?: { content?: string } }[] }>;

let chatFn: ChatFn | null = null;

async function getChat(): Promise<ChatFn> {
  if (!chatFn) {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    chatFn = (args) => zai.chat.completions.create(args as Parameters<ChatFn>[0] & Record<string, unknown>);
  }
  return chatFn;
}

async function llm(
  system: string,
  user: string,
  timeoutMs = 28_000
): Promise<string> {
  const fn = await getChat();
  const call = fn({
    messages: [
      { role: "assistant", content: system },
      { role: "user", content: user },
    ],
    thinking: { type: "disabled" },
  });
  const res = await Promise.race([
    call,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("LLM timeout")), timeoutMs)),
  ]);
  return res.choices?.[0]?.message?.content ?? "";
}

async function llmWithRetry(system: string, user: string): Promise<string> {
  try {
    return await llm(system, user);
  } catch {
    await new Promise((r) => setTimeout(r, 900));
    return llm(system, user);
  }
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

export function safeJsonParse<T>(raw: string): T | null {
  const cleaned = stripFences(raw ?? "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // try to find the outermost JSON object
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Context assembly ────────────────────────────────────────────────────────

export interface BrainContext {
  settings: SettingsDTO;
  recentMessages: MessageDTO[];
  memories: MemoryFactDTO[];
  telemetry?: TelemetrySnapshot;
  clientTime: Date;
  timezone?: string;
}

const INTENT_WHITELIST = [
  "greeting", "time", "date", "system_status", "battery_query", "network_query",
  "storage_query", "task_add", "task_list", "task_done", "reminder_set",
  "reminder_list", "memory_remember", "memory_recall", "memory_forget",
  "open_panel", "clear_chat", "help", "mute", "unmute", "voice_start", "panic",
  "resume", "identity", "personality_switch", "set_name", "search_web",
  "agent_run", "conversation",
];

const MUTATING = new Set([
  "task_add", "task_done", "reminder_set", "memory_remember", "memory_forget",
  "agent_run", "personality_switch", "set_name", "panic",
]);

export interface LlmDecision {
  intent: string;
  args: Record<string, string>;
  confidence: number;
  emotion: Emotion;
  needs_clarification: boolean;
  clarify_question: string;
  clarify_options: string[];
  memory_facts: { key: string; value: string; kind: string }[];
  goal: string;
}

export async function llmDecide(
  heard: string,
  ctx: BrainContext
): Promise<{ decision: LlmDecision; latencyMs: number }> {
  const started = Date.now();
  const transcript = ctx.recentMessages
    .slice(-12)
    .map((m) => `${m.role === "user" ? "User" : "JARVIS"}: ${m.content}`)
    .join("\n");
  const memoryLines = ctx.memories
    .slice(0, 20)
    .map((f) => `- ${f.key}: ${f.value}`)
    .join("\n");
  const telem = summarizeTelemetry(ctx.telemetry, ctx.timezone).join("; ");

  const system = `You are the decision core of J.A.R.V.I.S., an AI assistant. Classify the user's request into EXACTLY one intent from this whitelist:
${INTENT_WHITELIST.join(", ")}

RULES:
- If the request is casual conversation, a question, or anything not clearly another intent, use "conversation".
- If uncertain between a state-changing intent (task_add, task_done, reminder_set, memory_remember, memory_forget, agent_run, set_name, personality_switch) and conversation, choose "conversation" with confidence below 0.6 — a safety guard will then ask for confirmation rather than act wrongly.
- Detect the user's emotional state from their words: one of neutral, happy, excited, curious, frustrated, sad, stressed, grateful, urgent.
- Extract durable facts/preferences the user states about themselves or their life (e.g. "my exam is on Friday" -> memory_facts entry {key:"exam.date", value:"exam is on Friday", kind:"fact"}; kinds: fact|preference|project|person). Empty array if none.
- For search_web extract args.query. For agent_run extract args.goal. For task_add extract args.title (plus optional priority/project). For reminder_set extract args.title and args.fireAt as ISO 8601 (use the provided current time and timezone). For set_name extract args.name. For open_panel extract args.panel in [system,tasks,reminders,memory,agent,log,settings].
- Follow-up references like "it", "that", "the second one" refer to the recent transcript — resolve them using context.

Respond with ONLY minified JSON, no markdown, exactly this shape:
{"intent":"...","args":{},"confidence":0.0,"emotion":"neutral","needs_clarification":false,"clarify_question":"","clarify_options":[],"memory_facts":[],"goal":""}`;

  const user = `Current time: ${ctx.clientTime.toISOString()} (${ctx.timezone ?? "client local"})
System telemetry: ${telem}
Known memories:
${memoryLines || "(none)"}
Recent transcript:
${transcript || "(fresh session)"}

User request: "${heard}"`;

  const raw = await llmWithRetry(system, user);
  const parsed = safeJsonParse<LlmDecision>(raw);
  const latencyMs = Date.now() - started;

  if (!parsed || !parsed.intent) {
    // graceful fallback: treat as conversation
    return {
      decision: {
        intent: "conversation",
        args: {},
        confidence: 0.5,
        emotion: "neutral",
        needs_clarification: false,
        clarify_question: "",
        clarify_options: [],
        memory_facts: [],
        goal: "",
      },
      latencyMs,
    };
  }

  return {
    decision: {
      intent: INTENT_WHITELIST.includes(parsed.intent) ? parsed.intent : "conversation",
      args: typeof parsed.args === "object" && parsed.args ? parsed.args : {},
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      emotion: (parsed.emotion ?? "neutral") as Emotion,
      needs_clarification: !!parsed.needs_clarification,
      clarify_question: parsed.clarify_question ?? "",
      clarify_options: Array.isArray(parsed.clarify_options) ? parsed.clarify_options.slice(0, 4) : [],
      memory_facts: Array.isArray(parsed.memory_facts)
        ? parsed.memory_facts
            .filter((f) => f && f.value)
            .map((f) => ({
              key: String(f.key ?? "note").slice(0, 64),
              value: String(f.value).slice(0, 240),
              kind: ["fact", "preference", "project", "person"].includes(f.kind) ? f.kind : "fact",
            }))
            .slice(0, 3)
        : [],
      goal: String(parsed.goal ?? ""),
    },
    latencyMs,
  };
}

// ── Persona conversation reply ──────────────────────────────────────────────

const PERSONA_DESC: Record<Persona, string> = {
  jarvis:
    "You are J.A.R.V.I.S. — calm, precise, quietly witty in a dry British way. You address the user respectfully (as their preferred address). You are competent and never sycophantic.",
  friday:
    "You are FRIDAY — brisk, warm, efficient, with light humour. You address the user respectfully (as their preferred address).",
};

export interface ReplyContext extends BrainContext {
  emotion: Emotion;
  decisionHint?: string;
}

export async function personaReply(heard: string, ctx: ReplyContext): Promise<string> {
  const transcript = ctx.recentMessages
    .slice(-10)
    .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.content}`)
    .join("\n");
  const memoryLines = ctx.memories
    .slice(0, 20)
    .map((f) => `- ${f.key}: ${f.value}`)
    .join("\n");

  const emotionRules = `
EMOTION ADAPTATION (mandatory):
- frustrated -> acknowledge it briefly ("Understood, sir — that would test anyone's patience."), then be EXTRA concise, solution first.
- stressed or sad -> reassuring, softer pacing, no exclamation marks, no jokes.
- happy or excited -> match the warmth, allow light wit.
- urgent -> no fluff whatsoever; answer first, explanation second.
- neutral/curious/grateful -> normal tone.`;

  const system = `${PERSONA_DESC[ctx.settings.persona]}
You are the voice interface of the JARVIS Web Console. You can see live system telemetry and hold the whole session in context.
${emotionRules}
CONTEXT RULES:
- Resolve follow-ups from the transcript ("what were we talking about?", "and firefox too?", "why?", "the second one") — never ask the user to repeat context you already have.
- If something is genuinely ambiguous, ask ONE short clarifying question.
- Use known memories silently when relevant.
STYLE:
- 1-3 sentences by default. Longer ONLY if the user asks to explain, list, or elaborate.
- No emoji. No markdown headings. Plain, spoken-style prose.`;

  const user = `Current time: ${ctx.clientTime.toISOString()} (${ctx.timezone ?? "client local"})
User's emotional state: ${ctx.emotion}
Telemetry: ${summarizeTelemetry(ctx.telemetry, ctx.timezone).join("; ")}
Known memories:
${memoryLines || "(none)"}
Recent transcript:
${transcript || "(fresh session)"}
${ctx.decisionHint ? `Decision layer note: ${ctx.decisionHint}` : ""}

User: "${heard}"

Respond as JARVIS (or FRIDAY, per persona). Just the spoken reply text.`;

  const out = await llmWithRetry(system, user);
  return (out || "I'm afraid my language core did not respond in time. Try again in a moment, if you would.").trim();
}

// ── Agent helpers (planning / repair / report) ──────────────────────────────

export async function planAgentSteps(
  goal: string,
  toolsDescription: string,
  ctx: { clientTime: Date; timezone?: string }
): Promise<{ action: string; input: string; why: string }[]> {
  const system = `You are the planning core of J.A.R.V.I.S. Break the user's goal into 2-6 sequential tool steps using ONLY these tools:
${toolsDescription}

Rules:
- Each step: {"action":"<tool>","input":"<JSON-ish args string the executor can parse, e.g. {\\"query\\":\\"latest nodejs version\\"}>","why":"<one-line reason>"}.
- Simple goals that need zero tools: return a single {"action":"draft","input":"{\\"topic\\":\\"<goal>\\",\\"instructions\\":\\"write the final answer\\"}","why":"compose answer"}.
- Keep inputs self-contained (no references to earlier outputs other than plainly restating what to look for).
- Respond ONLY with a minified JSON array. No markdown.`;

  const user = `Current time: ${ctx.clientTime.toISOString()} (${ctx.timezone ?? "client local"})
Goal: "${goal}"`;

  const raw = await llmWithRetry(system, user);
  const parsed = safeJsonParse<{ action: string; input: string; why: string }[]>(stripFences(raw).startsWith("[") ? stripFences(raw) : "[]");
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.slice(0, 8);
}

export async function repairStepInput(
  action: string,
  input: string,
  error: string
): Promise<string | null> {
  const system = `A JARVIS agent step failed. Produce corrected args JSON for the tool. Respond ONLY with the corrected args string (JSON), nothing else.`;
  const user = `Tool: ${action}
Failed input: ${input}
Error: ${error}
Corrected args:`;
  const raw = await llmWithRetry(system, user);
  const cleaned = stripFences(raw);
  return cleaned && cleaned.length < 500 ? cleaned : null;
}

export async function reportAgentRun(
  goal: string,
  stepLines: string[],
  ctx: { settings: SettingsDTO }
): Promise<string> {
  const system = `${PERSONA_DESC[ctx.settings.persona]}
You are reporting the outcome of a multi-step agent run. Be honest: if any step failed or was skipped, say so plainly and suggest the likely reason. Never claim success for failed steps. 2-4 sentences max. Plain prose, no markdown.`;
  const user = `Goal: "${goal}"
Step outcomes:
${stepLines.join("\n")}`;
  const raw = await llmWithRetry(system, user);
  return (raw || "Agent run complete. See the panel for step details.").trim();
}

export async function summarizeSnippets(query: string, results: { name: string; snippet: string; host_name: string }[]): Promise<string> {
  const context = results
    .slice(0, 6)
    .map((r, i) => `[${i + 1}] ${r.name} (${r.host_name}): ${r.snippet}`)
    .join("\n");
  const system =
    "Answer the user's query using ONLY the provided search snippets. 2-3 sentences. End with the source host names in parentheses, e.g. (nodejs.org, github.com). If the snippets are insufficient, say so honestly. Plain prose, no markdown.";
  const raw = await llmWithRetry(system, `Query: "${query}"\n\nSnippets:\n${context}`);
  return (raw || "I retrieved results but could not compose a summary — see the sources in the panel.").trim();
}
