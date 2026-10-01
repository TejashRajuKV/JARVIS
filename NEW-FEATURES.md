# JARVIS — New Feature Additions

Three additive features layered onto the existing JARVIS codebase, designed to make
it feel more like Iron Man's JARVIS without disturbing any existing behaviour.

**Goal:** zero regressions, fully local, AI-API-free (uses your existing local
Ollama + Qwen 3.5 4B).

---

## What's new

| # | Feature | Files added | Default | What it does |
|---|---------|-------------|---------|--------------|
| 1 | **NL Command Parser (Qwen + rules)** | `nlu-qwen.js` + `/api/nlu/parse` route in `server.js` + 1 hook in `script.js` | OFF | When the rule engine returns `CONVERSATION` or confidence < 0.85, asks the local Qwen 3.5 4B to extract a structured intent. Qwen is constrained to a strict JSON schema and a known intent whitelist — it can never invent a tool. |
| 2 | **Cinematic Boot + Arc Reactor** | `boot-cinema.js` + `boot-cinema.css` | ON | Renders a glowing arc reactor (canvas 2D, no external dependencies) layered behind the existing boot screen. Fades out together with the existing overlay. |
| 3 | **Holographic HUD Overlay** | `hud-overlay.js` + `hud-overlay.css` + new `HUD` button in header | OFF | Floating translucent panels: clock + date, system stats (CPU/RAM/Disk/Uptime), mini activity log, quick-command chips. Drag any panel by its grip. ESC closes. |

---

## How to enable / disable

All three toggles live in **Settings → BEHAVIOUR**, next to the existing
"Smart alerts" / "Show how I understood you" rows:

- **Boot cinema** — arc reactor animation behind the boot screen (default ON).
- **Qwen NLU assist** — when rules are unsure, ask Qwen 3.5 4B locally to parse intent (default OFF).
- **Holographic HUD** — floating translucent panels (default OFF).

The HUD also has a dedicated `HUD` button in the header (next to SETTINGS) so
you can toggle it without opening the drawer.

---

## Architecture & safety

### Strategy: pure addition

Every existing file keeps its logic intact. The only edits are:

1. `server.js` — added ONE new POST route (`/api/nlu/parse`). Existing routes are unchanged.
2. `script.js` — added ONE guarded block after `NLU.classify()` that consults `NLUQ.parse()` only when (a) the user enabled it, (b) the rule engine was unsure, and (c) Ollama is online. The block is wrapped in `typeof NLUQ !== 'undefined' && NLUQ.enabled && llmReady()`, so if anything is missing, behaviour is identical to upstream.
3. `index.html` — added 2 `<link>` tags, 3 `<script>` tags, 3 settings toggle rows. No existing markup was moved or deleted.

### Feature 1 — NL Command Parser (Qwen + rules)

**Files:**

- `nlu-qwen.js` — browser module exposing `window.NLUQ`
- `server.js` (additive) — POST `/api/nlu/parse` route
- `script.js` (additive) — one guarded hook in `handleUser()` after `NLU.classify`

**Pipeline:**

```
User input
    │
    ▼
NLU.normalize → NLU.classify  (existing, unchanged)
    │
    ▼ rule result with intent + confidence
    │
    │   if (NLUQ.enabled && llmReady && intent==CONVERSATION || conf<0.85):
    │       │
    │       ▼
    │   NLUQ.parse()  →  POST /api/nlu/parse  →  Qwen 3.5 4B (local)
    │       │
    │       ▼ strict JSON: {intent, args, confidence} whitelisted to JARVIS intents
    │       │
    │       ▼ if Qwen.confidence ≥ 0.7 AND > rule.confidence + 0.05:
    │   override rule result with Qwen's
    │       │
    │       ▼ else: keep rule result unchanged
    │
    ▼
Decider.signals + Decider.decide  (existing, unchanged)
    │
    ▼
executeTool OR askLLM (existing)
```

**Safety guarantees:**

- Qwen's output is parsed against a strict whitelist of ~40 known JARVIS intents. If Qwen returns anything else (e.g. `DELETE_EVERYTHING`), the route rejects it and the rule result stands.
- Qwen must beat the rule engine's confidence by at least 0.05 AND score ≥ 0.7 to override.
- If Ollama is offline, `llmReady()` returns false and the hook is skipped entirely — zero added latency.
- All NLUQ parse events appear in the **"How I understood this" inspector** (Settings → "Show how I understood you") under the `qwen_nlu` trace note.
- The hook never fires for: greetings, "yes"/"no", pending approvals, or any state where `ctx.pending` is set (mid-flow confirmations).
- NLUQ never calls the chat endpoint — it uses a dedicated small JSON completion (`maxTokens: 220, temperature: 0.2, json: true`) so it's fast and cheap.

