// GET /api/tasks · POST · PATCH · DELETE ?id=
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent, toTaskDTO } from "@/lib/jarvis/server-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.task.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100 });
  return NextResponse.json({ ok: true, tasks: rows.map(toTaskDTO) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      priority?: string;
      project?: string;
      dueAt?: string;
    };
    const title = (body.title ?? "").toString().trim().slice(0, 200);
    if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    const row = await db.task.create({
      data: {
        title,
        priority: ["low", "normal", "high"].includes(body.priority ?? "") ? body.priority! : "normal",
        project: body.project?.toString().slice(0, 80) || null,
        dueAt: dueAt && !isNaN(dueAt.getTime()) ? dueAt : null,
      },
    });
    await logEvent("info", `Task added: ${row.title}`);
    return NextResponse.json({ ok: true, task: toTaskDTO(row) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: string;
      title?: string;
      status?: string;
      priority?: string;
      project?: string;
      dueAt?: string | null;
    };
    if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (body.title) data.title = body.title.toString().slice(0, 200);
    if (body.status && ["open", "doing", "done"].includes(body.status)) data.status = body.status;
    if (body.priority && ["low", "normal", "high"].includes(body.priority)) data.priority = body.priority;
    if (body.project !== undefined) data.project = body.project?.toString().slice(0, 80) || null;
    if (body.dueAt !== undefined) {
      const d = body.dueAt ? new Date(body.dueAt) : null;
      data.dueAt = d && !isNaN(d.getTime()) ? d : null;
    }
    const row = await db.task.update({ where: { id: body.id }, data });
    if (body.status === "done") await logEvent("success", `Task completed: ${row.title}`);
    return NextResponse.json({ ok: true, task: toTaskDTO(row) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await db.task.delete({ where: { id } }).catch(() => undefined);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
