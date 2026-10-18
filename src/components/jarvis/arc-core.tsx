"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Arc reactor canvas — reacts to store.voiceState:
//   idle      → slow calm pulse
//   listening → fast bright pulse + expanding ring
//   thinking  → rapid rotating dashes
//   speaking  → waveform-like radial oscillation
// rAF loop; pauses when tab hidden; renders a static frame under
// prefers-reduced-motion. No external assets.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useJarvisStore } from "@/lib/jarvis/store";
import { cn } from "@/lib/utils";

const TAU = Math.PI * 2;

export function ArcCore({
  size = 72,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const voiceState = useJarvisStore((s) => s.voiceState);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = false;

    const draw = (t: number) => {
      const cx = size / 2;
      const cy = size / 2;
      const R = size / 2 - 4;
      const time = t / 1000;

      const pulseSpeed =
        voiceState === "listening"
          ? 7
          : voiceState === "thinking"
            ? 9
            : voiceState === "speaking"
              ? 4
              : 1.3;
      const pulse =
        0.5 + 0.5 * Math.sin(time * Math.PI * pulseSpeed * (voiceState === "speaking" ? 0.55 : 1));
      const bright = 0.45 + pulse * 0.55;

      ctx.clearRect(0, 0, size, size);

      // outer faint ring
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(34, 211, 238, 0.18)";
      ctx.stroke();

      // tick marks
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const r1 = R - 2;
        const r2 = R - (i % 6 === 0 ? 7 : 5);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.lineWidth = 1;
        ctx.strokeStyle =
          i % 6 === 0
            ? `rgba(34, 211, 238, ${0.25 * bright})`
            : "rgba(34, 211, 238, 0.1)";
        ctx.stroke();
      }

      // rotating arcs (speed/direction per state)
      const speed =
        voiceState === "thinking"
          ? 4.6
          : voiceState === "listening"
            ? 2.4
            : voiceState === "speaking"
              ? 1.7
              : 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 9, time * speed, time * speed + 1.9);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(34, 211, 238, ${0.9 * bright})`;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, R - 15, -time * speed * 0.7 + 2, -time * speed * 0.7 + 3.1);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(45, 212, 191, ${0.8 * bright})`;
      ctx.stroke();

      // state overlays
      if (voiceState === "listening") {
        const phase = (time % 0.9) / 0.9;
        ctx.beginPath();
        ctx.arc(cx, cy, 13 + phase * (R - 12), 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(34, 211, 238, ${(1 - phase) * 0.55})`;
        ctx.stroke();
      } else if (voiceState === "thinking") {
        for (let i = 0; i < 8; i++) {
          const a = -time * 5 + (i / 8) * TAU;
          ctx.beginPath();
          ctx.arc(cx, cy, R - 21, a, a + 0.22);
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(251, 191, 36, 0.7)";
          ctx.stroke();
        }
      } else if (voiceState === "speaking") {
        const spikes = 36;
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * TAU;
          const len =
            3 + Math.abs(Math.sin(i * 0.9 + time * 9)) * 7 * (0.4 + pulse * 0.6);
          const r0 = 11;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = `rgba(34, 211, 238, ${0.35 + pulse * 0.45})`;
          ctx.stroke();
        }
      }

      // center glow
      const glowR = 11 + pulse * 6;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      grad.addColorStop(0, `rgba(165, 243, 252, ${0.55 + pulse * 0.4})`);
      grad.addColorStop(0.45, `rgba(34, 211, 238, ${0.35 * bright})`);
      grad.addColorStop(1, "rgba(34, 211, 238, 0)");
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, TAU);
      ctx.fillStyle = grad;
      ctx.fill();
    };

    const loop = (t: number) => {
      if (document.hidden) {
        running = false;
        return;
      }
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) {
      draw(1200); // static frame
    } else {
      start();
    }

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size, voiceState]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      role="img"
      aria-label={`Arc reactor core — voice state: ${voiceState}`}
      style={{ width: size, height: size }}
      className={cn("shrink-0 drop-shadow-[0_0_12px_rgba(34,211,238,0.25)]", className)}
    />
  );
}
