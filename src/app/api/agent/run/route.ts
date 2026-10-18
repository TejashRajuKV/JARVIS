// POST /api/agent/run {goal, clientContext?} — start run (returns immediately)
// GET  /api/agent/run?id= — run + steps · without id — 10 most recent runs
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startAgentRun } from "@/lib/jarvis/agent";
import { getSettings } from "@/lib/jarvis/server-utils";
import type { AgentRunDTO, AgentStepDTO, TelemetrySnapshot } from "@/lib/jarvis/types";

export const dynamic = "force-dynamic";

function toStepDTO(row: {
  id: string;
  index: number;
  action: string;
  input: string;
  output: string | null;
  status: string;
  note: string | null;
}): AgentStepDTO {
  return {
    id: row.id,
    index: row.index,
    action: row.action,
    input: row.input,
    output: row.output,
    status: (["pending", "running", "verified", "failed", "recovered", "skipped"].includes(row.status)
      ? row.status
      : "pending") as AgentStepDTO["status"],
    note: row.note,
  };
}

function toRunDTO(
  row: {
    id: string;
    goal: string;
    status: string;
    plan: string | null;
    result: string | null;
    stepsTotal: number;
    stepsDone: number;
    createdAt: Date;
  },
  steps?: AgentStepDTO[]
): AgentRunDTO {
  return {
    id: row.id,
    goal: row.goal,
    status: (["planning", "running", "done", "failed", "cancelled"].includes(row.status)
      ? row.status
      : "planning") as AgentRunDTO["status"],
    plan: row.plan,
    result: row.result,
    stepsTotal: row.stepsTotal,
    stepsDone: row.stepsDone,
    steps,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const row = await db.agentRun.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404 });
    const steps = await db.agentStep.findMany({ where: { runId: id }, orderBy: { index: "asc" } });
    return NextResponse.json(
      { ok: true, run: toRunDTO(row, steps.map(toStepDTO)) },
      { headers: { "cache-control": "no-store" } }
    );
  }
  const rows = await db.agentRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  return NextResponse.json(
    { ok: true, runs: rows.map((r) => toRunDTO(r)) },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { goal?: string; clientContext?: TelemetrySnapshot };
    const goal = (body.goal ?? "").toString().trim().slice(0, 400);
    if (!goal) return NextResponse.json({ ok: false, error: "goal required" }, { status: 400 });

    const settings = await getSettings();
    const clientTime = body.clientContext?.clientTime ? new Date(body.clientContext.clientTime) : new Date();
    const timezone = body.clientContext?.timezone;

    const runId = await startAgentRun(goal, { settings, clientTime, timezone });
    const row = await db.agentRun.findUnique({ where: { id: runId } });
    return NextResponse.json(
      { ok: true, run: row ? toRunDTO(row, []) : null },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
