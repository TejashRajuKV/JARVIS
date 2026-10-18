"use client";

// ─────────────────────────────────────────────────────────────────────────────
// J.A.R.V.I.S. Web Console — page assembly (task 2-a).
// Boot overlay → HUD shell: header, chat column + side panel (desktop) /
// Sheet + bottom tab bar (mobile), sticky footer, alert host, command
// palette, settings drawer, HUD frame. Dark deep-space theme, cyan glow.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { Command, Settings2 } from "lucide-react";
import { useJarvisStore } from "@/lib/jarvis/store";
import type {
  EventLogDTO,
  MemoryFactDTO,
  MessageDTO,
  ReminderDTO,
  SettingsDTO,
  TaskDTO,
} from "@/lib/jarvis/types";
import {
  asArray,
  fetchJson,
  formatClock,
} from "@/lib/jarvis/client/ui-helpers";
import { AlertHost } from "@/components/jarvis/alert-host";
import { BootScreen } from "@/components/jarvis/boot-screen";
import { ChatPanel } from "@/components/jarvis/chat-panel";
import { CommandPalette } from "@/components/jarvis/command-palette";
import { ConsoleEngines } from "@/components/jarvis/engines";
import { HudFrame } from "@/components/jarvis/hud-frame";
import { MobileSidePanel, SidePanel, PANEL_TABS } from "@/components/jarvis/side-panel";
import { SettingsDrawer } from "@/components/jarvis/settings-drawer";
import { StatusFooter } from "@/components/jarvis/status-footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function HeaderClock() {
  // client-only clock; initial placeholder avoids hydration mismatch
  useEffect(() => {
    const el = document.getElementById("header-clock");
    const tick = () => {
      if (el) el.textContent = formatClock(new Date());
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span
      id="header-clock"
      className="hidden font-mono text-xs tabular-nums text-cyan-200/80 md:inline"
      aria-label="Client time"
    >
      --:--:--
    </span>
  );
}

function MobileTabBar() {
  const panel = useJarvisStore((s) => s.panel);
  const setPanel = useJarvisStore((s) => s.setPanel);

  return (
    <nav
      aria-label="Control panels"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-cyan-400/20 bg-[#04090d]/95 backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-6 px-1">
        {PANEL_TABS.map((t) => {
          const active = panel === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPanel(t.id)}
              aria-label={`Open ${t.label.toLowerCase()} panel`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 font-mono text-[9px] tracking-[0.12em] transition-colors",
                active
                  ? "text-cyan-200"
                  : "text-muted-foreground hover:text-cyan-300/80"
              )}
            >
              <t.icon
                className={cn(
                  "size-4",
                  active && "drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]"
                )}
                aria-hidden="true"
              />
              <span className={cn(active && "border-b border-cyan-300/60 pb-px")}>
                {t.short}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function Home() {
  const booted = useJarvisStore((s) => s.booted);
  const setPaletteOpen = useJarvisStore((s) => s.setPaletteOpen);

  // force the existing .dark token block site-wide (portals render outside
  // the .jarvis-hud scope); original :root tokens remain untouched on disk
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // global Ctrl/Cmd+K → command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const s = useJarvisStore.getState();
        s.setPaletteOpen(!s.paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // hydrate caches from the core APIs (tolerates 404s while task 2-b lands)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, chat, reminders, tasks, memories, logs] = await Promise.all([
        fetchJson<SettingsDTO>("/api/settings"),
        fetchJson<unknown>("/api/chat?sessionId=default&limit=30"),
        fetchJson<unknown>("/api/reminders"),
        fetchJson<unknown>("/api/tasks"),
        fetchJson<unknown>("/api/memory"),
        fetchJson<unknown>("/api/log?limit=100"),
      ]);
      if (cancelled) return;
      const s = useJarvisStore.getState();

      if (settings.data) {
        // /api/settings returns { ok, settings } — unwrap before hydrating
        const payload = settings.data as unknown as { settings?: SettingsDTO };
        if (payload.settings) s.hydrateSettings(payload.settings);
      }

      if (chat.data) {
        const dtos = asArray<MessageDTO>(chat.data, ["messages"]);
        s.setMessages(
          dtos.map((m) => ({
            ...m,
            meta: m.meta ?? null,
            // history messages are rendered fully revealed (no typing anim)
            revealed: m.content.length,
            pending: false,
          }))
        );
      }

      if (reminders.data) s.setReminders(asArray<ReminderDTO>(reminders.data, ["reminders"]));
      if (tasks.data) s.setTasks(asArray<TaskDTO>(tasks.data, ["tasks"]));
      if (memories.data) s.setMemories(asArray<MemoryFactDTO>(memories.data, ["facts", "memories"]));
      if (logs.data) s.setLogs(asArray<EventLogDTO>(logs.data, ["logs", "events"]));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="jarvis-hud hud-bg relative flex min-h-dvh flex-col text-foreground">
        <HudFrame />

        {booted ? (
          <>
            {/* header */}
            <header className="sticky top-0 z-30 border-b border-cyan-400/15 bg-[#03070a]/85 backdrop-blur-md">
              <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3 sm:px-4">
                <span
                  aria-hidden="true"
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/40"
                >
                  <span className="size-2.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                  <span className="hud-spin-slow absolute inset-0 rounded-full border border-dashed border-cyan-400/30" />
                </span>
                <div className="min-w-0">
                  <h1 className="hud-glow-text font-mono text-sm font-semibold tracking-[0.3em] text-cyan-100">
                    J.A.R.V.I.S.
                  </h1>
                  <p className="micro-label hidden sm:block">Web console // stark-class assistant</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="hidden items-center gap-1.5 rounded border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] text-teal-300 sm:flex">
                    <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-teal-300" />
                    CORE ONLINE
                  </span>
                  <HeaderClock />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open command palette (Ctrl+K)"
                    onClick={() => setPaletteOpen(true)}
                    className="size-10 text-muted-foreground hover:text-cyan-300"
                  >
                    <Command className="size-4" aria-hidden="true" />
                  </Button>
                  <HeaderSettingsButton />
                </div>
              </div>
            </header>

            {/* main */}
            <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 pb-20 pt-3 sm:px-4 lg:pb-4">
              <div className="grid min-h-0 items-stretch gap-4 lg:h-[calc(100dvh-9.5rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
                <section
                  aria-label="Conversation with J.A.R.V.I.S."
                  className="hud-corners hud-panel flex h-[68vh] min-h-0 flex-col overflow-hidden lg:h-auto"
                >
                  <ChatPanel />
                </section>
                <SidePanel />
              </div>
            </main>

            <MobileTabBar />
            <StatusFooter />
          </>
        ) : (
          <BootScreen />
        )}

        {/* overlays + client intelligence engines */}
        <ConsoleEngines />
        <AlertHost />
        <CommandPalette />
        <SettingsDrawer />
        <MobileSidePanel />
      </div>
    </MotionConfig>
  );
}

function HeaderSettingsButton() {
  const setSettingsOpen = useJarvisStore((s) => s.setSettingsOpen);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Open settings"
      onClick={() => setSettingsOpen(true)}
      className="size-10 text-muted-foreground hover:text-cyan-300"
    >
      <Settings2 className="size-4" aria-hidden="true" />
    </Button>
  );
}
