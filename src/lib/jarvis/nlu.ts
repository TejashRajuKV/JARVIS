// ─────────────────────────────────────────────────────────────────────────────
// nlu.ts — local rule engine: normalization, speech correction, intent rules,
// and natural-language time parsing. Ported in spirit from JARVIS upstream
// (nlu.js / speechfix.js): fast, offline-first, deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import type { TelemetrySnapshot } from "./types";

export interface RuleResult {
  intent: string;
  confidence: number; // 0..1  (>=0.8 routes locally)
  args: Record<string, string>;
  normalized: string;
}

export interface RuleContext {
  now: Date;
  timezone?: string;
  telemetry?: TelemetrySnapshot;
}

// ── Speech repair (misheard phrases) ────────────────────────────────────────

const CORRECTIONS: [RegExp, string][] = [
  [/\bfront\s*-?\s*and\b/gi, "frontend"],
  [/\bback[\s-]+end\b/gi, "backend"],
  [/\bjava[\s-]+script\b/gi, "javascript"],
  [/\bnode[\s-]+j[\s-]*s\b/gi, "nodejs"],
  [/\bvs[\s-]+code\b/gi, "vscode"],
  [/\b(get|git)[\s-]+hub\b/gi, "github"],
  [/\bopen\s+crom+e?\b/gi, "open chrome"],
  [/\bwi[\s-]+fi\b/gi, "wifi"],
  [/\bn\s*p\s*m\b/gi, "npm"],
  [/\bbattery\s+percentage\b/gi, "battery"],
  [/\bremind\s+me\s+too\b/gi, "remind me to"],
  [/\bset\s+a\s+timer\s+for\b/gi, "remind me in"],
  [/\btell\s+me\s+the\s+time\b/gi, "what time is it"],
  [/\bwhat\s+day\s+is\s+(it\s+)?today\b/gi, "what is the date today"],
  [/\bwhats\b/gi, "what is"],
  [/\bsystem's\s+status\b/gi, "system status"],
  [/\ban\s+hour\b/gi, "1 hour"],
  [/\bhalf\s+an\s+hour\b/gi, "30 minutes"],
  [/\ba\s+couple\s+of\s+minutes\b/gi, "2 minutes"],
  [/\bfotry\b/gi, "forty"],
  [/\btwety\b/gi, "twenty"],
];

const NUMBER_WORDS: [RegExp, string][] = [
  [/\bninety\b/gi, "90"],
  [/\beighty\b/gi, "80"],
  [/\bseventy\b/gi, "70"],
  [/\bsixty\b/gi, "60"],
  [/\bfifty\b/gi, "50"],
  [/\bforty\s*five\b/gi, "45"],
  [/\bforty\b/gi, "40"],
  [/\bthirty\b/gi, "30"],
  [/\btwenty\b/gi, "20"],
  [/\bfifteen\b/gi, "15"],
  [/\bten\b/gi, "10"],
  [/\bnine\b/gi, "9"],
  [/\beight\b/gi, "8"],
  [/\bseven\b/gi, "7"],
  [/\bsix\b/gi, "6"],
  [/\bfive\b/gi, "5"],
  [/\bfour\b/gi, "4"],
  [/\bthree\b/gi, "3"],
  [/\btwo\b/gi, "2"],
  [/\bone\b/gi, "1"],
];

const FILLERS =
  /^(umm+|um+|uhh*|err+|hmm+|well|so|ok(ay)?|hey|yo)[\s,.]*/i;

export function normalizeInput(raw: string): string {
  let t = (raw ?? "").toString().trim();
  // strip leading wake word
  t = t.replace(/^(hey\s+|ok(ay)?\s+)?jarvis[\s,.:!-]+/i, "");
  t = t.replace(/^(hey\s+|ok(ay)?\s+)?friday[\s,.:!-]+/i, "");
  // strip edge fillers (a couple of passes)
  for (let i = 0; i < 3; i++) {
    t = t.replace(FILLERS, "").trim();
    t = t.replace(/[\s,.]+(please|thanks|thank you)[\s,.!]*$/i, "").trim();
    t = t.replace(/^(can|could)\s+you\s+(please\s+)?/i, "").trim();
    t = t.replace(/\s+(please|for\s+me)[\s.!]*$/i, "").trim();
  }
  t = t.replace(/\s{2,}/g, " ");
  return t;
}

export function applyCorrections(text: string): {
  corrected: string;
  corrections: string[];
} {
  let t = text;
  const corrections: string[] = [];
  for (const [re, right] of CORRECTIONS) {
    const m = t.match(re);
    if (m) {
      corrections.push(`${m[0]} → ${right}`);
      t = t.replace(re, right);
    }
  }
  for (const [re, num] of NUMBER_WORDS) {
    const m = t.match(re);
    if (m) {
      corrections.push(`${m[0]} → ${num}`);
      t = t.replace(re, num);
    }
  }
  return { corrected: t, corrections };
}

// ── Natural-language time parsing ───────────────────────────────────────────

export interface ParsedWhen {
  fireAt: Date | null;
  title: string;
  repeat?: string;
  matchedText?: string;
}

const MIN = 60_000;

function atTime(base: Date, hours: number, minutes: number, tomorrow = false): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  if (tomorrow || d.getTime() <= base.getTime()) {
    if (tomorrow || d.getTime() <= base.getTime()) d.setDate(d.getDate() + (tomorrow ? 1 : d.getTime() <= base.getTime() ? 1 : 0));
  }
  return d;
}

