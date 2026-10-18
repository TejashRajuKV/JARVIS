"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Boot sequence overlay — reactor art, typed boot log, progress bar.
// Skippable via click / Enter / Space / Skip button. On finish:
//   store.setBooted(true) + CustomEvent "jarvis:sound" {name:"boot"}
//   + CustomEvent "jarvis:speak" {text: time-of-day greeting, interrupt:false}
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { SkipForward } from "lucide-react";
import { useJarvisStore } from "@/lib/jarvis/store";
import { greetingForHour, playSound, speak } from "@/lib/jarvis/client/ui-helpers";

const LINE_DELAY_MS = 250;
const FIRST_DELAY_MS = 350;
const FINISH_DELAY_MS = 1900;

const BOOT_LINES: { label: string; status: string; tone: "cyan" | "amber" | "teal" }[] = [
  { label: "Reactor core", status: "ONLINE", tone: "cyan" },
  { label: "NLU rule engine", status: "ARMED", tone: "cyan" },
  { label: "Memory lattice", status: "MOUNTED", tone: "cyan" },
  { label: "Telemetry bus", status: "LIVE", tone: "cyan" },
  { label: "Agent subsystems", status: "STANDBY", tone: "amber" },
  { label: "All systems nominal", status: "OK", tone: "teal" },
];

const toneClass: Record<(typeof BOOT_LINES)[number]["tone"], string> = {
  cyan: "text-cyan-300",
  amber: "text-amber-300",
  teal: "text-teal-300",
};

export function BootScreen() {
  const setBooted = useJarvisStore((s) => s.setBooted);
  const setBootStage = useJarvisStore((s) => s.setBootStage);

  const [lineCount, setLineCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const finishedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    setLineCount(BOOT_LINES.length);
    setProgress(100);
    setLeaving(true);
    setBootStage("ready");
    // small pause so the "ready" frame is perceived before app swap
    window.setTimeout(() => {
      setBooted(true);
      playSound("boot");
      const hour = new Date().getHours();
      const userName = useJarvisStore.getState().settings.userName || "sir";
      speak(`${greetingForHour(hour)}, ${userName}. All systems are online.`);
    }, 380);
  }, [setBooted, setBootStage]);

  useEffect(() => {
    playSound("boot");
    setBootStage("reactor");
    const timers: number[] = [];
    BOOT_LINES.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          setLineCount(i + 1);
          setBootStage(i < 2 ? "reactor" : "systems");
          setProgress(Math.round(((i + 1) / (BOOT_LINES.length + 1)) * 100));
        }, FIRST_DELAY_MS + i * LINE_DELAY_MS)
      );
    });
    timers.push(
      window.setTimeout(
        () => setProgress(100),
        FIRST_DELAY_MS + BOOT_LINES.length * LINE_DELAY_MS
      )
    );
    timers.push(
      window.setTimeout(
        () => finish(),
        FIRST_DELAY_MS + BOOT_LINES.length * LINE_DELAY_MS + FINISH_DELAY_MS
      )
    );
    timersRef.current = timers;
    // one-shot boot sequence — intentional effect
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [finish, setBootStage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  return (
    <div
      role="dialog"
      aria-label="J.A.R.V.I.S. boot sequence"
      onClick={finish}
      className={`hud-bg fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center gap-8 px-6 transition-opacity duration-500 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        className="absolute right-4 top-4 flex h-11 items-center gap-2 rounded-md border border-cyan-400/25 px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/80 transition-colors hover:bg-cyan-400/10"
      >
        <SkipForward className="size-3.5" aria-hidden="true" />
        Skip
      </button>

      {/* reactor */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative flex items-center justify-center"
      >
        <div
          aria-hidden="true"
          className="hud-spin-slow absolute -inset-6 rounded-full border border-dashed border-cyan-400/30"
        />
        <div
          aria-hidden="true"
          className="hud-spin-rev absolute -inset-3 rounded-full border border-cyan-400/20"
        />
        <div className="hud-glow-box rounded-full">
          <Image
            src="/jarvis-reactor.png"
            alt="J.A.R.V.I.S. arc reactor"
            width={168}
            height={168}
            priority
            className="rounded-full"
          />
        </div>
      </motion.div>

      {/* wordmark */}
      <div className="text-center">
        <p className="hud-glow-text font-mono text-sm font-semibold tracking-[0.45em] text-cyan-200">
          INITIALIZING J.A.R.V.I.S.
        </p>
        <p className="micro-label mt-2">Just A Rather Very Intelligent System</p>
      </div>

      {/* boot log */}
      <div className="w-full max-w-md" aria-live="polite">
        <ul className="space-y-1.5 font-mono text-xs">
          {BOOT_LINES.slice(0, lineCount).map((line) => (
            <motion.li
              key={line.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-baseline gap-2"
            >
              <span className="text-cyan-100/85">{line.label}</span>
              <span
                aria-hidden="true"
                className="mx-1 flex-1 border-b border-dotted border-cyan-400/25"
              />
              <span className={toneClass[line.tone]}>
                {line.status}
              </span>
            </motion.li>
          ))}
        </ul>

        {/* progress */}
        <div className="mt-5 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Boot progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 flex-1 overflow-hidden rounded-full bg-cyan-400/10"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.6)] transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-[10px] tabular-nums text-cyan-300/80">
            {String(progress).padStart(3, " ")}%
          </span>
        </div>
      </div>

      <p className="micro-label">Click anywhere or press Enter to skip</p>
    </div>
  );
}
