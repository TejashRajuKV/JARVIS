"use client";

// ─────────────────────────────────────────────────────────────────────────────
// gesture-layer.tsx — hand-gesture style control via mouse/touch strokes
// (workstream B). Draws a glowing trail, recognizes gestures with a compact
// $1-recognizer (resample → scale → translate → golden-section rotation
// search) against six templates, then dispatches the mapped HUD action.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useJarvisStore } from "@/lib/jarvis/store";
import { GESTURES } from "@/lib/jarvis/types";
import { EV, emit, processActions, playSound, logEvent } from "@/lib/jarvis/client/ui-helpers";

// ── $1 recognizer core ──────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

const N_PTS = 48;
const SQ = 220;

function pathLength(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return d;
}

function resample(pts: Point[], n = N_PTS): Point[] {
  const I = pathLength(pts) / (n - 1);
  if (!isFinite(I) || I === 0) return pts.slice(0, n);
  let D = 0;
  const out: Point[] = [pts[0]];
  const src = pts.slice();
  for (let i = 1; i < src.length; i++) {
    const d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = {
        x: src[i - 1].x + t * (src[i].x - src[i - 1].x),
        y: src[i - 1].y + t * (src[i].y - src[i - 1].y),
      };
      out.push(q);
      src.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
    if (out.length === n) break;
  }
  while (out.length < n) out.push(out[out.length - 1]);
  return out;
}

