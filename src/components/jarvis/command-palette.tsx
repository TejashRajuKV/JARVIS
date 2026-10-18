"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Command palette — shadcn Command inside Dialog, opened via store.paletteOpen
// and the global Ctrl/Cmd+K listener in page.tsx.
// Groups: Panels · Conversation · Tasks · Settings · Skills reference.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BellRing,
  Bot,
  Brain,
  Command as CommandIcon,
  Cpu,
  Eye,
  Hand,
  ListChecks,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { PanelId, Persona } from "@/lib/jarvis/types";
import {
  EV,
  emit,
  fetchJson,
  playSound,
  processActions,
  pushSetting,
} from "@/lib/jarvis/client/ui-helpers";

export function CommandPalette() {
  const open = useJarvisStore((s) => s.paletteOpen);
  const setOpen = useJarvisStore((s) => s.setPaletteOpen);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const openPanel = (p: PanelId) => run(() => useJarvisStore.getState().setPanel(p));

  const clearConversation = () =>
    run(() => {
      void fetchJson("/api/chat?sessionId=default", { method: "DELETE" });
      useJarvisStore.getState().clearMessages();
      playSound("success");
    });

  const toggleVoice = () => run(() => emit(EV.toggleVoice));

  const toggleMute = () =>
    run(() => {
      const s = useJarvisStore.getState();
      const next = !s.settings.voiceEnabled;
      s.setSettings({ voiceEnabled: next, soundEnabled: next });
      pushSetting("voiceEnabled", next);
      pushSetting("soundEnabled", next);
    });

  const toggleIntentTrace = () =>
    run(() => {
      const s = useJarvisStore.getState();
      const next = !s.settings.showIntentTrace;
      s.setSettings({ showIntentTrace: next });
      pushSetting("showIntentTrace", next);
    });

  const switchPersona = () =>
    run(() => {
      const s = useJarvisStore.getState();
      const next: Persona = s.settings.persona === "jarvis" ? "friday" : "jarvis";
      s.setSettings({ persona: next });
      pushSetting("persona", next);
    });

  const newTask = () =>
    run(() => {
      const s = useJarvisStore.getState();
      s.setPanel("tasks");
      emit(EV.newTask);
    });

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="J.A.R.V.I.S. command palette"
      description="Run HUD commands"
      className="border-cyan-400/25 sm:max-w-xl"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching command.</CommandEmpty>

        <CommandGroup heading="Panels">
          {(
            [
              ["system", "System telemetry", Cpu],
              ["tasks", "Tasks", ListChecks],
              ["reminders", "Reminders", BellRing],
              ["memory", "Memory lattice", Brain],
              ["agent", "Agent subsystem", Bot],
              ["log", "Activity log", ScrollText],
            ] as [PanelId, string, typeof Cpu][]
          ).map(([id, label, Icon]) => (
            <CommandItem key={id} onSelect={() => openPanel(id)}>
              <Icon aria-hidden="true" />
              <span>Open {label.toLowerCase()} panel</span>
              <CommandShortcut>panel</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Conversation">
          <CommandItem onSelect={clearConversation}>
            <Trash2 aria-hidden="true" />
            <span>Clear conversation</span>
          </CommandItem>
          <CommandItem onSelect={toggleVoice}>
            <Mic aria-hidden="true" />
            <span>Toggle voice mode</span>
            <CommandShortcut>V</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={toggleMute}>
            <VolumeX aria-hidden="true" />
            <span>Mute / unmute responses</span>
            <CommandShortcut>M</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => processActions([{ type: "panic" }]))
            }
          >
            <ShieldAlert aria-hidden="true" />
            <span>Panic — pause all automation</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => processActions([{ type: "resume" }]))
            }
          >
            <RefreshCw aria-hidden="true" />
            <span>Resume automation</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Tasks">
          <CommandItem onSelect={newTask}>
            <Plus aria-hidden="true" />
            <span>New task</span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Settings">
          <CommandItem
            onSelect={() => run(() => useJarvisStore.getState().setSettingsOpen(true))}
          >
            <Sparkles aria-hidden="true" />
            <span>Open settings drawer</span>
          </CommandItem>
          <CommandItem onSelect={toggleIntentTrace}>
            <Eye aria-hidden="true" />
            <span>Toggle intent trace</span>
            <CommandShortcut>T</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={switchPersona}>
            <UserRound aria-hidden="true" />
            <span>Switch persona (JARVIS / FRIDAY)</span>
            <CommandShortcut>P</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Skills — just say it">
          <CommandItem disabled>
            <Volume2 aria-hidden="true" />
            <span>&quot;Remind me to stretch in 20 minutes&quot;</span>
          </CommandItem>
          <CommandItem disabled>
            <Brain aria-hidden="true" />
            <span>&quot;Remember my exam is on Friday&quot;</span>
          </CommandItem>
          <CommandItem disabled>
            <Cpu aria-hidden="true" />
            <span>&quot;System status&quot; · &quot;What&apos;s my battery?&quot;</span>
          </CommandItem>
          <CommandItem disabled>
            <MicOff aria-hidden="true" />
            <span>&quot;Mute&quot; · &quot;Panic&quot; · &quot;Resume&quot;</span>
          </CommandItem>
          <CommandItem disabled>
            <Bot aria-hidden="true" />
            <span>&quot;Run agent: research AR headsets and summarize&quot;</span>
          </CommandItem>
          <CommandItem disabled>
            <Hand aria-hidden="true" />
            <span>Gestures: circle=clear · V=voice · Z=panic · caret=palette</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      <div className="border-t border-cyan-400/15 px-3 py-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground">
          <CommandIcon className="size-3" aria-hidden="true" />
          No exact syntax needed — JARVIS parses natural language
        </p>
      </div>
    </CommandDialog>
  );
}
