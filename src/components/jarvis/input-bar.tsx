"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Chat input bar: text input + mic (dispatches jarvis:toggle-voice), gesture
// toggle, ⌘K palette hint, send. Enter sends. Focusable via the
// "jarvis:focus-input" CustomEvent (dispatched by the focusInput chat action).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, type FormEvent } from "react";
import { Hand, Mic, Send, SquareCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useJarvisStore } from "@/lib/jarvis/store";
import {
  EV,
  emit,
  playSound,
  pushSetting,
} from "@/lib/jarvis/client/ui-helpers";

export function InputBar({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const voiceState = useJarvisStore((s) => s.voiceState);
  const listening = voiceState === "listening";
  const gesturesEnabled = useJarvisStore((s) => s.settings.gesturesEnabled);
  const setSettings = useJarvisStore((s) => s.setSettings);
  const setPaletteOpen = useJarvisStore((s) => s.setPaletteOpen);

  // external focus requests (chat action "focusInput", boot, etc.)
  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener(EV.focusInput, onFocus);
    return () => window.removeEventListener(EV.focusInput, onFocus);
  }, []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
  };

  const toggleGestures = () => {
    const next = !gesturesEnabled;
    setSettings({ gesturesEnabled: next });
    pushSetting("gesturesEnabled", next);
    playSound("gesture");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label="Toggle voice mode"
                aria-pressed={listening}
                onClick={() => emit(EV.toggleVoice)}
                className={`size-11 shrink-0 rounded-lg ${
                  listening
                    ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-200 hud-glow-box"
                    : "border-cyan-400/25 text-cyan-300/80 hover:bg-cyan-400/10"
                }`}
              >
                <Mic className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Voice input — click to talk{useJarvisStore.getState().settings.wakeWordEnabled ? ", or say \u201cJarvis\u201d hands-free" : ""}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label="Toggle gesture control"
                aria-pressed={gesturesEnabled}
                onClick={toggleGestures}
                className={`size-11 shrink-0 rounded-lg ${
                  gesturesEnabled
                    ? "border-teal-300/50 bg-teal-400/10 text-teal-200"
                    : "border-cyan-400/25 text-muted-foreground hover:bg-cyan-400/10"
                }`}
              >
                <Hand className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Gesture control — drag on empty space: ○ clear · ✓ voice · ᨓ mute · ⌇ panic · ⌃ palette · ᥒ task
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Speak or type a command…"
          aria-label="Message J.A.R.V.I.S."
          className="h-11 flex-1 rounded-lg border-cyan-400/25 bg-cyan-400/[0.04] font-mono text-sm text-cyan-50 placeholder:text-muted-foreground focus-visible:border-cyan-300/60 focus-visible:ring-cyan-400/25"
        />

        <Button
          type="button"
          variant="ghost"
          aria-label="Open command palette (Ctrl+K)"
          onClick={() => setPaletteOpen(true)}
          className="hidden h-11 w-11 shrink-0 rounded-lg font-mono text-[10px] tracking-widest text-muted-foreground hover:text-cyan-300 sm:flex"
        >
          ⌘K
        </Button>

        <Button
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="size-11 shrink-0 rounded-lg bg-cyan-500/90 text-[#02181d] shadow-[0_0_16px_rgba(34,211,238,0.35)] hover:bg-cyan-400"
        >
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground">
          Try: remind me to stretch in 20 minutes • or draw a circle to clear
        </p>
        <span className="micro-label hidden shrink-0 items-center gap-1 sm:flex">
          <SquareCheck className="size-3" aria-hidden="true" /> NL parser armed
        </span>
      </div>
    </form>
  );
}
