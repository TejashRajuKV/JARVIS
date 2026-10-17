# JARVIS — plan to strengthen every feature

Written 2026-10-13 from a read-only survey of the code (a subagent read the README and ~45 modules; I re-checked the claims marked ✔ myself).
Items marked ✅ are done (see Progress below). Effort: **S** = under half a day, **M** = 1–2 days, **L** = 3+ days.

## Progress

**Week 1 done (2026-10-13):** 0.1 central confirmation for single commands, 0.3 dot-files and credential files unreadable, 0.4 safe "commit all changes" (named project, file list, secret refusal; diffs redacted before an AI sees them), 0.7 cloud-consent gate (clipboard, screen, files, hotkey selection), 1.7 Node version check, 1.8 no cached state copy, 2.3 viva grades are never a silent 0. Each has tests (`gitsafe`, `nodecheck`, `sw`, `skills`, api, e2e).

*Things found while doing it:* the survey said a typed "close chrome" and "run x.py" skipped confirmation (true — now fixed); the e2e camera tests used fixed waits and failed on a busy computer (now they wait for the camera); `confirmCard` leaves JARVIS "busy" when called outside a chat turn (the hotkey path now hands it back).

**Week 2 (2026-10-13):** done — 0.2 one-time approval tokens, 0.8 CSP on generated websites, 2.1 no ACTIONS/TOOLS block when the page will not run a tool, 2.7 concept questions with words like "driver/current/update" stay with the local AI. Half done (◐) — 1.3 per-call timeouts are in, the explicit "awaiting approval" state that queues other input is not; 1.6 AI retries with back-off are in, the single AI job queue with priorities is not (it could block your chat behind a ten-minute JARVIS Code build, so it needs a design first).

Also: the camera retries once when the browser says "no camera found" (a camera that was still waking up), the full-suite runner gives the API suite 5 minutes, and the chat-archive test no longer depends on today's date.

**Week 3 (2026-10-13), partly done:** 0.5 ✅ the three camera libraries are fingerprinted (SRI) and JARVIS's pages carry a Content-Security-Policy (found by testing live: OpenCV needs eval, so `unsafe-eval` is allowed; inline scripts and foreign hosts stay blocked; the lock page's script moved to `lock-page.js`; the hand-gesture library cannot be fingerprinted). 1.5 ✅ undo survives a reload for file actions (`undolog.js`). 1.9 ✅ the trash is on the item's own drive and items older than 30 days are removed (`trashkeep.js`). 0.6 ✅ phone commands: unlock window 15 → 10 minutes, an optional **strict mode** (a fresh code with every command, no window), and `NTFY_TOKEN` for a private ntfy. Not done: encrypting the message text itself (a public topic still shows replies in plain text).

**Weeks 4–5 (2026-10-13), partly done:** 2.2 ✅ the local model's context is sized per request; 2.4 ✅ lecture notes cover up to ~3 h and say when they were cut (a background job with progress is still open); 2.5 ✅ exam questions spread over more of a long note; 2.6 ✅ research answers carry no earlier chat; 1.4 ◐ timers survive a reload (focus sessions and queued routines do not yet); accessibility basics (Phase 4.3) ✅ — named controls, a log region, a live region for finished replies. Phase 3: attendance target ✅ and pattern learning's "make it a routine" ✅ (it now really creates and schedules the routine); (a setting instead of a fixed 75%). **Measured instead of assumed:** with the real file index of this laptop, the heaviest searches ("did you mean…", find a folder anywhere) block the server for at most about 0.1 s, so 1.1 (a worker for them) is **not worth doing now**. **Still open:** 1.2 per-item state patches between tabs, the Phase 3 per-feature upgrades, and splitting `script.js`.

