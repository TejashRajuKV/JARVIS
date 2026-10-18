// GET /api/memory?q= — search facts · POST — upsert · DELETE ?id= — forget
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logEvent, memoryKeyFrom, toMemoryDTO, upsertMemory } from "@/lib/jarvis/server-utils";
import type { MemoryFactDTO } from "@/lib/jarvis/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const rows = await db.memoryFact.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const facts = rows
    .map(toMemoryDTO)
    .filter((f: MemoryFactDTO) => !q || f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q));
  return NextResponse.json({ ok: true, facts }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: string; kind?: string };
    const value = (body.value ?? "").toString().trim().slice(0, 240);
    if (!value) {
      return NextResponse.json({ ok: false, error: "value required" }, { status: 400 });
    }
    const kind = ["fact", "preference", "project", "person"].includes(body.kind ?? "")
      ? (body.kind as MemoryFactDTO["kind"])
      : "fact";
    const key = (body.key ?? "").toString().trim().slice(0, 64) || memoryKeyFrom(value);
    const fact = await upsertMemory(key, value, kind);
    await logEvent("info", `Learned: ${fact.key} = ${fact.value}`);
    return NextResponse.json({ ok: true, fact }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await db.memoryFact.delete({ where: { id } }).catch(() => undefined);
  await logEvent("info", "Memory fact deleted");
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