function centroid(pts: Point[]): Point {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

function rotateBy(pts: Point[], angle: number): Point[] {
  const c = centroid(pts);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pts.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

function boundingBox(pts: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function scaleTo(pts: Point[]): Point[] {
  const b = boundingBox(pts);
  const w = Math.max(b.w, 1e-6);
  const h = Math.max(b.h, 1e-6);
  return pts.map((p) => ({ x: (p.x - b.minX) * (SQ / w), y: (p.y - b.minY) * (SQ / h) }));
}

function translateToOrigin(pts: Point[]): Point[] {
  const c = centroid(pts);
  return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

function normalizePts(pts: Point[]): Point[] {
  return translateToOrigin(scaleTo(resample(pts)));
}

function pathDistance(a: Point[], b: Point[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return d / a.length;
}

function distanceAtAngle(cand: Point[], tmpl: Point[], angle: number): number {
  return pathDistance(rotateBy(cand, angle), tmpl);
}

function distanceAtBestAngle(cand: Point[], tmpl: Point[]): number {
  let lo = -Math.PI / 4;
  let hi = Math.PI / 4;
  const PHI = 0.5 * (-1 + Math.sqrt(5));
  let x1 = PHI * lo + (1 - PHI) * hi;
  let f1 = distanceAtAngle(cand, tmpl, x1);
  let x2 = (1 - PHI) * lo + PHI * hi;
  let f2 = distanceAtAngle(cand, tmpl, x2);
  while (Math.abs(hi - lo) > 0.01) {
    if (f1 < f2) {
      hi = x2; x2 = x1; f2 = f1;
      x1 = PHI * lo + (1 - PHI) * hi; f1 = distanceAtAngle(cand, tmpl, x1);
    } else {
      lo = x1; x1 = x2; f1 = f2;
      x2 = (1 - PHI) * lo + PHI * hi; f2 = distanceAtAngle(cand, tmpl, x2);
    }
  }
  return Math.min(f1, f2);
}

// ── templates (drawn in a 100×100 box, y grows downward) ────────────────────

function lineToPts(points: [number, number][]): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      pts.push({ x: x0 + ((x1 - x0) * s) / steps, y: y0 + ((y1 - y0) * s) / steps });
    }
  }
  return pts;
}

function circlePts(cw: boolean): Point[] {
  const pts: Point[] = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dir = cw ? 1 : -1;
    pts.push({ x: 50 + 45 * Math.sin(dir * a), y: 50 - 45 * Math.cos(a) });
  }
  return pts;
}

interface Template {
  name: string;
  pts: Point[];
}

const TEMPLATES: Template[] = [
  { name: "circle", pts: circlePts(true) },
  { name: "circle", pts: circlePts(false) },
  { name: "vshape", pts: lineToPts([[10, 0], [50, 100], [90, 0]]) },
  { name: "caret", pts: lineToPts([[5, 100], [50, 0], [95, 100]]) },
  { name: "zshape", pts: lineToPts([[0, 5], [100, 5], [0, 95], [100, 95]]) },
  { name: "nshape", pts: lineToPts([[8, 100], [8, 0], [88, 100], [88, 0]]) },
  { name: "mshape", pts: lineToPts([[5, 100], [5, 0], [38, 55], [70, 0], [70, 100]]) },
].map((t) => ({ ...t, pts: normalizePts(t.pts) }));

const ACCEPT_DISTANCE = SQ * 0.32;

function recognize(raw: Point[]): { name: string; score: number } | null {
  if (raw.length < 8 || pathLength(raw) < 60) return null;
  const cand = normalizePts(raw);
  let best = { name: "", score: Infinity };
  for (const t of TEMPLATES) {
    const d = distanceAtBestAngle(cand, t.pts);
    if (d < best.score) best = { name: t.name, score: d };
  }
  if (best.name && best.score <= ACCEPT_DISTANCE) return best;
  return null;
}

// ── component ───────────────────────────────────────────────────────────────

export function GestureLayer(): null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const trailRef = useRef<Point[]>([]);
  const fadeRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const trail = trailRef.current;
      if (trail.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < trail.length; i++) {
          const t = i / trail.length;
          ctx.strokeStyle = `rgba(34, 211, 238, ${0.15 + 0.65 * t})`;
          ctx.lineWidth = 2 + 3 * t;
          ctx.shadowColor = "rgba(34, 211, 238, 0.8)";
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        // leading dot
        const head = trail[trail.length - 1];
        ctx.fillStyle = "rgba(165, 243, 252, 0.95)";
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const isInteractive = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      return !!target.closest(
        "input, textarea, button, a, select, label, [role='button'], [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper], [data-no-gesture], [cmdk-root]"
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      const s = useJarvisStore.getState();
      if (!s.settings.gesturesEnabled || !s.booted) return;
      if (isInteractive(e.target) || e.button !== 0) return;
      drawingRef.current = true;
      trailRef.current = [{ x: e.clientX, y: e.clientY }];
      if (fadeRef.current) {
        cancelAnimationFrame(fadeRef.current);
        fadeRef.current = null;
      }
      draw();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      trailRef.current.push({ x: e.clientX, y: e.clientY });
      if (trailRef.current.length > 400) trailRef.current.shift();
      draw();
    };

    const onPointerUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const pts = trailRef.current;
      const result = recognize(pts);
      // fade out the trail
      let alpha = 1;
      const fade = () => {
        alpha -= 0.08;
        if (alpha <= 0) {
          trailRef.current = [];
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          fadeRef.current = null;
          return;
        }
        draw();
        fadeRef.current = requestAnimationFrame(fade);
      };
      fadeRef.current = requestAnimationFrame(fade);

      if (!result) return;
      const gesture = GESTURES.find((g) => g.name === result.name);
      if (!gesture) return;
      const store = useJarvisStore.getState();
      store.setLastGesture(gesture.label);
      window.setTimeout(() => store.setLastGesture(null), 2200);
      playSound("gesture");
      logEvent("info", `Gesture ${gesture.label} — ${gesture.description}`);

      switch (gesture.action) {
        case "clearChat":
          store.clearMessages();
          break;
        case "toggleVoice":
          emit(EV.toggleVoice);
          break;
        case "toggleMute":
          processActions([{ type: "toggleMute" }]);
          break;
        case "panic":
          processActions([{ type: "panic" }]);
          break;
        case "openPalette":
          store.setPaletteOpen(true);
          break;
        case "newTask":
          emit(EV.newTask);
          store.setPanel("tasks");
          break;
        default:
          break;
      }
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[80]"
    />
  );
}
