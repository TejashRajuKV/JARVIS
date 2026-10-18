"use client";

// ─────────────────────────────────────────────────────────────────────────────
// sound.ts — JARVIS sound design via Web Audio synthesis (no asset files).
// Consumes the "jarvis:sound" CustomEvent contract from ui-helpers.
// All sounds are synthesized: sweeps, blips, chirps, alarm pulses.
// ─────────────────────────────────────────────────────────────────────────────

import { useJarvisStore } from "@/lib/jarvis/store";
import { EV } from "./ui-helpers";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Browsers require a user gesture before audio may start. */
export function unlockAudio(): void {
  ensureCtx();
  unlocked = true;
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  delay?: number;
}

function tone({ type = "sine", from, to, dur, gain = 0.12, delay = 0 }: ToneOpts): void {
  const c = ctx;
  const m = master;
  if (!c || !m) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== undefined && to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(m);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function play(name: string): void {
  if (!unlocked) return;
  const enabled = useJarvisStore.getState().settings.soundEnabled;
  if (!enabled) return;
  if (!ensureCtx()) return;

  switch (name) {
    case "boot":
      // reactor power-up: low sweep + shimmering partials
      tone({ type: "sawtooth", from: 70, to: 480, dur: 1.15, gain: 0.07 });
      tone({ type: "sine", from: 55, to: 110, dur: 1.3, gain: 0.09 });
      tone({ type: "sine", from: 1180, to: 1180, dur: 0.12, gain: 0.05, delay: 0.55 });
      tone({ type: "sine", from: 1560, to: 1560, dur: 0.12, gain: 0.05, delay: 0.75 });
      tone({ type: "sine", from: 2100, to: 2100, dur: 0.16, gain: 0.05, delay: 0.95 });
      break;
    case "listen-start":
      tone({ type: "sine", from: 520, to: 900, dur: 0.12, gain: 0.09 });
      break;
    case "listen-stop":
      tone({ type: "sine", from: 900, to: 520, dur: 0.12, gain: 0.07 });
      break;
    case "send":
      tone({ type: "square", from: 1400, to: 1400, dur: 0.045, gain: 0.035 });
      break;
    case "receive":
      tone({ type: "sine", from: 660, to: 660, dur: 0.09, gain: 0.06 });
      tone({ type: "sine", from: 440, to: 440, dur: 0.11, gain: 0.06, delay: 0.1 });
      break;
    case "alert":
      tone({ type: "triangle", from: 880, to: 880, dur: 0.13, gain: 0.09 });
      tone({ type: "triangle", from: 640, to: 640, dur: 0.13, gain: 0.09, delay: 0.16 });
      tone({ type: "triangle", from: 880, to: 880, dur: 0.13, gain: 0.08, delay: 0.32 });
      break;
    case "success":
      tone({ type: "sine", from: 523, to: 523, dur: 0.09, gain: 0.07 });
      tone({ type: "sine", from: 659, to: 659, dur: 0.09, gain: 0.07, delay: 0.09 });
      tone({ type: "sine", from: 784, to: 784, dur: 0.14, gain: 0.07, delay: 0.18 });
      break;
    case "error":
      tone({ type: "sawtooth", from: 180, to: 120, dur: 0.22, gain: 0.07 });
      break;
    case "gesture":
      tone({ type: "sine", from: 320, to: 940, dur: 0.09, gain: 0.05 });
      break;
    default:
      break;
  }
}

export function initSoundEngine(): void {
  if (typeof window === "undefined") return;
  // unlock on the first user interaction anywhere
  const once = () => {
    unlockAudio();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once, { once: false });
  window.addEventListener("keydown", once, { once: false });

  window.addEventListener(EV.sound, (e) => {
    const detail = (e as CustomEvent<{ name?: string }>).detail;
    if (detail?.name) play(detail.name);
  });
}
