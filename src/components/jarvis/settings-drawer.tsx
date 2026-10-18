"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Settings drawer — right Sheet bound to store.settings. Every change updates
// the store optimistically and is persisted via debounced POST /api/settings.
// ─────────────────────────────────────────────────────────────────────────────

import { ExternalLink, Github } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useJarvisStore } from "@/lib/jarvis/store";
import type { Persona, SettingsDTO } from "@/lib/jarvis/types";
import { pushSetting } from "@/lib/jarvis/client/ui-helpers";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-mono text-xs text-cyan-100/90">{label}</p>
        {hint && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsDrawer() {
  const open = useJarvisStore((s) => s.settingsOpen);
  const setOpen = useJarvisStore((s) => s.setSettingsOpen);
  const settings = useJarvisStore((s) => s.settings);
  const setSettings = useJarvisStore((s) => s.setSettings);

  const update = (patch: Partial<SettingsDTO>) => {
    setSettings(patch);
    for (const [k, v] of Object.entries(patch)) {
      pushSetting(k, v as string | number | boolean);
    }
    // notify the voice engine when wake-word mode changes
    if ("wakeWordEnabled" in patch) {
      window.dispatchEvent(new CustomEvent("jarvis:wake-word-changed"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="hud-panel w-full gap-0 border-l border-cyan-400/25 p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-cyan-400/15 pb-3">
          <SheetTitle className="hud-glow-text font-mono text-xs tracking-[0.35em] text-cyan-200">
            SYSTEM SETTINGS
          </SheetTitle>
          <SheetDescription className="font-mono text-[10px] text-muted-foreground">
            Persisted server-side · synced to the core
          </SheetDescription>
        </SheetHeader>

        <div className="hud-scroll flex-1 overflow-y-auto px-4 pb-6">
          {/* persona + user */}
          <div className="pt-2">
            <Row label="Persona">
              <Select
                value={settings.persona}
                onValueChange={(v) => update({ persona: v as Persona })}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Assistant persona"
                  className="w-28 border-cyan-400/25 bg-transparent font-mono text-[11px] uppercase"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jarvis">JARVIS</SelectItem>
                  <SelectItem value="friday">FRIDAY</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Address you as" hint="Used in greetings and replies.">
              <Input
                value={settings.userName}
                onChange={(e) => update({ userName: e.target.value })}
                aria-label="Preferred name"
                className="h-8 w-32 border-cyan-400/25 bg-transparent font-mono text-xs"
              />
            </Row>
          </div>

          <Separator className="bg-cyan-400/10" />

          {/* switches */}
          <div className="divide-y divide-cyan-400/10">
            <Row label="Voice responses" hint="TTS reads replies aloud (task 3 engine).">
              <Switch
                checked={settings.voiceEnabled}
                onCheckedChange={(v) => update({ voiceEnabled: v })}
                aria-label="Toggle voice responses"
              />
            </Row>
            <Row label="UI sound effects" hint="Web-Audio synthesized HUD sounds.">
              <Switch
                checked={settings.soundEnabled}
                onCheckedChange={(v) => update({ soundEnabled: v })}
                aria-label="Toggle sound effects"
              />
            </Row>
            <Row
              label="Wake word — say “Jarvis”"
              hint="Engine lands with the voice workstream — toggling pre-wires the HUD."
            >
              <Switch
                checked={settings.wakeWordEnabled}
                onCheckedChange={(v) => update({ wakeWordEnabled: v })}
                aria-label="Toggle wake word"
              />
            </Row>
            <Row label="Gesture control" hint="Draw on screen: circle=clear, V=voice, Z=panic.">
              <Switch
                checked={settings.gesturesEnabled}
                onCheckedChange={(v) => update({ gesturesEnabled: v })}
                aria-label="Toggle gesture control"
              />
            </Row>
            <Row label="Show intent trace" hint="“How I understood you” under replies.">
              <Switch
                checked={settings.showIntentTrace}
                onCheckedChange={(v) => update({ showIntentTrace: v })}
                aria-label="Toggle intent trace"
              />
            </Row>
            <Row label="Do not disturb" hint="Suppress proactive alerts and suggestions.">
              <Switch
                checked={settings.dnd}
                onCheckedChange={(v) => update({ dnd: v })}
                aria-label="Toggle do not disturb"
              />
            </Row>
          </div>

          <Separator className="bg-cyan-400/10" />

          {/* autonomy */}
          <div className="py-3">
            <p className="font-mono text-xs text-cyan-100/90">Autonomy</p>
            <RadioGroup
              value={settings.autonomy}
              onValueChange={(v) => update({ autonomy: v as SettingsDTO["autonomy"] })}
              className="mt-2 gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="standard" id="autonomy-standard" />
                <Label
                  htmlFor="autonomy-standard"
                  className="font-mono text-[11px] text-cyan-100/80"
                >
                  Standard — reply only when spoken to
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="proactive" id="autonomy-proactive" />
                <Label
                  htmlFor="autonomy-proactive"
                  className="font-mono text-[11px] text-cyan-100/80"
                >
                  Proactive — allow gentle suggestions
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Separator className="bg-cyan-400/10" />

          {/* about */}
          <div className="py-3">
            <p className="micro-label text-cyan-300/80">About</p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              J.A.R.V.I.S. WEB CONSOLE · v2.0 — web evolution of the Windows
              JARVIS assistant. Rule-first NLU, LLM decision fallback, server-side
              memory, reminders, multi-step agent with verification &amp; recovery,
              browser telemetry, voice + gesture engines.
            </p>
            <a
              href="https://github.com/TejashRajuKV/JARVIS"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-cyan-400/25 px-3 py-2 font-mono text-[11px] text-cyan-300 transition-colors hover:bg-cyan-400/10"
            >
              <Github className="size-4" aria-hidden="true" />
              upstream repo
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
