# JARVIS capability implementation

The accepted plan covers all 115 checklist items. The machine-readable inventory is
[`capabilities.json`](capabilities.json). A pending verification status is not a claim
that the old functionality is absent; the audit baseline must be replaced by
acceptance evidence before marking the full capability complete.

## Phase 1 — in progress

Validation on 2026-11-19: `JARVIS_REQUIRE_ALL=1 npm test` passed all 130 suites.
After the final desktop-negation additions, focused NLU checks passed again.
The focused command suite has 29 assertions; task control 31, MCP 61,
planning 68, browser scenarios 39, native accessibility 15 and API checks 456.
Individual Windows symlink assertions and the POSIX permission-mode assertion
remain skipped where unsupported; this is not live verification of every feature.

Two earlier validation runs exposed fixture-readiness/timeout failures. The native
fixture now waits up to 25 seconds for its actual accessible input, with the same
fill/click/readback assertions. The multi-tab browser suite gets 300 seconds.
The browser checks also exposed a real stale stop-event race, fixed with persisted,
monotonic safety revisions and immediate status rendering.

Mutation checks rejected a broken relative-volume calculation and disabled
approval invalidation. The hotkey's native declarations compile without activating
the registration.

- Regression suite: `tests/nlu-phase1.test.js` covers device levels, fractional units,
  month-end dates, weather follow-ups, negation and pending reminder corrections.
- Emergency control: `tests/task-control.test.js` covers invalidation, cancellation,
  stale desktop approvals and explicit resume. Server integration is covered in
  `tests/api.test.js`.
- Registered code/build and project-server children receive termination requests
  by specific process ID. Other native/provider adapters still need cancellation
  coverage before item 104 can be marked complete.
- Global emergency hotkey: user approved the opt-in Ctrl+Alt+Pause registration.
  Implemented with a visible setting and fake-helper tests; disabled by default.
  A physical keypress and shortcut conflict on the user's laptop remain unverified.
  No ordinary keystrokes are recorded.
- Remaining Phase 1 work includes generalized typed entities, ranked ambiguity,
  structured exclusion selection and persistent dialogue slots.

## Later phases — implementation and evidence, 2026-11-19

2. Added a structured understanding result, typed entities, constrained Hindi and
   Hinglish commands, digit normalization, explicit “kal” clarification, expiring
   safe pending slots and topic return. `understanding.test.js`: 526 assertions,
   including 500 generated smoke examples. These are not a held-out benchmark.
   Ranked ambiguous intents, broad regional-language coverage and executable
   exclusion-aware bulk selection remain incomplete.
3. Added opt-in UIA selection/toggle/expand/scroll and an isolated CDP browser with
   control inspection, stale-observation checks, one-time approvals and manual
   login/CAPTCHA handoff. Native desktop/browser UIA fixture: 21 assertions;
   separate DOM browser fixture: 28, including dropdown selection and directional
   scrolling. The UIA helper traverses up to 32 levels with
   bounded nodes, pruning offscreen branches and avoiding redundant pattern calls.
   General keyboard shortcuts, drag/drop, upload dialogs and cross-frame actions
   remain incomplete; these are not claimed by the successful click/fill tests.
4. Added scheduled starts and runtime/model-call budgets to durable read-only
   jobs. `job-budgets.test.js`: 11 assertions, including hung-tool timeout and
   cancellation. Existing runtime suite: 42. Queue/profile changes from concurrent
   workspace work were preserved. General automatic replanning, recurring jobs,
   monetary budgets and arbitrary background desktop work remain incomplete.
5. Added editable DOCX/PPTX/XLSX exports, safe workbook formulas, grouped summaries
   and chart images; quoted document facts; suggested classifications; local image
   resize/crop/conversion; optional audio extraction/transcription. Office suite:
   18 assertions; content/media: 15, including stop-before-write checks. Native Excel pivot tables, complete video
   editing and more advanced cited research/document synthesis remain incomplete.
6. Added Google and Microsoft PKCE OAuth adapters with read-only mail/calendar/file
   scopes, encrypted tokens and one-time approval for each provider read. Account
   suite: 36 assertions with fake providers and disposable native DPAPI data.
   Live sign-in requires user-registered client IDs. Sending/calendar writes and
   document editing through these providers are not implemented. Existing MCP
   remains opt-in with per-call approvals.
7. Added Windows-user DPAPI vault storage and reviewed model-key migration, cloud
   chat/embedding secret checks, exact-request Windows Hello binding and opt-in
   reviewed Node/Python execution. Owner approval suite: 14 assertions; execution:
   21, including harmless real Node argument and timeout fixtures. Native execution is not a VM sandbox. Speaker identity, learning from
   demonstrations, full data-forgetting coverage and isolated VM execution remain
   incomplete. Recognizable-secret filtering is not a comprehensive PII detector.
8. Added the new panels to Apps, retained the shared color theme, and updated the
   offline shell. Browser scenarios verify that panel handlers attach. API suite
   discovers 350 routes in the latest isolated snapshot and passed 490 assertions;
   it includes default-denial checks for every registered Marks endpoint. Native
   UIA fixtures explicitly restore only their uniquely titled disposable browser;
   foreground/occlusion behavior caused earlier intermittent failures. No existing
   fill/click/readback assertion was removed. The stop launcher now checks the
   exact server path or live PID/port/private-home identity before stopping any
   process, and searches only port 3002. Launcher suite: 27 checks.
   Final strict full run on Node 24.16.0: **all 139 suites passed** using
   `JARVIS_REQUIRE_ALL=1 npm test` (`.qa-phases-verified.log`). The launcher identity
   extension passed separately at 27/27. `npm audit --audit-level=low` reported zero
   vulnerabilities. Individual Windows symlink checks and the POSIX file-mode
   check remain explicitly skipped where unsupported.

The current inventory is 139 automated suites plus the opt-in live suite. Historical
audit tables and the older `PHASES-3-8-IMPLEMENTATION.md` use different phase labels;
this file and `capabilities.json` track the accepted 115-item capability checklist.

The user explicitly chose to keep concurrent work running. These are changing-tree
results, not a clean-checkout or immutable-revision release certification. The
latest route snapshot contains 350 mounted routes, 186 rule intents and 80 internal
agent tools; external MCP tools are counted separately. Concurrent Marks code was
preserved and its suite passed 93 assertions in this run.

Production was restarted through `Stop JARVIS.bat` and `Start JARVIS.bat` after the
strict run. Health answers on port 3002 with a new PID. Read-only probes confirmed
that the managed browser, reviewed execution and extended desktop actions remain
disabled, and neither account provider is configured or connected. No user keys
were migrated and no account was signed in by this work. The official launchers
now use a bounded loopback probe, avoiding the localhost timeout that initially
caused a safe refusal to stop the old process.

External accounts, microphone/accent recordings, OSWorld environments, provider
side effects and optional native dependencies require explicit live evidence.
Tests with fakes do not establish those capabilities as ready on this laptop.