**Mapping Qwen intents → JARVIS tools:** The full mapping lives in `nlu-qwen.js` (`TOOL_BY_INTENT`). For each Qwen intent it returns `{tool, args}` matching what `executeTool` already expects, so the rest of the pipeline is unchanged. Examples:

| Qwen intent | Qwen args | JARVIS tool | JARVIS args |
|-------------|-----------|-------------|-------------|
| `OPEN_APPLICATION` | `{app:"chrome"}` | `openApplication` | `{app:"chrome"}` |
| `BRIGHTNESS` | `{level:30}` | `brightness` | `{level:30}` |
| `TIMER` | `{minutes:10}` | `timer` | `{minutes:10}` |
| `READ_FILE` | `{}` | `readFile` | `{}` (uses existing context) |

### Feature 2 — Cinematic Boot + Arc Reactor

**Files:**

- `boot-cinema.js` — Canvas 2D animation, exposes `window.BootCinema`
- `boot-cinema.css` — styles for the canvas overlay and "JARVIS ONLINE" caption

**How it works:**

- On `DOMContentLoaded`, `BootCinema.start()` checks `settings.bootCinema !== false` and `?skipboot` query param. If either is set, it stays inert.
- If active, it inserts a `<canvas id="arcReactorCanvas">` and `<div id="arcCaption">` as the first children of the existing `#bootOverlay`, then animates:
  - Outer rotating dashed ring
  - Mid ring with 6 thick arc segments (the iconic reactor look)
  - Inner counter-rotating thin dashed ring
  - Triangular coil housing (8 spokes with end nodes)
  - Glowing core (radial gradient with white-hot centre)
  - 64-particle halo orbiting at varying speeds
- It reads the active theme's `--rgb` CSS variable at runtime, so it matches arc/gold/crimson/violet automatically.
- When `#bootOverlay.classList.add('done')` is called by the existing `bootSequence()` in script.js, the cinema canvas fades out together with the overlay.
- A `MutationObserver` watches for the overlay's removal as a hard stop. A 12-second safety timeout also stops it.

**Safety guarantees:**

- The existing 7-line boot messages, progress bar, skip button, and `sfx.boot()` sound all run unchanged.
- The reactor canvas is `pointer-events: none` so it never blocks the skip button.
- `prefers-reduced-motion: reduce` is honored — a single static frame is rendered.
- Total added dependency: zero (pure Canvas 2D).

### Feature 3 — Holographic HUD Overlay

**Files:**

- `hud-overlay.js` — `window.HUDOverlay` module
- `hud-overlay.css` — styles for panels, header button, reticle
- `index.html` — one new `HUD` button injected into the header next to SETTINGS
- (Settings toggle is static HTML in the BEHAVIOUR section.)

**Panels:**

1. **Top-left (CHRONO):** live clock + date + (optional) weather row.
2. **Top-right (SYSTEMS):** mini-bars for CPU / RAM / Disk / Uptime, with `warn`/`crit` colour states matching the existing telemetry panel.
3. **Bottom-left (ACTIVITY):** mirrors the last 3 rows from the existing `#logStream` (via `MutationObserver`).
4. **Bottom-right (QUICK):** chip palette that fires `handleUser(cmd, 'hud')` — TIME / WEATHER / BATTERY / SCREEN / VOL ↓ / VOL ↑ / MUTE / FOCUS / BRIEFING.

**Interaction:**

