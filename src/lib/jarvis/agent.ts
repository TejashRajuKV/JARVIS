// ─────────────────────────────────────────────────────────────────────────────
// agent.ts — multi-step agent: plan (LLM) → execute → verify each step →
// recover failed steps with one LLM-repaired retry → final honest report.
// Backend only.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { AGENT_TOOLS, type AgentPlanStep, type AgentToolName, type SettingsDTO } from "./types";
import { planAgentSteps, repairStepInput, reportAgentRun } from "./brain";
import { webSearch } from "./search";
import { summarizeTelemetry } from "./server-utils";
import { safeCalc, upsertMemory, logEvent } from "./server-utils";
import { db as database } from "@/lib/db";

const TOOL_DESCRIPTIONS = [
  "web_search — search the public web, input {\"query\":\"...\"}",
  "calc — evaluate an arithmetic expression, input {\"expression\":\"2+2*10\"}",
  "summarize — summarize a piece of text, input {\"text\":\"...\"}",
  "memory_save — store a fact, input {\"key\":\"...\",\"value\":\"...\"}",
  "memory_search — search known facts, input {\"query\":\"...\"}",
  "task_add — create a task, input {\"title\":\"...\",\"priority\":\"low|normal|high\"}",
  "task_list — list open tasks, input {}",
  "reminder_set — create a reminder, input {\"title\":\"...\",\"fireAt\":\"ISO 8601 datetime\"}",
  "time_now — get the current client time, input {}",
  "draft — write a short text answer, input {\"topic\":\"...\",\"instructions\":\"...\"}",
].join("\n");

export async function startAgentRun(
  goal: string,
  opts: { settings: SettingsDTO; clientTime: Date; timezone?: string }
): Promise<string> {
  const run = await db.agentRun.create({
    data: { goal: goal.slice(0, 400), status: "planning" },
  });
  await logEvent("info", `Agent engaged: ${goal.slice(0, 120)}`);
  // fire-and-forget; route returns immediately
  void runAgent(run.id, goal, opts).catch(async (err) => {
    console.error("[jarvis:agent] fatal:", err);
    await db.agentRun
      .update({ where: { id: run.id }, data: { status: "failed", result: "Agent crashed unexpectedly." } })
      .catch(() => undefined);
  });
  return run.id;
}

export async function cancelAgentRun(id: string): Promise<void> {
  await db.agentRun.updateMany({
    where: { id, status: { in: ["planning", "running"] } },
    data: { status: "cancelled" },
  });
  await logEvent("warning", `Agent run cancelled: ${id}`);
}