function parseClock(hhmm: string, meridiem?: string): { h: number; m: number } | null {
  const m = hhmm.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return null;
  const md = (meridiem ?? "").toLowerCase();
  if (md.startsWith("p") && h < 12) h += 12;
  if (md.startsWith("a") && h === 12) h = 0;
  return { h, m: min };
}

/**
 * Extracts a time expression from free text.
 * Supports: "in 20 minutes", "in 1 hour", "at 5pm", "at 17:30",
 * "tomorrow at 9am", "tonight at 8", "every day at 9am", "this evening".
 */
export function parseWhen(text: string, now: Date): ParsedWhen {
  let title = text;
  let fireAt: Date | null = null;
  let repeat: string | undefined;
  let matchedText: string | undefined;

  const rel = text.match(
    /\bin\s+(\d+)\s*(second|sec|s|minute|min|minutes|mins|m|hour|hr|hours|hrs|h)\b(?:\s+(\d+)\s*(second|sec|minute|min|hour|hr)s?)?/i
  );
  if (rel) {
    const units: Record<string, number> = {
      s: 1000, sec: 1000, second: 1000, seconds: 1000,
      m: MIN, min: MIN, mins: MIN, minute: MIN, minutes: MIN,
      h: 60 * MIN, hr: 60 * MIN, hrs: 60 * MIN, hour: 60 * MIN, hours: 60 * MIN,
    };
    const a = parseInt(rel[1], 10) * units[rel[2].toLowerCase()];
    const b = rel[3] ? parseInt(rel[3], 10) * units[rel[4].toLowerCase()] : 0;
    fireAt = new Date(now.getTime() + a + b);
    matchedText = rel[0];
    title = text.replace(rel[0], " ");
  }

  if (!fireAt) {
    const clock = text.match(
      /\b(?:at|@)\s+(\d{1,2}(?::\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?\b/i
    );
    if (clock) {
      const t = parseClock(clock[1], clock[2]);
      if (t) {
        const tomorrow = /\btomorrow\b/i.test(text);
        fireAt = atTime(now, t.h, t.m, tomorrow);
        matchedText = clock[0];
        title = text.replace(clock[0], " ").replace(/\btomorrow\b/i, " ");
      }
    }
  }

  if (!fireAt) {
    const tonight = text.match(/\btonight\b/i);
    const evening = text.match(/\bthis\s+evening\b/i);
    const morning = text.match(/\bthis\s+morning\b|\btomorrow\s+morning\b/i);
    if (tonight || evening || morning) {
      const h = evening ? 18 : morning ? 9 : 20;
      fireAt = atTime(now, h, 0, /tomorrow/i.test(text));
      matchedText = (tonight ?? evening ?? morning)![0];
      title = text.replace(matchedText, " ").replace(/\btomorrow\b/i, " ");
    }
  }

  const every = text.match(/\bevery\s+(day|morning|evening|night)\b(?:\s+at\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)?)?/i);
  if (every) {
    repeat = every[0];
    const t = every[2] ? parseClock(every[2], every[3]) : null;
    const h = t ? t.h : every[1].toLowerCase() === "morning" ? 8 : 20;
    const base = fireAt ?? atTime(now, h, t ? t.m : 0, false);
    fireAt = t ? atTime(now, h, t.m, false) : base;
    title = text.replace(every[0], " ");
  }

  title = title
    .replace(/\bremind\s+(me\s+)?(to|about|that|for)?\b/gi, " ")
    .replace(/\bset\s+(a\s+)?reminder\s+(to|for|that)?\b/gi, " ")
    .replace(/\bcan\s+you\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "");

  if (!title) title = text.trim();

  return { fireAt, title, repeat, matchedText };
}

// ── Rule classifier ─────────────────────────────────────────────────────────

const PANEL_WORDS: [RegExp, string][] = [
  [/\bsettings?\b/, "settings"],
  [/\btasks?\b|\btodo\b|\tto-?do\b/, "tasks"],
  [/\breminders?\b|\balarms?\b/, "reminders"],
  [/\bmemory\b|\bmemories\b|\bwhat you know\b/, "memory"],
  [/\bagent\b|\bautomation\b/, "agent"],
  [/\blog\b|\bactivity\b|\bhistory\b/, "log"],
  [/\bsystem\b|\btelemetry\b|\bdashboard\b|\bstatus\b/, "system"],
];

function negated(text: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - 24);
  const before = text.slice(windowStart, matchIndex);
  return /\b(don'?t|do\s+not|never\s+mind|no\s+need|cancel)\b/i.test(before);
}

export function ruleClassify(heard: string, ctx: RuleContext): RuleResult {
  const t = heard.toLowerCase().trim();
  const mk = (intent: string, confidence: number, args: Record<string, string> = {}): RuleResult =>
    ({ intent, confidence, args, normalized: heard });

  if (!t) return mk("conversation", 0);

  // helper to test with negation guard
  const test = (re: RegExp): RegExpMatchArray | null => {
    const m = t.match(re);
    if (!m) return null;
    if (negated(t, m.index ?? 0)) return null;
    return m;
  };

  // — system control (highest priority) —
  let m = test(/\b(panic|emergency\s*(mode|stop)|stop\s+(all|everything)|shut\s+it\s+down|code\s+red)\b/);
  if (m) return mk("panic", 0.97);
  m = test(/\b(resume|resume\s+operations|back\s+online|all\s+clear|continue\s+operations)\b/);
  if (m) return mk("resume", 0.95);
  m = test(/\b(clear|wipe|reset)\s+(the\s+)?(chat|conversation|screen|history)\b/) || test(/^(start\s+over|new\s+conversation)$/);
  if (m) return mk("clear_chat", 0.96);
  m = test(/^mute(d)?$|\b mute\b|\b(silence|be\s+quiet|stop\s+talking|quiet\s+mode)\b/);
  if (m) return mk("mute", 0.94);
  m = test(/\bunmute\b|\bvoice\s+on\b|\bspeak\s+(again|up)\b/);
  if (m) return mk("unmute", 0.94);
  m = test(/\b(start\s+listening|listen\s+to\s+me|voice\s+mode|mic(rophone)?\s+on|activate\s+voice)\b/);
  if (m) return mk("voice_start", 0.93);

  // — identity / help —
  m = t.match(/\b(who|what)\s+are\s+you\b|\bintroduce\s+yourself\b|\byour\s+name\b/);
  if (m) return mk("identity", 0.95);
  m = t.match(/\bhelp\b|\bwhat\s+can\s+you\s+do\b|\byour\s+(commands|capabilities|skills)\b|\bhow\s+do\s+i\s+use\b/);
  if (m) return mk("help", 0.93);

  // — persona / name —
  m = test(/\b(switch|change|go)\s+(back\s+)?(to\s+)?(being\s+)?(jarvis|friday)\b|\bbe\s+(jarvis|friday)\b/);
  if (m) {
    const persona = /friday/.test(m[0]) ? "friday" : "jarvis";
    return mk("personality_switch", 0.95, { persona });
  }
  m = test(/\bcall\s+me\s+([a-z][a-z\s'-]{1,24})$|\bmy\s+name\s+is\s+([a-z][a-z\s'-]{1,24})$/);
  if (m) return mk("set_name", 0.93, { name: (m[1] ?? m[2]).trim() });

  // — greeting —
  m = t.match(/^(hi+|hello+|hey+|good\s*(morning|afternoon|evening)|namaste|greetings)\b/);
  if (m) return mk("greeting", 0.95);

  // — time / date —
  m = t.match(/\b(what'?s?\s+the\s+time|what\s+time\s+is\s+it|current\s+time|the\s+time\s+(now|please)|time\s+now)\b/);
  if (m) return mk("time", 0.95);
  m = t.match(/\b(what'?s?\s+the\s+date|what\s+is\s+the\s+date\s+(today|now)|today'?s\s+date|what\s+day\s+is\s+it|which\s+day\s+is\s+today)\b/);
  if (m) return mk("date", 0.95);

  // — telemetry —
  m = t.match(/\bbattery\b/);
  if (m) return mk("battery_query", 0.92);
  m = t.match(/\b(network|wifi|internet\s+(speed|status|connection)|connection\s+status|online\s+status|latency|ping)\b/);
  if (m) return mk("network_query", 0.9);
  m = t.match(/\b(storage|disk\s*(space|usage)?|how\s+much\s+space)\b/);
  if (m) return mk("storage_query", 0.9);
  m = t.match(/\b(system\s+(status|health|report|info)|diagnostics|telemetry|status\s+report|how('s| is)\s+(the\s+)?(system|laptop|machine|pc|computer))\b/);
  if (m) return mk("system_status", 0.93);

  // — memory —
  m = test(/^remember\b(.+)$/);
  if (m) {
    const value = m[1].replace(/^\s*(that|this|to)\s+/, "").trim();
    return mk("memory_remember", 0.94, { value });
  }
  m = t.match(/\bwhat\s+do\s+you\s+(remember|know)(\s+about\s+me)?\b|\brecall\b|\byour\s+memories\b|\bwhat\s+have\s+you\s+learned\b/);
  if (m) return mk("memory_recall", 0.93);
  m = test(/\bforget\b(\s+(that|about|the|my))?\s*(.*)$/);
  if (m) return mk("memory_forget", 0.9, { value: (m[3] ?? "").trim() });

  // — tasks —
  m = test(/^(add|create|new)\s+(a\s+)?(task|todo|to-do)\b[:\s]*(.+)$/);
  if (m) return mk("task_add", 0.94, { title: m[4].trim() });
  m = test(/^add\s+(.+?)\s+to\s+my\s+(task|todo|to-do)s?\s*list$/);
  if (m) return mk("task_add", 0.92, { title: m[1].trim() });
  m = test(/^(add|create)\s+a?\s?(high|low)?\s*-?\s*(priority\s+)?task[:\s]+(.+)$/);
  if (m) return mk("task_add", 0.9, { title: m[4].trim(), priority: m[2] ? m[2].trim() : "normal" });
  m = t.match(/\b(list|show|what\s+are|what'?s)\s+(my\s+)?(tasks|todos|to-?dos|task\s+list|todo\s+list)\b|\bmy\s+tasks\b/);
  if (m) return mk("task_list", 0.93);
  m = test(/\b(complete|finish|mark|check\s+off|done\s+with)\s+(the\s+)?(task\s+)?(.+)$/) || test(/^(task|todo)\s+(.*)\s+is\s+done$/);
  if (m) {
    const match = (m[4] ?? m[2] ?? "").trim().replace(/\s+is\s+done$/, "").replace(/\s+as\s+done$/, "");
    return mk("task_done", 0.85, { match });
  }

  // — reminders —
  m = test(/\bremind(s|er)?\b|\breminder\b/);
  if (m) {
    const when = parseWhen(t, ctx.now);
    if (when.fireAt) {
      return mk("reminder_set", 0.94, {
        title: when.title,
        fireAt: when.fireAt.toISOString(),
        repeat: when.repeat ?? "",
      });
    }
    if (/\bremind\s+me\b|\bset\s+(a\s+)?reminder\b/.test(t)) {
      return mk("reminder_set", 0.72, { title: when.title }); // LLM will clarify timing
    }
    return mk("reminder_list", 0.9);
  }
  m = t.match(/\b(list|show|any|what)\s+(my\s+)?reminders\b|\bwhat\s+reminders\b/);
  if (m) return mk("reminder_list", 0.92);

  // — open panel —
  m = test(/^open\s+(the\s+)?(.+)$/) || test(/^show\s+(me\s+)?(the\s+)?(.+)$/);
  if (m) {
    const target = (m[2] ?? m[3] ?? "").toLowerCase();
    for (const [re, panel] of PANEL_WORDS) {
      if (re.test(target)) return mk("open_panel", 0.9, { panel });
    }
  }

  // — agent —
  m = test(/\b(multi[-\s]?step|agent|automat(e|ion)|workflow)\b/);
  if (m) {
    const goal =
      t.replace(/^.*(multi[-\s]?step\s*(agent)?|agent|automat(e|ion)|workflow)\s*(to|for|:)?\s*/, "").trim() ||
      t;
    return mk("agent_run", 0.86, { goal });
  }

  // — explicit web search —
  m = test(/^(search|google|look\s?up|find)\s+(the\s+web\s+)?(for\s+)?(.+)$/);
  if (m && !/task|reminder|file|folder/.test(m[4])) {
    return mk("search_web", 0.9, { query: m[4].trim() });
  }

  return mk("conversation", 0); // unknown → LLM decision layer
}
