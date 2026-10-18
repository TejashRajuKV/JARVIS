"use client";

// ─────────────────────────────────────────────────────────────────────────────
// HUD decorative frame: scanlines + vignette + corner brackets.
// Pure CSS, pointer-events-none, sits above content but below overlays.
// ─────────────────────────────────────────────────────────────────────────────

export function HudFrame() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40">
      <div className="hud-scanlines absolute inset-0 opacity-70" />
      <div className="hud-vignette absolute inset-0" />
      {/* viewport corner brackets */}
      <div className="absolute left-2 top-2 h-5 w-5 border-l border-t border-cyan-400/40" />
      <div className="absolute right-2 top-2 h-5 w-5 border-r border-t border-cyan-400/40" />
      <div className="absolute bottom-2 left-2 h-5 w-5 border-b border-l border-cyan-400/40" />
      <div className="absolute bottom-2 right-2 h-5 w-5 border-b border-r border-cyan-400/40" />
    </div>
  );
}
