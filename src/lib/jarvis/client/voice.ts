"use client";

// ─────────────────────────────────────────────────────────────────────────────
// voice.ts — speech intelligence (workstream B):
//   • TTS via speechSynthesis — persona-tuned voice (JARVIS: UK male, dry;
//     FRIDAY: female, brisk), emotion-aware pacing
//   • STT via webkitSpeechRecognition — push-to-talk mode + hands-free wake
//     word ("Jarvis…" / "Friday…") with auto-restart and self-hearing guard
//   • Interim transcript streamed to the chat input via "jarvis:interim"
// Consumes: jarvis:speak, jarvis:toggle-voice. Emits: jarvis:sound, jarvis:interim.
// ─────────────────────────────────────────────────────────────────────────────

import { useJarvisStore } from "@/lib/jarvis/store";
import { EV, emit, sendChatMessage } from "./ui-helpers";

// ── minimal ambient typings (no `any`) ──────────────────────────────────────

interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [index: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSRCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── TTS ──────────────────────────────────────────────────────────────────────

let voices: SpeechSynthesisVoice[] = [];

function pickVoice(persona: string): SpeechSynthesisVoice | null {
  if (!voices.length && typeof speechSynthesis !== "undefined") {
    voices = speechSynthesis.getVoices();
  }
  if (!voices.length) return null;
  const byName = (needle: string) =>
    voices.find((v) => v.name.toLowerCase().includes(needle));
  if (persona === "friday") {
    return (
      byName("google uk english female") ??
      byName("serena") ??
      byName("samantha") ??
      byName("zira") ??
      voices.find((v) => v.lang.startsWith("en") && /female|zira|susan|hazel/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      voices[0]
    );
  }
  return (
    byName("google uk english male") ??
    byName("daniel") ??
    byName("rishi") ??
    byName("arthur") ??
    byName("oliver") ??
    voices.find((v) => v.lang.startsWith("en-GB")) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    voices[0]
  );
}

function ttsSpeak(text: string, interrupt: boolean): void {
  if (typeof speechSynthesis === "undefined") return;
  const store = useJarvisStore.getState();
  if (!store.settings.voiceEnabled) return;

  if (interrupt) speechSynthesis.cancel();
  const clean = text
    .replace(/[*_`#>]/g, "")
    .replace(/\bhttps?:\/\/\S+/g, "a link")
    .slice(0, 600);
  if (!clean.trim()) return;

  const u = new SpeechSynthesisUtterance(clean);
  const persona = store.settings.persona;
  const v = pickVoice(persona);
  if (v) u.voice = v;
  u.rate = persona === "friday" ? 1.06 : 1.0;
  u.pitch = persona === "friday" ? 1.05 : 0.92;
  u.volume = 1;

  u.onstart = () => {
    const s = useJarvisStore.getState();
    if (s.voiceState !== "speaking") s.setVoiceState("speaking");
  };
  u.onend = () => {
    const s = useJarvisStore.getState();
    if (s.voiceState === "speaking") s.setVoiceState("idle");
    // resume wake-mode listening after speaking (self-hearing guard)
    if (mode === "wake") void startWakeListening();
  };
  u.onerror = () => {
    const s = useJarvisStore.getState();
    if (s.voiceState === "speaking") s.setVoiceState("idle");
  };
  speechSynthesis.speak(u);
}

// ── STT ──────────────────────────────────────────────────────────────────────

type Mode = "off" | "push" | "wake";
let mode: Mode = "off";
let rec: SpeechRecognitionLike | null = null;
let restarting = false;

function makeRec(): SpeechRecognitionLike | null {
  const Ctor = getSRCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

function stopRecognition(): void {
  if (rec) {
    rec.onend = null;
    rec.onresult = null;
    rec.onerror = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
    rec = null;
  }
}

function setListening(on: boolean): void {
  const s = useJarvisStore.getState();
  s.setVoiceState(on ? "listening" : "idle");
  emit(EV.sound, { name: on ? "listen-start" : "listen-stop" });
}

/** Push-to-talk: single utterance → send. */
function startPushListening(): void {
  const Ctor = getSRCtor();
  const store = useJarvisStore.getState();
  if (!Ctor) {
    store.setVoiceState("idle");
    return;
  }
  stopRecognition();
  mode = "push";
  rec = makeRec();
  if (!rec) return;
  rec.continuous = false;

  rec.onstart = () => setListening(true);

  rec.onresult = (e: SREvent) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const alt = res[0];
      if (!alt) continue;
      if (res.isFinal) final += alt.transcript;
      else interim += alt.transcript;
    }
    if (interim) emit("jarvis:interim", { text: interim });
    if (final.trim()) {
      emit("jarvis:interim", { text: "" });
      emit(EV.sound, { name: "listen-stop" });
      mode = "off";
      stopRecognition();
      const s = useJarvisStore.getState();
      if (s.voiceState === "listening") s.setVoiceState("idle");
      void sendChatMessage(final.trim());
    }
  };

  rec.onerror = (e: SRErrorEvent) => {
    mode = "off";
    const s = useJarvisStore.getState();
    if (s.voiceState === "listening") s.setVoiceState("idle");
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      s.pushLog({
        id: `mic-${Date.now()}`,
        kind: "warning",
        message: "Microphone permission denied — voice input unavailable",
        createdAt: new Date().toISOString(),
      });
    } else if (e.error !== "aborted" && e.error !== "no-speech") {
      s.pushLog({
        id: `mic-${Date.now()}`,
        kind: "error",
        message: `Voice recognition error: ${e.error}`,
        createdAt: new Date().toISOString(),
      });
    }
  };

  rec.onend = () => {
    if (mode === "push") {
      mode = "off";
      const s = useJarvisStore.getState();
      if (s.voiceState === "listening") s.setVoiceState("idle");
      emit(EV.sound, { name: "listen-stop" });
    }
  };

  try {
    rec.start();
  } catch {
    mode = "off";
  }
}

/** Hands-free wake-word mode: continuous, auto-restarts, guards against self-hearing. */
async function startWakeListening(): Promise<void> {
  const store = useJarvisStore.getState();
  if (!store.settings.wakeWordEnabled) return;
  if (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) return; // don't hear ourselves
  const Ctor = getSRCtor();
  if (!Ctor) return;

  if (mode !== "wake") stopRecognition();
  mode = "wake";
  if (restarting) return;
  restarting = true;

  rec = makeRec();
  restarting = false;
  if (!rec) return;
  rec.continuous = true;

  rec.onstart = () => {
    const s = useJarvisStore.getState();
    if (s.voiceState !== "listening") s.setVoiceState("listening");
  };

  rec.onresult = (e: SREvent) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res?.isFinal) continue;
      const alt = res[0];
      if (!alt) continue;
      const text = alt.transcript.trim();
      if (!text) continue;
      const m = text.match(/\b(?:jarvis|friday)[\s,.:!-]+(.*)$/i);
      if (!m) continue;
      const command = (m[1] ?? "").trim();
      if (!command) continue; // wake word alone → keep listening
      emit(EV.sound, { name: "listen-stop" });
      void sendChatMessage(command);
      // restart a fresh listener after the turn
      window.setTimeout(() => {
        if (mode === "wake" && useJarvisStore.getState().settings.wakeWordEnabled) {
          void startWakeListening();
        }
      }, 1200);
      return;
    }
  };

  rec.onerror = (e: SRErrorEvent) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      mode = "off";
      const s = useJarvisStore.getState();
      s.pushLog({
        id: `wake-${Date.now()}`,
        kind: "warning",
        message: "Wake word needs microphone permission",
        createdAt: new Date().toISOString(),
      });
      s.setVoiceState("idle");
    }
  };

  rec.onend = () => {
    // auto-restart unless we've turned wake mode off or are speaking
    window.setTimeout(() => {
      const s = useJarvisStore.getState();
      if (mode === "wake" && s.settings.wakeWordEnabled) {
        if (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) return;
        stopRecognition();
        void startWakeListening();
      }
    }, 700);
  };

  try {
    rec.start();
  } catch {
    /* already started — ignore */
  }
}

function stopWakeListening(): void {
  mode = "off";
  stopRecognition();
  const s = useJarvisStore.getState();
  if (s.voiceState === "listening") s.setVoiceState("idle");
}

export function toggleVoice(): void {
  const store = useJarvisStore.getState();
  if (mode === "off") {
    if (store.settings.wakeWordEnabled) {
      void startWakeListening();
    } else {
      startPushListening();
    }
  } else if (mode === "wake") {
    stopWakeListening();
  } else {
    // push mode → stop
    mode = "off";
    stopRecognition();
    const s = useJarvisStore.getState();
    if (s.voiceState === "listening") s.setVoiceState("idle");
    emit(EV.sound, { name: "listen-stop" });
  }
}

export function initVoiceEngine(): void {
  if (typeof window === "undefined") return;

  if (typeof speechSynthesis !== "undefined") {
    voices = speechSynthesis.getVoices();
    speechSynthesis.addEventListener?.("voiceschanged", () => {
      voices = speechSynthesis.getVoices();
    });
  }

  window.addEventListener(EV.speak, (e) => {
    const detail = (e as CustomEvent<{ text?: string; interrupt?: boolean }>).detail;
    if (detail?.text) ttsSpeak(detail.text, !!detail.interrupt);
  });

  window.addEventListener(EV.toggleVoice, () => toggleVoice());

  // wake-mode follow settings
  window.addEventListener("jarvis:wake-word-changed", () => {
    const s = useJarvisStore.getState();
    if (s.settings.wakeWordEnabled && mode === "off") void startWakeListening();
    if (!s.settings.wakeWordEnabled && mode === "wake") stopWakeListening();
  });

  if (!getSRCtor()) {
    // engine unsupported — note it in the activity log once
    window.setTimeout(() => {
      useJarvisStore.getState().pushLog({
        id: `voice-support-${Date.now()}`,
        kind: "info",
        message: "Speech recognition not supported in this browser — text input remains fully armed",
        createdAt: new Date().toISOString(),
      });
    }, 3000);
  }
}
