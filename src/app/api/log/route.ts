// GET /api/log?limit= · POST {kind, message, meta?}
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent, toLogDTO } from "@/lib/jarvis/server-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100, 200);
  const rows = await db.eventLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ ok: true, logs: rows.map(toLogDTO) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { kind?: string; message?: string; meta?: unknown };
    const message = (body.message ?? "").toString().slice(0, 500);
    if (!message) return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
    const kind = ["info", "success", "warning", "error", "system"].includes(body.kind ?? "")
      ? (body.kind as "info" | "success" | "warning" | "error" | "system")
      : "info";
    await logEvent(kind, message, body.meta);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
