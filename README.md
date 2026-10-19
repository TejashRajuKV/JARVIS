# J.A.R.V.I.S. Web Console v2.0

A complete re-implementation of the JARVIS assistant as a **self-contained web console** — same philosophy as the original Windows assistant (local-first rules, LLM fallback, persona, proactive behavior), now running entirely in the browser + a Next.js server. No Windows dependencies, no microphones to configure on the host: speech, sounds, gestures and telemetry are handled by the browser itself.

> Lineage: this repository's git history contains the original Windows Node.js assistant. The web console supersedes it as the main implementation (`git log --follow` the old tree if you need the legacy files).

---

## Feature Workstreams

### A — Core reliability & UI
- Cinematic boot sequence (arc-reactor artwork, staged status lines, synthesized sweep).
- HUD shell: glass panels, animated arc-reactor core that reacts to `idle / listening / thinking / speaking` states, sticky status footer, command palette (`Ctrl/Cmd + K`), settings drawer, activity log.
- Every request is traceable: intent, route (rule vs LLM), confidence, emotion and latency chips are shown under each reply.

### B — Interaction & voice intelligence
- Web Speech STT/TTS: push-to-talk **and** continuous wake-word mode with a self-hearing guard (it will not listen to itself speak).
- Speech-correction layer: repairs misrecognitions ("sandy cheese" → "send a text" style maps) before intent parsing; visible "heard → corrected" chips.
- Web Audio synthesized sounds (boot sweep, listen blips, send/receive, success arpeggio, error buzz) — no audio assets needed.
- Stroke gestures drawn anywhere on the background: `circle` (clear chat), `v` (voice), `m` (mute), `z` (panic/dnd), `caret` (palette), `n` (new task). $1 recognizer: resample → scale → translate → golden-section rotation search.

### C — Intelligence & decision-making
- **Local rule engine first** (fast, offline, deterministic): time/date, reminders, tasks, memory, system status, help, personality, gestures/commands — with a negation guard so "don't set a reminder" is not executed as one.
- **LLM decision layer** only when rules are unsure: strict-JSON intent whitelist + arguments + confidence + emotion + memory extraction.
- **Ambiguity guard**: low-confidence state-mutating intents become a clarification question with buttons instead of a wrong action.
- Long-term memory (`remember that …` / `what do you remember about …`) persisted in SQLite and fed back into LLM context.

### D — System intelligence
- Real browser telemetry: battery level/charging, storage quota/usage, network type/RTT, CPU cores, device memory, live FPS.
- `system status` produces a natural-language report; meaningful advisories (low battery while unplugged, storage pressure) fire **once per threshold crossing**, never spam.
- All controls and tools return explicit success/failure payloads surfaced in the HUD.

### E — Personal assistant
- Tasks (project/priority/due), reminders with **server-side firing** (they survive reloads; client polls and raises HUD alert + speech).
- Multi-step agent: LLM plans 2–6 steps from a whitelisted toolset, executor runs them sequentially with per-step verification, one LLM-assisted recovery retry, and an honest final report (failures stay visible in history). Cancellable mid-run.

### F — Natural human-like interaction
- Persona-adaptive replies: JARVIS (dry British wit) or FRIDAY, switching via `personality switch`.
- Emotion detection (stressed/curious/tired/urgent/…) adapts tone and pacing; TTS voice/rate follow the persona.
- Follow-up context ("set a reminder" → "for what?" → "for that" works), proactive but throttled suggestions, DND and panic modes.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS 4, shadcn/ui, framer-motion, Lucide |
| State | zustand (client), TanStack-style fetch helpers |
| DB | Prisma ORM + SQLite (`db/custom.db`) |
| AI | z-ai-web-dev-sdk — LLM chat completions + web search (server-side only) |
| Voice/Sound | Web Speech API + Web Audio synthesis |
| Gestures | Custom $1 unistroke recognizer on canvas |

## Getting Started

```bash
bun install
bun run db:push     # create/migrate SQLite schema
bun run dev         # http://localhost:3000
```

Open the console, wait for the boot sequence, then try:

- `what time is it` — rule intent (95% confidence, instant)
- `remind me to stretch in 2 minutes` — reminder + server-side firing
- `remember that my project checkpoint is Friday` → later `what do you remember about my project`
- `system status` — real telemetry report
- `search for the latest fusion energy news` — grounded summary + source card
- `plan a research run: find the latest on solid-state batteries and remember a summary` — multi-step agent
- Draw a **circle** anywhere → clears the conversation. `v` toggles voice.
- `switch to FRIDAY` — different persona, voice and tone.

## Architecture

```
Browser                                 Server (Next.js)
┌─────────────────────────┐             ┌──────────────────────────┐
│ HUD (React + zustand)   │  POST       │ /api/chat                │
│  ├─ voice.ts (STT/TTS)  │ ──────────▶ │  ├─ nlu.ts  rule engine  │
│  ├─ sound.ts (WebAudio) │             │  ├─ brain.ts LLM layer   │
│  ├─ gesture-layer ($1)  │  poll 30s   │  ├─ executor.ts tools    │
│  └─ telemetry.ts        │ ──────────▶ │  ├─ reminders ?due=1     │
│ proactive.ts (alerts)   │             │  └─ agent.ts  plan/run   │
└─────────────────────────┘             │      verify → recover    │
                                        └──────────┬───────────────┘
                                                   ▼
                                          Prisma + SQLite
```

- **Decision pipeline**: rules (confidence ≥ 0.8) execute immediately; otherwise the LLM layer decides; ambiguity guard blocks low-confidence mutations.
- **Honesty contract**: agent steps are verified against their tool result; recovery attempts are recorded as such; the final report never claims success for failed steps.
- **Privacy**: STT/TTS use the browser's built-in engines; only chat text and explicit memories leave the machine (to the LLM/search layer).

## Repository Layout

```
prisma/schema.prisma         # Message, MemoryFact, Task, Reminder, AgentRun/Step, EventLog, Setting
src/app/api/*                # chat, memory, tasks, reminders, log, settings, search, agent/run|cancel
src/lib/jarvis/types.ts      # frozen API + DTO contract
src/lib/jarvis/nlu.ts        # normalization, speech repair, rule engine, date parsing
src/lib/jarvis/brain.ts      # LLM decision layer, persona, agent planning, summaries
src/lib/jarvis/executor.ts   # tool funnel → DB ops + tool-result payloads
src/lib/jarvis/agent.ts      # multi-step run loop (plan → execute → verify → recover)
src/lib/jarvis/client/*      # voice, sound, telemetry, proactive, gesture-layer, helpers
src/components/jarvis/*      # HUD components (boot, arc core, chat, panels, palette, …)
```