async function runAgent(
  runId: string,
  goal: string,
  opts: { settings: SettingsDTO; clientTime: Date; timezone?: string }
): Promise<void> {
  // ── planning ──────────────────────────────────────────────────────────────
  let plan: AgentPlanStep[] = [];
  try {
    plan = await planAgentSteps(goal, TOOL_DESCRIPTIONS, {
      clientTime: opts.clientTime,
      timezone: opts.timezone,
    });
  } catch (err) {
    await db.agentRun.update({
      where: { id: runId },
      data: { status: "failed", result: `Planning failed: ${(err as Error).message}` },
    });
    return;
  }

  // validate plan — every action must be a whitelisted tool
  const validPlan = plan.filter(
    (p) => p && AGENT_TOOLS.includes(p.action as AgentToolName) && typeof p.input === "string"
  );
  if (validPlan.length === 0 || validPlan.length !== plan.length) {
    // one repair retry: ask again with stricter note
    try {
      plan = await planAgentSteps(
        `${goal}\n\nIMPORTANT: previous plan contained invalid tools. Use ONLY the whitelisted tools.`,
        TOOL_DESCRIPTIONS,
        { clientTime: opts.clientTime, timezone: opts.timezone }
      );
      plan = plan.filter((p) => AGENT_TOOLS.includes(p.action as AgentToolName));
    } catch {
      plan = [];
    }
    if (plan.length === 0) {
      await db.agentRun.update({
        where: { id: runId },
        data: { status: "failed", result: "I could not produce a valid plan for that goal with the tools I have." },
      });
      await logEvent("error", `Agent plan failed for: ${goal.slice(0, 80)}`);
      return;
    }
  }

  await db.agentRun.update({
    where: { id: runId },
    data: {
      status: "running",
      plan: JSON.stringify(plan),
      stepsTotal: plan.length,
    },
  });

  // wipe any stale steps (defensive) and create fresh ones
  await db.agentStep.deleteMany({ where: { runId } });
  const stepRows = await Promise.all(
    plan.map((p, i) =>
      db.agentStep.create({
        data: { runId, index: i, action: p.action, input: p.input, status: "pending", note: p.why },
      })
    )
  );

  // ── execution with verification + recovery ───────────────────────────────
  let stepsDone = 0;
  let anyFailure = false;
  const outcomeLines: string[] = [];
  let lastVerifiedOutput = "";

  for (let i = 0; i < plan.length; i++) {
    const current = await db.agentRun.findUnique({ where: { id: runId } });
    if (!current || current.status === "cancelled") {
      await db.agentStep.updateMany({ where: { runId, index: { gte: i } }, data: { status: "skipped", note: "run cancelled" } });
      return;
    }

    const step = stepRows[i];
    await db.agentStep.update({ where: { id: step.id }, data: { status: "running" } });

    // feed forward: if the planner left a placeholder in memory_save's value,
    // substitute the previous step's verified output (honest data, not placeholders)
    let stepInput = plan[i].input;
    if (plan[i].action === "memory_save") {
      const looksPlaceholder =
        !stepInput.trim() ||
        /result from|from (the )?(web )?search|previous step|prior step|search result|step output|<.*>/i.test(stepInput);
      if (looksPlaceholder && lastVerifiedOutput) {
        const keyMatch = stepInput.match(/"key"\s*:\s*"([^"]+)"/);
        stepInput = JSON.stringify({
          key: keyMatch?.[1] ?? "agent_note",
          value: lastVerifiedOutput.slice(0, 200),
        });
      }
    }

    const outcome = await executeAgentStep(plan[i].action as AgentToolName, stepInput, {
      clientTime: opts.clientTime,
      timezone: opts.timezone,
    });

    if (outcome.ok && verifyStep(plan[i].action as AgentToolName, outcome.output)) {
      await db.agentStep.update({
        where: { id: step.id },
        data: {
          status: "verified",
          input: stepInput.slice(0, 400),
          output: outcome.output.slice(0, 800),
          note: `verified: ${outcome.verifyNote ?? "output meets expectations"}`,
        },
      });
      stepsDone++;
      lastVerifiedOutput = outcome.output;
      outcomeLines.push(`Step ${i + 1} (${plan[i].action}) — verified: ${outcome.output.slice(0, 180)}`);
      continue;
    }

    // ── recovery: one LLM-repaired retry ──────────────────────────────────
    const errText = outcome.ok ? "output failed verification" : outcome.error;
    const repaired = await repairStepInput(plan[i].action, plan[i].input, errText ?? "unknown error").catch(() => null);
    if (repaired) {
      const retry = await executeAgentStep(plan[i].action as AgentToolName, repaired, {
        clientTime: opts.clientTime,
        timezone: opts.timezone,
      });
      if (retry.ok && verifyStep(plan[i].action as AgentToolName, retry.output)) {
        await db.agentStep.update({
          where: { id: step.id },
          data: {
            status: "recovered",
            input: repaired.slice(0, 400),
            output: retry.output.slice(0, 800),
            note: `recovered after repair (original error: ${errText?.slice(0, 120)})`,
          },
        });
        stepsDone++;
        lastVerifiedOutput = retry.output;
        outcomeLines.push(`Step ${i + 1} (${plan[i].action}) — recovered after repairing input.`);
        continue;
      }
    }

    await db.agentStep.update({
      where: { id: step.id },
      data: {
        status: "failed",
        output: (outcome.output ?? "").slice(0, 400),
        note: `failed: ${errText?.slice(0, 200) ?? "verification failed"}`,
      },
    });
    anyFailure = true;
    outcomeLines.push(`Step ${i + 1} (${plan[i].action}) — FAILED: ${errText?.slice(0, 150)}`);
  }

  // ── final report ──────────────────────────────────────────────────────────
  let result: string;
  try {
    result = await reportAgentRun(goal, outcomeLines, { settings: opts.settings });
  } catch {
    result = anyFailure
      ? `Agent run finished with issues: ${stepsDone}/${plan.length} steps verified. See the step notes for failure reasons.`
      : `Agent run complete: ${stepsDone}/${plan.length} steps verified.`;
  }

  await db.agentRun.update({
    where: { id: runId },
    data: {
      status: anyFailure ? "failed" : "done",
      result,
      stepsDone,
      updatedAt: new Date(),
    },
  });
  await logEvent(anyFailure ? "warning" : "success", `Agent run finished: ${stepsDone}/${plan.length} steps verified`);
}

// ── step executor ───────────────────────────────────────────────────────────

interface StepOutcome {
  ok: boolean;
  output: string;
  error?: string;
  verifyNote?: string;
}

