"use client";

// ─────────────────────────────────────────────────────────────────────────────
// engines.tsx — mounts the client intelligence engines (task 3):
// sound (Web Audio synth) · voice (STT/TTS + wake word) · telemetry
// (Battery/Storage/Network/FPS) · proactive (reminders, battery advisories,
// gentle suggestions) · gesture layer. Renders nothing except the gesture
// canvas overlay.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { initSoundEngine } from "@/lib/jarvis/client/sound";
import { initVoiceEngine } from "@/lib/jarvis/client/voice";
import { initTelemetry } from "@/lib/jarvis/client/telemetry";
import { initProactive } from "@/lib/jarvis/client/proactive";
import { GestureLayer } from "./gesture-layer";

export function ConsoleEngines() {
  useEffect(() => {
    initSoundEngine();
    initVoiceEngine();
    initTelemetry();
    initProactive();
  }, []);

  return <GestureLayer />;
}
