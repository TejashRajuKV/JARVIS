# JARVIS roadmap phases 3–8 — implementation status

This document separates existing repository foundations from the additive work in this branch. It does not claim that an existing subsystem is production-verified merely because its module is present.

## Phase 3 — Skills, plugins and reusable workflows
**Existing foundation:** `skillpack.js`, `skills-bundled/`, `skill-hub.js`, and `routines.js` provide prompt-only skill packs, explicit enable/disable, and user-managed routines. Skill pack folders are instructions, not executable plugins; sibling scripts are not loaded or run.

**Added here:** workflow plans are normalized and validated against unique IDs, known dependencies, cycle checks, a bounded step count, and explicit permission tiers. Only explicitly read-only steps with a safe tier can share a parallel wave. This is a planner/validator, not a bypass around the normal tool registry.

## Phase 4 — Research and browser agent
**Existing foundation:** `browser-recovery.js` stores a bounded list of explicitly opened pages and strips credentials, secret query parameters and URL fragments.

**Added here:** a local research notebook persists a question, title, findings and sanitized source links. The Agent Platform UI can create, list and delete sessions. It does not scrape sources automatically or represent saved URLs as independently verified citations.

## Phase 5 — Scheduler and proactive assistant
**Existing foundation:** `scheduler.js` owns reminders, deadlines, sensor triggers and same-origin server-sent events; it handles missed recurring reminders without replaying every missed occurrence. Existing panic/disable checks remain in the scheduler.

**Scope:** this branch reuses that subsystem; it does not add a second timer loop or silently execute routines from the new UI.

## Phase 6 — Multi-agent orchestration
**Added here:** a dependency-aware workflow graph and safe parallel-wave planner establish the planning boundary. Any non-safe step is serialized and marked approval-required.

**Not claimed complete:** automatic multi-model delegation, worker isolation, shared artifact arbitration and end-to-end execution of workflow graphs are not wired up by this change. Validating a graph is not the same as executing it.

## Phase 7 — Security and reliability
**Added here:** a bounded local audit trail stores only allowlisted categories/outcomes/actions, timestamps and optional run IDs. It deliberately excludes prompts, file paths, URLs, tool arguments and credentials. Research and workflow-validation operations write server-generated events. Files use private permissions and atomic replacement.

The audit trail is intentionally metadata-only. It is not a tamper-proof security log, and it does not yet capture every action across every existing module.

## Phase 8 — Remote access and device integration
**Existing foundation:** Phone Hub already has separate auth/device capability modules, a TLS gateway, optional private-network/Tailscale configuration and explicit capability grants. The gateway is opt-in and its physical-device setup must be tested on the operator's network.

**Scope:** this branch reports the Phone Hub foundation but does not expose new public ports or relax same-origin protections.

## New endpoints
- `GET /api/platform/status` — subsystem availability summary
- `POST /api/workflows/validate` — validation-only dependency graph analysis
- `GET /api/research/sessions`, `POST /api/research/sessions`
- `GET /api/research/sessions/:id`, `DELETE /api/research/sessions/:id`
- `GET /api/audit/events?limit=100` — bounded metadata-only event list

## Manual validation
The new regression suite is `node tests/agent-platform.test.js`; the existing full suite is `npm test`. Tests were authored but not run during this change. Verify the UI in the existing JARVIS instance at its normal address; do not start a second server. Also validate Phone Hub on an actual paired device before treating remote access as operational.
