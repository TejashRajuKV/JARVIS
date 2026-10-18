"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Side panel host — desktop: fixed right column (400px) with tabs;
// mobile: the same tabs inside a right-side Sheet opened from the bottom
// tab bar (store.panelOpenMobile). Tab state lives in store.panel.
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentType } from "react";
import {
  BellRing,
  Bot,
  Brain,
  Cpu,
  ListChecks,
  ScrollText,
  type LucideProps,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { PanelId } from "@/lib/jarvis/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { SystemPanel } from "@/components/jarvis/system-panel";
import { TasksPanel } from "@/components/jarvis/tasks-panel";
import { RemindersPanel } from "@/components/jarvis/reminders-panel";
import { MemoryPanel } from "@/components/jarvis/memory-panel";
import { AgentPanel } from "@/components/jarvis/agent-panel";
import { LogPanel } from "@/components/jarvis/log-panel";
import { cn } from "@/lib/utils";

export const PANEL_TABS: {
  id: PanelId;
  label: string;
  short: string;
  icon: ComponentType<LucideProps>;
}[] = [
  { id: "system", label: "SYSTEM", short: "SYS", icon: Cpu },
  { id: "tasks", label: "TASKS", short: "TASK", icon: ListChecks },
  { id: "reminders", label: "REMINDERS", short: "ALERT", icon: BellRing },
  { id: "memory", label: "MEMORY", short: "MEM", icon: Brain },
  { id: "agent", label: "AGENT", short: "AGT", icon: Bot },
  { id: "log", label: "LOG", short: "LOG", icon: ScrollText },
];

function PanelTabs({ compact }: { compact?: boolean }) {
  const panel = useJarvisStore((s) => s.panel);
  const setPanel = useJarvisStore((s) => s.setPanel);

  return (
    <Tabs
      value={panel}
      onValueChange={(v) => setPanel(v as PanelId)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="border-b border-cyan-400/15 px-2 py-2">
        <TabsList className="flex h-8 w-full items-center gap-0.5 overflow-x-auto rounded-md bg-cyan-400/[0.04] p-0.5">
          {PANEL_TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              aria-label={`${t.label} panel`}
              className="h-7 flex-1 gap-1 rounded px-1.5 font-mono text-[9px] tracking-[0.12em] text-muted-foreground data-[state=active]:border data-[state=active]:border-cyan-300/40 data-[state=active]:bg-cyan-400/10 data-[state=active]:text-cyan-200 data-[state=active]:shadow-[0_0_10px_rgba(34,211,238,0.12)]"
            >
              <t.icon className="size-3" aria-hidden="true" />
              <span className={compact ? "hidden sm:inline" : "inline"}>{t.short}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="system" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
        <SystemPanel />
      </TabsContent>
      <TabsContent value="tasks" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
        <TasksPanel />
      </TabsContent>
      <TabsContent value="reminders" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
        <RemindersPanel />
      </TabsContent>
      <TabsContent value="memory" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
        <MemoryPanel />
      </TabsContent>
      <TabsContent value="agent" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
        <AgentPanel />
      </TabsContent>
      <TabsContent value="log" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
        <LogPanel />
      </TabsContent>
    </Tabs>
  );
}

export function SidePanel() {
  return (
    <aside
      aria-label="J.A.R.V.I.S. control panels"
      className="hud-corners hud-panel hidden min-h-0 flex-col overflow-hidden lg:flex"
    >
      <PanelTabs />
    </aside>
  );
}

export function MobileSidePanel() {
  const isMobile = useIsMobile();
  const open = useJarvisStore((s) => s.panelOpenMobile);
  const setOpen = useJarvisStore((s) => s.setPanelOpenMobile);

  if (!isMobile) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="hud-panel w-full gap-0 border-l border-cyan-400/25 p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-cyan-400/15 pb-3">
          <SheetTitle className="hud-glow-text font-mono text-xs tracking-[0.35em] text-cyan-200">
            CONTROL PANELS
          </SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <PanelTabs compact />
        </div>
      </SheetContent>
    </Sheet>
  );
}
