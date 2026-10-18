// GET /api/reminders[?due=1] · POST · PATCH · DELETE ?id=
// ?due=1 returns scheduled reminders whose fireAt <= now, marking them fired
// (the HUD polls this every 30s to raise alerts + voice announcements).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent, toReminderDTO } from "@/lib/jarvis/server-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const due = req.nextUrl.searchParams.get("due") === "1";
  if (due) {
    const now = new Date();
    const dueRows = await db.reminder.findMany({
      where: { status: "scheduled", fireAt: { lte: now } },
      orderBy: { fireAt: "asc" },
      take: 10,
    });
    if (dueRows.length) {
      await db.reminder.updateMany({
        where: { id: { in: dueRows.map((r) => r.id) } },
        data: { status: "fired", lastFiredAt: now },
      });
      for (const r of dueRows) await logEvent("warning", `Reminder fired: ${r.title}`);
    }
    return NextResponse.json(
      { ok: true, due: dueRows.map(toReminderDTO) },
      { headers: { "cache-control": "no-store" } }
    );
  }
  const rows = await db.reminder.findMany({ orderBy: { fireAt: "asc" }, take: 50 });
  return NextResponse.json({ ok: true, reminders: rows.map(toReminderDTO) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { title?: string; fireAt?: string };
    const title = (body.title ?? "").toString().trim().slice(0, 200);
    const fireAt = body.fireAt ? new Date(body.fireAt) : null;
    if (!title || !fireAt || isNaN(fireAt.getTime())) {
      return NextResponse.json({ ok: false, error: "title and valid fireAt required" }, { status: 400 });
    }
    const row = await db.reminder.create({ data: { title, fireAt } });
    await logEvent("info", `Reminder set: ${row.title} at ${row.fireAt.toISOString()}`);
    return NextResponse.json({ ok: true, reminder: toReminderDTO(row) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; status?: string };
    if (!body.id || !["scheduled", "fired", "cancelled", "done"].includes(body.status ?? "")) {
      return NextResponse.json({ ok: false, error: "id and valid status required" }, { status: 400 });
    }
    const row = await db.reminder.update({
      where: { id: body.id },
      data: { status: body.status, lastFiredAt: body.status === "fired" ? new Date() : undefined },
    });
    return NextResponse.json({ ok: true, reminder: toReminderDTO(row) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await db.reminder.delete({ where: { id } }).catch(() => undefined);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
