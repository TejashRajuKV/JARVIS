// ─────────────────────────────────────────────────────────────────────────────
// search.ts — web search via z-ai-web-dev-sdk (backend only), with retries.
// ─────────────────────────────────────────────────────────────────────────────

import type { SearchResultItem } from "./types";

interface RawSearchItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank?: number;
  date?: string;
  favicon?: string;
}

let searchFn: ((args: { query: string; num: number }) => Promise<RawSearchItem[]>) | null = null;

async function getSearchFn() {
  if (!searchFn) {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    searchFn = (args) => zai.functions.invoke("web_search", args);
  }
  return searchFn;
}

export async function webSearch(query: string, num = 6): Promise<SearchResultItem[]> {
  const fn = await getSearchFn();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const withTimeout = Promise.race([
        fn({ query, num }),
        new Promise<RawSearchItem[]>((_, rej) => setTimeout(() => rej(new Error("search timeout")), 20_000)),
      ]);
      const raw = await withTimeout;
      if (!Array.isArray(raw)) throw new Error("invalid search response");
      return raw.slice(0, num).map((r) => ({
        url: r.url,
        name: r.name,
        snippet: r.snippet,
        host_name: r.host_name,
        date: r.date,
      }));
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  console.error("[jarvis:search] failed after retries:", lastErr);
  return [];
}