**External review follow-up (2026-10-17):** a static review of `main` found that the decision engine’s route was computed but not enforced. Verified and fixed: ✅ “check the latest git commit in my project” / “show the last git commit” were read as *make a commit* (the NLU rule) — now the log; ✅ a command that changes something, worded as “latest … in my project”, asks first (read-only commands still just run); ✅ e2e checks assert which tool actually ran for these phrases; ✅ secret scan also catches Stripe live keys, npm and Hugging Face tokens; ✅ fetched pages stop downloading at 1 MB and non-text pages (PDF, images) are refused. *Not done, on purpose:* pinning the fetch to the checked address (DNS rebinding — read-only text, one user, low risk), making `POLICY` the single source of truth for execution, and moving the request pipeline out of `script.js`. *Where the review was wrong:* CI already runs `npm test` on Windows and Ubuntu (`.github/workflows/test.yml`); research already separates “search failed / no results / unrelated pages / model down”; Stop already cancels AI requests; routines already skip steps that need permission.

**Phase 3, first batch (2026-10-14):** ✅ "don't …" commands do nothing (negation fix); ✅ Qwen assist limited to 26 real intents; ✅ keep-alive every 2 minutes; ✅ README no longer calls neural voice/translation opt-in; ✅ web pages fetched from the public internet only (netsafe.js: resolved addresses + redirects checked hop by hop); ✅ attendance: CLASS CANCELLED button and subject aliases; ✅ monthly budget alerts; ✅ wake-word listener retries without giving up. 85 suites pass.

## How to read this

- **Phase 0 — close the safety gaps** (do first, small, high value).
- **Phase 1 — make it dependable** (stop blocking, losing data, silent failures).
- **Phase 2 — make the small local model work better** (qwen3.5:4b, ~8K context).
- **Phase 3 — per-feature upgrades.**
- **Phase 4 — structure, tests, accessibility, onboarding.**

Each item says *what is weak now → what to do → how we prove it* (every change gets a test, as in the existing suites).

---

## Phase 0 — safety gaps

| # | Weak now | Do | Proof | Effort |
|---|---|---|---|---|
| 0.1 ✅ | ✔ A typed "close chrome" or "run x.py" skips the confirm tier; only the multi-step agent confirms (`script.js` CLOSE_APPLICATION / RUN_FILE; tiers in `agent-tools.js`). The server comment in `/api/tool/runFile` even says "the page asks before running". | Apply `tierFor()` once, centrally in `handleUser` before `executeTool`, for every `confirm`/`explicit` intent. Close apps gracefully (`CloseMainWindow`) before `taskkill /F`. | page test: each confirm-tier intent asks first, "no" does nothing | M |
| 0.2 ✅ | The server trusts body flags `approved:true` and `online:true`. | Server issues a one-time nonce with the 409 "needs approval" answer; the retry must carry it. Keep "Online tools" as server state, read server-side. | api test: replayed or forged `approved` is refused | M |
| 0.3 ✅ | ✔ `isInternal` hides only `.config.json`, `.jarvis-state.json`, `.backups`. Readable through file tools: `.shotindex.json` (OCR of screenshots), `.chat-archive`, `.ai-calls.json`, `.mirror.json`, and home credential files (`.git-credentials`, `.npmrc`, `.netrc`). | Block every dot-file/dot-folder under `~/jarvis` and a list of credential files in the home folder, for read and write. | api test over each path | S |
| 0.4 ✅ | ✔ `GIT_CWD` falls back to the first project root or JARVIS's own folder; `gitCommit` runs `git add -A` there. | Require an explicit repo for commits, show the file list to be staged, confirm. Also scan the diff text (not just file names) for key patterns before sending to an AI. | devtools test with a planted key in a diff | S |
| 0.5 ✅ | CDN scripts (opencv, jsQR, face-api, MediaPipe) load without integrity checks in a page that can drive the laptop. No CSP. | Add `integrity` hashes or vendor the files into `vendor/`; add a CSP header (`script-src 'self'` + the pinned hosts). | e2e: pages still load; test that the CSP header is present | M |
| 0.6 ✅ | Phone channel: public `ntfy.sh` topic, plaintext, and one authenticator unlock is **global for 15 minutes**. | Per-message HMAC or per-command code; optional self-hosted ntfy with token; encrypt reply text. | scheduler test: a message without the proof is ignored | M |
| 0.7 ✅ | Cloud models get screenshots, clipboard text and hotkey selections without a per-action consent (chat archive and lecture notes do ask). | One shared `confirmCloud(kind)` card used by screen read, clipboard, hotkey, RAG excerpts. | page test: each path asks when the model is online | S |
| 0.8 ✅ | Generated websites are filtered with a regex (`sanitizeHtml`); README says pages load no outside scripts. | Serve generated pages with a CSP meta tag (`default-src 'self'`) and keep the filter as a second layer. | skills test with protocol-relative `src=//`, `<link>`, fetch | S |

