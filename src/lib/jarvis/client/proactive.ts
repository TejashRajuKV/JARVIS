"use client";

// ─────────────────────────────────────────────────────────────────────────────
// proactive.ts — proactive intelligence (workstream F): genuinely useful,
// never interrupting. Reminders due → HUD alert + voice. Battery thresholds →
// one-shot advisories. Time-aware gentle suggestions, throttled and
// dismissible; fully silenced by DND / panic mode.
// ─────────────────────────────────────────────────────────────────────────────

import { useJarvisStore } from "@/lib/jarvis/store";
import { fetchJson, logEvent, speak } from "./ui-helpers";
import type { ReminderDTO } from "@/lib/jarvis/types";

let lastBatteryAdvisory = "";
let lastChargingState: boolean | null = null;
let lastSuggestionAt = 0;
let lastMessageAt = Date.now();
let suggestionTimer: ReturnType<typeof setTimeout> | null = null;

function proactiveAllowed(): boolean {
  const s = useJarvisStore.getState();
  return (
    s.booted &&
    s.settings.autonomy === "proactive" &&
    !s.settings.dnd &&
    !s.busy
  );
}

// ── reminders (server is the source of truth; polled every 30s) ─────────────

async function pollReminders(): Promise<void> {
  try {
    const { data } = await fetchJson<{ due?: ReminderDTO[] }>("/api/reminders?due=1");
    const due = data?.due ?? [];
    if (!due.length) return;
    const store = useJarvisStore.getState();
    for (const r of due) {
      store.pushAlert({ id: r.id, title: r.title, kind: "reminder" });
      store.setReminders(
        store.reminders.map((x) => (x.id === r.id ? { ...x, status: "fired" } : x))
      );
      if (proactiveAllowed()) {
        speak(`Reminder, ${store.settings.userName}: ${r.title}`);
      }
    }
    if (proactiveAllowed()) useJarvisStore.getState().setSuggestion(null);
  } catch {
    /* silent — poll will retry */
  }
}

// ── battery advisories (one-shot per threshold crossing) ────────────────────

function watchBattery(): void {
  const nav = navigator as unknown as {
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      addEventListener: (t: string, fn: () => void) => void;
    }>;
  };
  if (!nav.getBattery) return;
  nav
    .getBattery()
    .then((b) => {
      const evaluate = () => {
        const store = useJarvisStore.getState();
        const pct = Math.round(b.level * 100);
        const chargingTransition = lastChargingState !== null && lastChargingState !== b.charging;
        lastChargingState = b.charging;
        let advisory: { key: string; title: string } | null = null;

        if (!b.charging && b.level <= 0.1) {
          advisory = { key: "critical", title: `Battery critical — ${pct}%. Plug in now.` };
        } else if (!b.charging && b.level <= 0.2) {
          advisory = { key: "low", title: `Battery low — ${pct}%. Consider connecting power.` };
        } else if (b.charging && b.level >= 0.98 && chargingTransition) {
          // only announce "full" after an actual charging transition, not on page load
          advisory = { key: "full", title: "Battery fully charged — you may disconnect power." };
        }

        if (advisory && advisory.key !== lastBatteryAdvisory) {
          lastBatteryAdvisory = advisory.key;
          store.pushAlert({ id: `battery-${advisory.key}-${Date.now()}`, title: advisory.title, kind: "battery" });
          logEvent("warning", advisory.title);
          if (proactiveAllowed()) speak(advisory.title);
        }
        if (b.charging && b.level > 0.2 && b.level < 0.98) lastBatteryAdvisory = "";
      };
      evaluate();
      b.addEventListener("levelchange", evaluate);
      b.addEventListener("chargingchange", evaluate);
    })
    .catch(() => undefined);
}

// ── gentle suggestions (max one per 6 minutes, auto-expire in 90s) ──────────

function pickSuggestion(): string | null {
  const s = useJarvisStore.getState();
  const hour = new Date().getHours();
  const openTasks = s.tasks.filter((t) => t.status !== "done");
  const nextReminder = s.reminders
    .filter((r) => r.status === "scheduled" && new Date(r.fireAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime())[0];
  const battery = s.telemetry.battery;

  if (battery && !battery.charging && battery.level <= 0.2) {
    return `Battery is at ${Math.round(battery.level * 100)}% — shall I check the power status panel?`;
  }
  if (openTasks.length >= 3) {
    return `You have ${openTasks.length} open tasks — want the top of the list?`;
  }
  if (nextReminder) {
    const mins = Math.round((new Date(nextReminder.fireAt).getTime() - Date.now()) / 60000);
    return `"${nextReminder.title}" fires in about ${mins} minute${mins === 1 ? "" : "s"}. Need anything before then?`;
  }
  if (openTasks.length > 0) {
    return `Task "${openTasks[0].title}" is still open — mark it done when you're ready.`;
  }
  if (hour >= 22 || hour < 6) {
    return "It's late — shall I set a reminder to rest your eyes?";
  }
  return null;
}

function suggestionTick(): void {
  if (!proactiveAllowed()) return;
  const now = Date.now();
  if (now - lastSuggestionAt < 6 * 60_000) return;
  if (now - lastMessageAt < 3 * 60_000) return;
  const s = pickSuggestion();
  if (!s) return;
  lastSuggestionAt = now;
  useJarvisStore.getState().setSuggestion(s);
  if (suggestionTimer) clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(() => {
    useJarvisStore.getState().setSuggestion(null);
  }, 90_000);
}

export function initProactive(): void {
  if (typeof window === "undefined") return;

  // track conversation activity so we never talk over the user
  const bumpActivity = () => {
    lastMessageAt = Date.now();
  };
  window.addEventListener("jarvis:speak", bumpActivity);
  window.addEventListener("jarvis:sound", bumpActivity);

  // reminders poll
  void pollReminders();
  window.setInterval(() => void pollReminders(), 30_000);

  // battery advisories
  watchBattery();

  // suggestion loop
  window.setInterval(suggestionTick, 60_000);
}
