// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat  — the core request pipeline:
// normalize → speech correction → local rule engine → (unsure?) LLM decision
// layer → ambiguity guard → executor / search / agent → persist → respond.
// GET  /api/chat — session history.  DELETE — clear session.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  applyCorrections,
  normalizeInput,
  ruleClassify,
} from "@/lib/jarvis/nlu";
import { llmDecide, personaReply, safeJsonParse } from "@/lib/jarvis/brain";
import { executeIntent } from "@/lib/jarvis/executor";
import { webSearch } from "@/lib/jarvis/search";
import { startAgentRun } from "@/lib/jarvis/agent";
import {
  getSettings,
  logEvent,
  setSettingKV,
  toMemoryDTO,
  upsertMemory,
} from "@/lib/jarvis/server-utils";
import type {
  ChatAction,
  ChatResponse,
  Emotion,
  MemoryFactDTO,
  MessageDTO,
  SettingsDTO,
  TelemetrySnapshot,
  ToolResultData,
} from "@/lib/jarvis/types";

export const dynamic = "force-dynamic";

const SESSION_DEFAULT = "default";
const RULE_CONFIDENCE_THRESHOLD = 0.8;
const AMBIGUITY_THRESHOLD = 0.6;

function toMessageDTO(row: {
  id: string;
  role: string;
  content: string;
  intent: string | null;
  route: string | null;
  confidence: number | null;
  emotion: string | null;
  meta: string | null;
  createdAt: Date;
}): MessageDTO {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    intent: row.intent,
    route: row.route,
    confidence: row.confidence ?? undefined,
    emotion: row.emotion ?? undefined,
    meta: row.meta,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadHistory(sessionId: string, limit = 12): Promise<MessageDTO[]> {
  const rows = await db.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse().map(toMessageDTO);
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? SESSION_DEFAULT;
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "30", 10) || 30, 100);
  const rows = await db.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(
    { ok: true, messages: rows.reverse().map(toMessageDTO) },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? SESSION_DEFAULT;
  await db.message.deleteMany({ where: { sessionId } });
  await logEvent("info", "Conversation cleared");
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = (await req.json()) as {
      text?: string;
      sessionId?: string;
      clientContext?: TelemetrySnapshot;
    };
    const rawText = (body.text ?? "").toString().trim().slice(0, 1000);
    if (!rawText) {
      return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
    }
    const sessionId = body.sessionId?.slice(0, 64) || SESSION_DEFAULT;
    const telemetry = body.clientContext ?? undefined;
    const clientTime = telemetry?.clientTime ? new Date(telemetry.clientTime) : new Date();
    const timezone = telemetry?.timezone;

    const settings = await getSettings();

    // ── 1. normalize + speech repair ────────────────────────────────────────
    const normalized = normalizeInput(rawText);
    const { corrected, corrections } = applyCorrections(normalized);

    // ── 2. local rule engine (fast path, offline) ──────────────────────────
    const rule = ruleClassify(corrected, { now: clientTime, timezone, telemetry });
    const memories: MemoryFactDTO[] = (
      await db.memoryFact.findMany({ orderBy: { updatedAt: "desc" }, take: 20 })
    ).map(toMemoryDTO);

    let reply = "";
    let intent = rule.intent;
    let route = "rule";
    let confidence = rule.confidence;
    let emotion: Emotion | null = null;
    let needsClarification = false;
    let clarifyQuestion: string | undefined;
    let clarifyOptions: string[] | undefined;
    let actions: ChatAction[] = [];
    let data: ToolResultData | null = null;
    let localVsOnline: "local" | "online" | "hybrid" = "local";
    let llmInfo: { intent: string; confidence: number; latencyMs: number } | undefined;
    let note: string | undefined;

    const enough = rule.confidence >= RULE_CONFIDENCE_THRESHOLD;

    if (!enough) {
      // ── 3. LLM decision layer ────────────────────────────────────────────
      const history = await loadHistory(sessionId, 12);
      let decision: Awaited<ReturnType<typeof llmDecide>>["decision"] | null = null;
      try {
        const out = await llmDecide(corrected, {
          settings,
          recentMessages: history,
          memories,
          telemetry,
          clientTime,
          timezone,
        });
        decision = out.decision;
        llmInfo = { intent: decision.intent, confidence: decision.confidence, latencyMs: out.latencyMs };
      } catch (err) {
        await logEvent("error", `LLM decision failed: ${(err as Error).message}`);
      }

      if (decision) {
        emotion = decision.emotion;
        // memory extraction (silently learn facts)
        for (const f of decision.memory_facts) {
          await upsertMemory(f.key, f.value, f.kind as MemoryFactDTO["kind"], rawText.slice(0, 200)).catch(() => undefined);
        }

        // ── 4. ambiguity guard: don't execute the wrong action ────────────
        const mutating = ["task_add", "task_done", "reminder_set", "memory_remember", "memory_forget", "agent_run", "personality_switch", "set_name", "panic"].includes(decision.intent);
        if (decision.confidence < AMBIGUITY_THRESHOLD && mutating) {
          needsClarification = true;
          intent = "clarify";
          route = "llm";
          confidence = decision.confidence;
          clarifyQuestion =
            decision.clarify_question ||
            `I want to be sure before I act — did you mean: ${decision.intent.replace(/_/g, " ")}?`;
          clarifyOptions = decision.clarify_options.length
            ? decision.clarify_options
            : ["Yes, go ahead", "No, cancel"];
          reply = clarifyQuestion;
          note = "ambiguity guard engaged — nothing executed";
          await logEvent("warning", `Ambiguity guard: "${rawText.slice(0, 80)}" (conf ${decision.confidence.toFixed(2)}, intent ${decision.intent})`);
        } else {
          intent = decision.intent;
          confidence = decision.confidence;

          if (intent === "search_web") {
            // ── 5a. online route ──────────────────────────────────────────
            route = "search";
            localVsOnline = "online";
            const query = decision.args.query ?? corrected;
            const results = await webSearch(query, 6);
            if (results.length) {
              const { summarizeSnippets } = await import("@/lib/jarvis/brain");
              reply = await summarizeSnippets(query, results);
            } else {
              reply = `The search came back empty, ${settings.userName}. The network layer may be having a moment.`;
              await logEvent("warning", `Search returned nothing for: ${query.slice(0, 80)}`);
            }
            data = { kind: "search", results: results.slice(0, 5), query };
          } else if (intent === "agent_run") {
            // ── 5b. multi-step agent ──────────────────────────────────────
            route = "agent";
            const goal = decision.args.goal || decision.goal || corrected;
            const runId = await startAgentRun(goal, { settings, clientTime, timezone });
            reply = `On it, ${settings.userName}. Agent engaged — I'll verify each step and report honestly. Watch the agent panel for live progress.`;
            actions = [{ type: "openPanel", payload: "agent" }];
            data = { kind: "agent", runId };
          } else if (intent === "conversation") {
            // ── 5c. persona conversation ─────────────────────────────────
            route = "llm";
            const history2 = await loadHistory(sessionId, 10);
            reply = await personaReply(corrected, {
              settings,
              recentMessages: history2,
              memories,
              telemetry,
              clientTime,
              timezone,
              emotion: decision.emotion,
              decisionHint: llmInfo ? `classified as conversation (confidence ${decision.confidence.toFixed(2)})` : undefined,
            });
          } else {
            // ── 5d. LLM-classified tool intent → executor ─────────────────
            route = "tool";
            const outcome = await executeIntent(intent, decision.args, {
              settings,
              telemetry,
              clientTime,
              timezone,
              heard: corrected,
            });
            reply = outcome.reply;
            actions = outcome.actions;
            data = outcome.data;
            note = outcome.note;
            // side settings (persona switch, set name) — server truth
            for (const a of actions) {
              if (a.type === "setSetting" && typeof a.payload === "string") {
                const [k, v] = a.payload.split("=");
                await setSettingKV(k, v).catch(() => undefined);
              }
            }
          }
        }
      } else {
        // LLM completely unavailable → honest fallback, no fake success
        route = "error";
        intent = "conversation";
        confidence = 0;
        reply = `I couldn't reach my language core, ${settings.userName}, and that request was beyond my local rules. I'd rather tell you plainly than guess — try again in a moment.`;
        await logEvent("error", "LLM unavailable; request fell through with honest fallback");
      }
    } else {
      // ── rule-engine fast path ────────────────────────────────────────────
      route = rule.intent === "search_web" ? "search" : rule.intent === "agent_run" ? "agent" : "rule";
      if (rule.intent === "search_web") {
        localVsOnline = "online";
        const query = rule.args.query ?? corrected;
        const results = await webSearch(query, 6);
        if (results.length) {
          const { summarizeSnippets } = await import("@/lib/jarvis/brain");
          reply = await summarizeSnippets(query, results);
        } else {
          reply = "The search came back empty. The network layer may be having a moment.";
        }
        data = { kind: "search", results: results.slice(0, 5), query };
      } else if (rule.intent === "agent_run") {
        const goal = rule.args.goal || corrected;
        const runId = await startAgentRun(goal, { settings, clientTime, timezone });
        reply = `On it, ${settings.userName}. Agent engaged — I'll verify each step and report honestly.`;
        actions = [{ type: "openPanel", payload: "agent" }];
        data = { kind: "agent", runId };
      } else {
        const outcome = await executeIntent(rule.intent, rule.args, {
          settings,
          telemetry,
          clientTime,
          timezone,
          heard: corrected,
        });
        reply = outcome.reply;
        actions = outcome.actions;
        data = outcome.data;
        note = outcome.note;
        for (const a of actions) {
          if (a.type === "setSetting" && typeof a.payload === "string") {
            const [k, v] = a.payload.split("=");
            await setSettingKV(k, v).catch(() => undefined);
          }
        }
      }
    }

    // ── 6. persist both messages ───────────────────────────────────────────
    const meta = JSON.stringify({
      heard: corrected,
      corrections,
      clarify: needsClarification ? { question: clarifyQuestion, options: clarifyOptions } : null,
      data,
      note: note ?? null,
    }).slice(0, 4000);

    await db.message.create({
      data: { sessionId, role: "user", content: rawText, intent: null, createdAt: new Date() },
    });
    const assistantRow = await db.message.create({
      data: {
        sessionId,
        role: "assistant",
        content: reply,
        intent,
        route,
        confidence,
        emotion,
        meta,
      },
    });

    const latencyMs = Date.now() - started;
    const trace: ChatResponse["trace"] = {
      decision: needsClarification
        ? `ambiguity guard (conf ${confidence.toFixed(2)}) → asked instead of acting`
        : llmInfo
          ? `rule ${rule.confidence.toFixed(2)} → llm ${llmInfo.confidence.toFixed(2)} → ${intent}`
          : `rule engine (${rule.confidence.toFixed(2)}) → ${intent}`,
      rule: {
        engine: "rule",
        intent: rule.intent,
        confidence: rule.confidence,
        normalized,
        corrections,
      },
      llm: llmInfo
        ? {
            engine: "llm",
            intent: llmInfo.intent,
            confidence: llmInfo.confidence,
            emotion: (emotion ?? "neutral") as Emotion,
            modelLatencyMs: llmInfo.latencyMs,
          }
        : undefined,
      latencyMs,
      localVsOnline,
    };

    const payload: ChatResponse = {
      ok: true,
      reply,
      heard: corrected,
      corrections,
      intent,
      route,
      confidence,
      emotion,
      needsClarification,
      clarifyQuestion,
      clarifyOptions,
      actions,
      data,
      trace,
      messageId: assistantRow.id,
    };
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[jarvis:chat] pipeline error:", err);
    await logEvent("error", `Chat pipeline error: ${(err as Error).message}`).catch(() => undefined);
    return NextResponse.json(
      {
        ok: false,
        reply: "Something misfired in my core pipeline. I've logged it — try that again.",
        heard: "",
        corrections: [],
        intent: "error",
        route: "error",
        confidence: 0,
        emotion: null,
        needsClarification: false,
        actions: [],
        data: null,
        trace: { decision: "pipeline error", latencyMs: Date.now() - started, localVsOnline: "local" },
        error: (err as Error).message,
      } satisfies ChatResponse,
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
}

// keep safeJsonParse referenced for future tool payloads (tree-shake guard)
void safeJsonParse;
