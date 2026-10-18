// GET /api/settings · POST {key, value}
import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettingKV } from "@/lib/jarvis/server-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ ok: true, settings }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: string };
    const key = (body.key ?? "").toString();
    const value = (body.value ?? "").toString();
    if (!key) return NextResponse.json({ ok: false, error: "key required" }, { status: 400 });
    const settings = await setSettingKV(key, value);
    return NextResponse.json({ ok: true, settings }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