async function executeAgentStep(
  action: AgentToolName,
  input: string,
  ctx: { clientTime: Date; timezone?: string }
): Promise<StepOutcome> {
  const args = parseArgs(input);
  try {
    switch (action) {
      case "web_search": {
        const query = args.query ?? stripToText(input);
        if (!query) return { ok: false, output: "", error: "no query" };
        const results = await webSearch(query, 5);
        if (!results.length) return { ok: false, output: "", error: "search returned no results" };
        return {
          ok: true,
          output: results.map((r) => `${r.name} (${r.host_name}): ${r.snippet}`).join(" | ").slice(0, 800),
          verifyNote: `${results.length} results`,
        };
      }
      case "calc": {
        const expr = args.expression ?? stripToText(input);
        const r = safeCalc(expr);
        return r.ok
          ? { ok: true, output: `${expr} = ${r.value}`, verifyNote: `= ${r.value}` }
          : { ok: false, output: "", error: r.error };
      }
      case "summarize": {
        const text = args.text ?? stripToText(input);
        if (!text || text.length < 40) return { ok: false, output: "", error: "text too short to summarize" };
        const { summarizeSnippets } = await import("./brain");
        const out = await summarizeSnippets("Summarize this text", [
          { name: "input", snippet: text.slice(0, 1500), host_name: "input" },
        ]);
        return { ok: true, output: out };
      }
      case "draft": {
        const { personaReply } = await import("./brain");
        const { getSettings } = await import("./server-utils");
        const settings = await getSettings();
        const out = await personaReply(
          `Write a short, useful answer about: ${args.topic ?? stripToText(input)}. ${args.instructions ?? ""}`,
          {
            settings,
            recentMessages: [],
            memories: [],
            clientTime: ctx.clientTime,
            timezone: ctx.timezone,
            emotion: "neutral",
          }
        );
        return { ok: true, output: out };
      }
      case "memory_save": {
        const key = (args.key ?? "note").slice(0, 64);
        const value = args.value ?? stripToText(input);
        if (!value) return { ok: false, output: "", error: "nothing to remember" };
        await upsertMemory(key, value.slice(0, 240), "fact", "agent run");
        return { ok: true, output: `remembered ${key} = ${value.slice(0, 120)}` };
      }
      case "memory_search": {
        const q = (args.query ?? stripToText(input)).toLowerCase();
        const rows = await database.memoryFact.findMany({ take: 50, orderBy: { updatedAt: "desc" } });
        const hits = rows.filter((r) => r.key.includes(q) || r.value.toLowerCase().includes(q));
        return {
          ok: true,
          output: hits.length
            ? hits.slice(0, 5).map((h) => `${h.key}: ${h.value}`).join(" | ")
            : "no matching facts",
          verifyNote: hits.length ? `${hits.length} matches` : "verified (no matches)",
        };
      }
      case "task_add": {
        const title = args.title ?? stripToText(input);
        if (!title) return { ok: false, output: "", error: "no title" };
        const row = await database.task.create({
          data: { title: title.slice(0, 200), priority: ["low", "high"].includes(args.priority) ? args.priority : "normal" },
        });
        return { ok: true, output: `task created: ${row.title}` };
      }
      case "task_list": {
        const rows = await database.task.findMany({ where: { status: { not: "done" } }, take: 10, orderBy: { updatedAt: "desc" } });
        return { ok: true, output: rows.length ? rows.map((r) => r.title).join(" | ") : "no open tasks" };
      }
      case "reminder_set": {
        const title = args.title ?? "Reminder";
        const fireAt = args.fireAt ? new Date(args.fireAt) : null;
        if (!fireAt || isNaN(fireAt.getTime())) return { ok: false, output: "", error: "invalid fireAt" };
        const row = await database.reminder.create({ data: { title: title.slice(0, 200), fireAt } });
        return { ok: true, output: `reminder set: ${row.title} at ${row.fireAt.toISOString()}` };
      }
      case "time_now": {
        return { ok: true, output: `${ctx.clientTime.toISOString()} (${ctx.timezone ?? "client local"})` };
      }
      default:
        return { ok: false, output: "", error: `unknown tool ${action}` };
    }
  } catch (err) {
    return { ok: false, output: "", error: (err as Error).message };
  }
}

function verifyStep(action: AgentToolName, output: string): boolean {
  if (!output || output.trim().length === 0) return false;
  switch (action) {
    case "web_search":
      return output.includes("(") && output.length > 30; // has source + content
    case "calc":
      return /=\s*-?\d/.test(output);
    case "summarize":
    case "draft":
      return output.length >= 40;
    default:
      return output.length > 3;
  }
}

function parseArgs(input: string): Record<string, string> {
  const t = input.trim();
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    } catch {
      // fall through to k=v parsing
    }
  }
  // try key:"value" pairs inside plain text
  const kv: Record<string, string> = {};
  const re = /(\w+)\s*[:=]\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) kv[m[1]] = m[2];
  if (Object.keys(kv).length === 0) kv._raw = t;
  return kv;
}

function stripToText(input: string): string {
  const args = parseArgs(input);
  return (args.query ?? args.expression ?? args.text ?? args.value ?? args.title ?? args.topic ?? args._raw ?? input)
    .replace(/^[{"]+|[}"]+$/g, "")
    .trim();
}

export function telemetryLine(t: unknown, timezone?: string): string {
  return summarizeTelemetry(t as never, timezone).join("; ");
}