---

## Phase 1 — dependable

| # | Weak now | Do | Proof | Effort |
|---|---|---|---|---|
| 1.1 ◐ (measured: with the real index the heaviest searches block ≤0.1 s, so a worker was not worth it; the RAG index is now persisted and slow requests/lag are logged) | Synchronous scans block the server (file index, `laptopSearch`, `findAllowed`, `similarNames` over up to 1.5M paths, RAG scan, diskcare, CSV). Reminders and SSE stall. | Move indexing and name search to a `worker_threads` worker; persist the index and update incrementally. Trigram prefilter before Jaro-Winkler. | test: server answers `/api/health` within 200 ms while a big scan runs | L |
| 1.2 ✅ | (done: the server pushes every changed shared list to the other tabs, which adopt it; a stale tab's whole-list save is three-way merged by id on the server (statemerge.js); import/restore reloads every tab) Last-writer-wins state: two tabs (or the phone page) overwrite each other's todos; import/restore doesn't reach open tabs. | Patch operations with version counters per key; a server "state epoch" pushed over SSE so all tabs reload after restore. | instance test with two clients | L |
| 1.3 ✅ | ✔ `callToolRaw` has no timeout; `busy` is released while a plan or approval is pending, so a second command can interleave. | Timeouts per call class; an explicit "awaiting approval" state that queues other input. | page test | M |
| 1.4 ✅ | Timers and focus sessions live in page memory — a reload loses them; routines are dropped if the page is busy; alert de-dup is per tab. | Store timers/focus as server reminders; queue routines while busy; keep alert keys in shared state. | scheduler + page tests | M |
| 1.5 ✅ | Undo closures live in page memory (lost on reload); server TTLs disagree (15 vs 30 min); JARVIS Code undo stops half-way. | Persist file-operation undo records on the server (like diskcare journals); one TTL; undo continues past failures and reports them. | undo + jarviscode tests | M |
| 1.6 ✅ | No retry for 5xx/429 from AI providers; no queue, so chat + summarise + lecture can hit the GPU together. | Retry with jitter; a single LLM job queue (chat first, background later). | llm test with a flaky fake provider | M |
| 1.7 ✅ | ✔ `engines` says Node ≥18 but code needs `AbortSignal.any` (≥20.3) and global `WebSocket` (22). | Set `engines` to the real minimum and check at startup with a clear message. | start test | S |
| 1.8 ✅ | ✔ `sw.js` caches `api/state.js` (a full copy of chats/memory) in browser storage. | Remove it from the shell list; load state on demand. | sw test | S |
| 1.9 ✅ | Cross-drive delete copies into `~/jarvis/.trash` on C: (C: is nearly full). `.trash` never expires. | Same-drive trash everywhere (as diskcare); auto-expire after 30 days; remind about trash size. | api test | M |

---

## Phase 2 — small-model fit

| # | Weak now | Do | Effort |
|---|---|---|---|
| 2.1 ✅ | ✔ The full tool catalogue is in every system prompt. | Send a short list chosen by intent, or none when tools are off. | S |
| 2.2 ✅ | ✔ Requested contexts (JARVIS Code 24576, site 12288/16384, fixer 12288) exceed what a 6 GB GPU and a 4B model handle well. | Size context and output per model; split big jobs; show an honest "this will be slow" note. | M |
| 2.3 ✅ | JSON-only jobs (planner, viva, exam) fall back weakly. ✔ A viva answer whose JSON fails to parse scores **0**. | Retry the parse once; mark the answer "ungraded" instead of 0; repair loose JSON. | S |
| 2.4 ✅ | Lecture notes: up to 24 sequential AI calls in one HTTP request; the merged notes are cut to 3,500 characters; pieces after #24 dropped. | Background job with progress over SSE; hierarchical merge without truncation. | M |
| 2.5 ✅ | Exams sample only 4 windows of a long note; topic-only exams come from model memory. | Spread questions across all chunks; use the notes index for topics. | S |
| 2.6 ✅ | Research sends up to ~9K characters of pages plus history to an 8K model. | Drop history for research; budget tokens per source. | S |
| 2.7 ✅ | Concept questions containing words like "drivers/versions/current" go to the web. | Let a reasoning-question signal beat the "fresh" word list; add examples to the decider tests. | S |

---

## Phase 3 — per-feature upgrades

**Chat and understanding**
- *Chat/AI brain:* token counting and per-model history caps; the queue from 1.6.
- *Rule engine:* ✅ negations ("don't lock the screen", "never open chrome") now do nothing and say so (NEGATED intent; before, "don't open" closed the app and "don't lock" locked the screen). Add a lint test that flags rules shadowed by earlier ones.
- *Context ("there", "it", "the second one"):* ✅ focus persists across a reload; show what "it" refers to.
- *Did-you-mean:* faster ranking with a trigram prefilter (see 1.1).

**Voice**
- *Wake word:* while the page is open, Chrome streams all room audio to Google. Use the offline Windows listener as the trigger and start cloud dictation only after it; pass the chosen wake word to the offline grammar; ✅ it no longer gives up after 5 restarts (keeps retrying, waits up to 5 minutes).
- *Speech output:* online neural voice and translation stay on by default (Telugu/Kannada need them) — ✅ the README now says so honestly instead of calling them opt-in; add an offline Windows voice fallback; health-check the Edge token.
- *Lecture mode:* prefer Whisper when installed; add a small "heard so far" panel; per-language Whisper model choice.

**Laptop control**
- *Apps/system:* graceful close (0.1); a long-lived PowerShell helper so each action isn't a fresh 0.3–1 s spawn; real volume level instead of key presses.
- *Screen/vision/clipboard:* consent gate (0.7); OCR language packs beyond English.
- *Files:* 0.3, 1.9; sign approvals (0.2).
- *Disk and photo care:* async walker; persist plans across restart; ✅ every move to the trash already says “empty my JARVIS trash” frees the space.
- *Keep-alive:* ✅ now checks every 2 minutes (was 5; turn it off and on again to update an existing task).
- *Backup/mirror:* (incremental runs already resume and keep 30 days of old versions) ✅ a "verify backup" command; state-epoch reload (1.2).
- *Screenshot search:* encrypt the index at rest (Windows DPAPI); incremental status counter; ✅ word-stem search.
- *Chat archive:* incremental status counter (it re-reads every monthly file); optional semantic search when an embedding model is installed.

**Study**
- *Attendance:* ✅ per-college threshold setting; ✅ subject aliases ("DBMS" = "Database Management Systems", ~25 common subjects); ✅ a CANCELLED button; server-queued prompts for missed classes.
- *Timetable import:* ✅ clash detection (overlaps flagged before you confirm); room/batch filter.
- *Assignments:* ✅ month-first dates option; ✅ weekly assignments; ✅ the to-dos are linked to the deadline.
- *Study plan fitting:* choose morning/evening preference; ✅ avoid clashing with existing reminders; re-fit when a class is added.
- *End-sem calculator:* ✅ the college's grade scale is stored once ("my grade cutoffs are O 85, A+ 75 …").
- *Exam/viva/flashcards:* 2.3, 2.5; ✅ spaced-repetition stats; ✅ export to Anki.
- *Notes/RAG:* ✅ the index is persisted (JSON cache keyed by size+mtime); ✅ per-root quotas so notes beat project folders; ✅ Unicode tokenizer for Telugu/Kannada; ✅ asking before sending excerpts to a cloud model was already done (confirmCloud 'files').

**Coding**
- *Run/explain & fix:* confirm first run outside `~/jarvis`; run in a temp copy with time/memory limits; diff-style fixes instead of reprinting the whole file.
- *JARVIS Code:* per-file diff with APPLY; atomic writes (temp then rename all); smarter file picking (imports/symbols, not just names); 1.5.
- *Website generator:* version history (not just one previous file); multi-file output; CSP (0.8).
- *Coding-AI hand-off:* ✔ author-specific `D:\Trae`, `D:\Windsurf`… paths → take install paths from settings; re-detect on demand.
- *Dev projects/git:* persist dev-server PIDs and adopt them after restart; read the port from the process, not stdout regex; 0.4.
- *Developer helpers (new):* standup options (week view, other author); ✅ commit message styles (conventional/plain); explain-error "apply the fix" as a preview.

**Automation**
- *Multi-step agent:* ◐ structured results: every tool result now carries ok/errorCode and the agent uses them first (the English checks remain as a fallback for replies that only say it in words); server-issued run token for guarded routes; parallel planner calls.
- *Routines/triggers/scheduler:* ✅ a routine builder panel (NEW / EDIT, steps checked as you type, optional schedule); run safe-tier routines on the server so no tab is needed; replace the 20-second PowerShell battery poll with a cheaper source.
- *Qwen NLU assist:* ✅ done — now 26 intents, all with a real handler (risky ones removed; tests/nluq.test.js). Was: about 24 of its 38 intents have no handler — map them to real intents and test, or remove the feature.
- *Pattern learning:* ✅ "YES, make it a routine" now creates and schedules the routine.

**Everyday**
- *Web/research/maps:* read the Online switch server-side; ✅ `redirect:'manual'` with re-validation per hop and DNS-resolved address checks (netsafe.js); optional SearXNG/Brave API instead of HTML scraping.
- *Extra tools (CSV, wiki, images, PDF):* move heavy parsing to workers; embed a Unicode font for PDFs; wiki modules in parallel.
- *Camera (scan/QR/presence/watch):* 0.5; keep working after reload where safe; scan to multi-page with reorder.
- *Expenses/habits/capture:* currency setting, user categories, ✅ monthly budget alerts, ✅ recurring expenses; global capture hotkey via the desktop hotkey helper.
- *Phone:* 0.6; allow skills and extras over the phone for safe commands.
- *Skill packs/router/palette:* show the skill's source on first run; add embeddings when available.

---

## Phase 4 — structure, tests, accessibility, onboarding

1. ✅ (executeTool's tools now live in tools/<area>.js behind tools/registry.js, with a uniform ok/errorCode) **Split `script.js`** (6,184 lines; `executeTool` is one ~1,900-line switch with 188 cases) into modules per area, behind a registry; make `Extras.intercept` isolate each module in try/catch (✅ done) so one throwing module can't kill the turn. (L)
2. **Test the untested:** ✅ `codepanel.js` (browser e2e: open, own chat, folder, close), ✅ `nlu-qwen.js`, ✅ `lock-client.js`, ✅ `tts.js`, `hud-overlay.js`, `boot-cinema.js`; make the browser e2e suite stable (the zero-width fake camera flake) and run it in CI; refresh the stale `tests/report.md`. (M)
3. ✅ (screen-reader names on every switch/input, chat is a live log, tests/a11y.test.js) **Accessibility:** `role="log"`/`aria-live` on the message list, labels on icon buttons, don't rely on colour alone, keyboard path through every card. (M)
4. **Onboarding:** a short "first 5 minutes" screen instead of a 1,195-line README; fewer default-on switches; a first-run check that tells you Node/Ollama/Edge problems in plain words. (M)
5. **Portability:** isolate the Windows-only parts (PowerShell, WinRT, `tasklist`, `netstat`) behind one adapter so the rest can run elsewhere. (L)

---

## Suggested order (about 6 weeks of part-time work)

1. **Week 1:** 0.1, 0.3, 0.4, 0.7, 1.7, 1.8, 2.3 — all small, all fix real risks.
2. **Week 2:** 0.2, 0.8, 1.3, 1.6, 2.1, 2.7.
3. **Week 3:** 0.5, 0.6, 1.5, 1.9.
4. **Week 4–5:** 1.1, 1.2, 1.4 (the big reliability changes), then 2.2, 2.4–2.6.
5. **Week 6:** Phase 3 items chosen by what you use most, then Phase 4.

## Caveats

- Items marked ✔ I confirmed in the code myself; the rest come from the subagent's reading and some are estimates (for example, exactly how much of the 8K context a long prompt leaves). Each item should be re-checked when it is started.
- Not everything here is worth doing. If you tell me which features you use daily, I'll cut the list down to those.