- Toggle: header `HUD` button, or Settings → "Holographic HUD" toggle. Both stay in sync.
- Drag any panel by its grip strip (the small bar at the top of each panel). Position is persisted per-panel to `localStorage` (`jarvis.hudPositions`).
- ESC closes the overlay (won't steal ESC from chat input, approvals, or open modals).
- All panels are `position: fixed; z-index: 70; pointer-events: auto` — they sit above the existing UI but don't block the existing layout.

**Safety guarantees:**

- Default OFF. Even when on, it adds zero server calls — clock reads `Date`, stats read from existing `#cpuBar` etc., log mirrors `#logStream` via observer.
- On mobile (`max-width: 768px`), only clock + stats panels show (smaller versions); log + quick panels hide to avoid crowding.
- `prefers-reduced-motion: reduce` is honored — panel slide-in transition is removed.
- The reticle decoration around the central orb uses the existing `--rgb` variable, so it matches whatever theme is selected.

---

## File-by-file change summary

### New files

| Path | Purpose | Lines |
|------|---------|-------|
| `nlu-qwen.js` | Browser module: Qwen NLU assist | ~210 |
| `boot-cinema.js` | Browser module: arc reactor boot animation | ~310 |
| `boot-cinema.css` | Styles for arc reactor stage | ~85 |
| `hud-overlay.js` | Browser module: floating HUD panels | ~390 |
| `hud-overlay.css` | Styles for HUD panels, button, reticle | ~210 |

### Existing files edited (additively)

| Path | Change |
|------|--------|
| `server.js` | Added ONE new POST route `/api/nlu/parse` and a `NLU_INTENT_WHITELIST` constant. All existing routes, middleware, and logic are unchanged. |
| `script.js` | Added 3 keys to the default `settings` object (`qwenNlu: false`, `hudOverlay: false`, `bootCinema: true`) and ONE guarded block after `NLU.classify()` in `handleUser()`. The block is fully reversible: if `typeof NLUQ === 'undefined'`, behaviour is identical to upstream. |
| `index.html` | Added 2 `<link>` tags (boot-cinema.css, hud-overlay.css), 3 `<script>` tags (nlu-qwen.js, boot-cinema.js, hud-overlay.js), and 3 settings toggle rows (Boot cinema, Qwen NLU assist, Holographic HUD) at the end of the BEHAVIOUR section. No existing markup was moved or deleted. |

---

## Verification

### Existing tests

Run `node tests/run-all.js` from the project root. The result is identical to a
fresh upstream clone:

- ✅ **nlu.test.js: 281/281 passed** — the NLU pipeline is unaffected.
- ✅ **llm.test.js: 66/66 passed** — the new `/api/nlu/parse` route is additive.
- ✅ All other test suites match the upstream master exactly: api/codeask/instance/rag have the same pre-existing failures on Linux (Windows-only paths, missing PDF, etc.) — **not introduced by these changes**.

### New tests

Two smoke-test scripts live in `/home/z/my-project/scripts/`:

- `smoke-test-modules.js` — verifies all 3 browser modules load cleanly in a vm sandbox without throwing.
- `test-nlu-parse.js` — verifies the NLU parser logic with 9 canned scenarios (whitelist enforcement, JSON validation, fallbacks).

### Manual smoke test

```bash
cd JARVIS
npm install            # only if you haven't already
npm start              # starts server on http://localhost:3000
```

Open `http://localhost:3000/` in Chrome or Edge. You should see:

1. The arc reactor animation layered behind the existing 7-line boot sequence.
2. A new `HUD` button in the header (next to SETTINGS).
3. In Settings → BEHAVIOUR, three new toggle rows at the bottom.

To test the Qwen NLU assist:

1. Make sure Ollama is running: `ollama serve` (you should already have `qwen3.5:4b` pulled).
2. In Settings → BEHAVIOUR, turn ON "Qwen NLU assist".
3. Try a fuzzy command like: `i wanna dim the lights a bit` or `set a timer for ten minutes`.
4. Settings → "Show how I understood you" → under the reply, the trace will show `qwen_nlu` if Qwen was consulted.

To test the HUD overlay:

1. Click the `HUD` button in the header (or Settings → BEHAVIOUR → "Holographic HUD").
2. Four translucent panels appear at the screen corners.
3. Drag any panel by its grip strip; positions persist across reloads.
4. ESC closes the overlay.

---

## Troubleshooting

**Qwen NLU assist doesn't seem to do anything.**
- Verify it's enabled in Settings → BEHAVIOUR → "Qwen NLU assist".
- Verify the AI Brain pill is green (Ollama running with `qwen3.5:4b`).
- Try a genuinely ambiguous command — exact matches ("open chrome") still go through the rule engine, which is faster and is by design preferred.
- Check the activity log for `NLUQ parse error` messages.

**Arc reactor doesn't show on boot.**
- Verify "Boot cinema" is ON in Settings → BEHAVIOUR (it's on by default).
- The reactor only renders during boot. Reload the page to see it again.
- `?skipboot` in the URL bypasses both the existing boot screen AND the reactor.

**HUD panels overlap the existing UI.**
- Drag them by their grip strips to move out of the way. Positions persist.
- On small screens, only clock + stats panels show.

---

## Roadmap (not yet built, listed for transparency)

These were considered but intentionally deferred to keep this change small and reviewable:

- Long-term memory with vector DB (ChromaDB)
- "Suit Up" focus mode (one-command scene-setter)
- Smart-home local LAN integration (Hue / Yeelight)
- Voice-cloned TTS
- Meeting copilot (live transcription + summary)

---

## License

Same as upstream JARVIS: MIT. All added files are original work.
