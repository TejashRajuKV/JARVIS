// POST /api/agent/cancel {id}
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cancelAgentRun } from "@/lib/jarvis/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    await cancelAgentRun(body.id);
    const row = await db.agentRun.findUnique({ where: { id: body.id } });
    return NextResponse.json({ ok: true, run: row ?? null }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
