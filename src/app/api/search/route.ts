// POST /api/search {query} — web search + snippet-grounded summary
import { NextRequest, NextResponse } from "next/server";
import { webSearch } from "@/lib/jarvis/search";
import { summarizeSnippets } from "@/lib/jarvis/brain";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { query?: string };
    const query = (body.query ?? "").toString().trim().slice(0, 300);
    if (!query) return NextResponse.json({ ok: false, error: "query required" }, { status: 400 });

    const results = await webSearch(query, 6);
    const summary = results.length ? await summarizeSnippets(query, results) : "";
    return NextResponse.json(
      { ok: true, query, results, summary },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
