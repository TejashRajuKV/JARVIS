# Test suite evidence

Normal and strict baseline runs used Node 24 and strict unhandled rejection handling. The after column uses final strict npm test where complete and the successful strict npm run test:report otherwise. Individual skipped assertions are listed separately.

| Suite | Baseline | Baseline strict | After | Actual final output |
|---|---|---|---|---|
| `a11y.test.js` | PASS | PASS | PASS | a11y: 12/12 |
| `agent-platform.test.js` | PASS | PASS | PASS | agent-platform: 33/33 |
| `agent.test.js` | PASS | PASS | PASS | routing: 74/74 (simple 28/28, multi 26/26, question 20/20) · safety: 149/149 |
| `aihealth.test.js` | PASS | PASS | PASS | aihealth: 68/68 |
| `api.test.js` | FAIL | FAIL | PASS | api: 427/427 · 232 of 274 routes called, 42 not testable |
| `applock.test.js` | PASS | PASS | PASS | applock: 54/54 |
| `approvals.test.js` | PASS | PASS | PASS | approvals: 14/14 |
| `apps.test.js` | PASS | PASS | PASS | apps: 17/17 |
| `assigntrace.test.js` | PASS | PASS | PASS | assigntrace: 52/52 |
| `autostart.test.js` | PASS | PASS | PASS | 15/15 autostart checks passed |
| `backup.test.js` | PASS | PASS | PASS | backup: 44/44 |
| `browser-recovery.test.js` | PASS | PASS | PASS | browser-recovery: 10/10 |
| `browser-scenarios.test.js` | PASS | PASS | PASS | browser-scenarios: 15/15 |
| `calling-service.test.js` | FAIL | FAIL | PASS | calling-service: configuration, safe TwiML, opt-in, quiet hours and rate-limit cases defined |
| `camera-page.test.js` | PASS | PASS | PASS | camera-page: 194/194 |
| `chatarchive.test.js` | PASS | PASS | PASS | chatarchive: 70/70 |
| `chatprompt.test.js` | PASS | PASS | PASS | chatprompt: 7/7 |
| `codeask.test.js` | PASS | PASS | PASS | codeask: 58/58 |
| `commerce-compare.test.js` | PASS | PASS | PASS | commerce-compare: 5/5 |
| `commerce.test.js` | PASS | PASS | PASS | PASS commerce.test.js — 18/18 |
| `connected-services.test.js` | — | — | PASS | connected-services: 11/11 |
| `coverage.test.js` | PASS | PASS | PASS | coverage: 395/395 · 186 intents |
| `csp.test.js` | PASS | PASS | PASS | csp: 19/19 |
| `csvtools.test.js` | PASS | PASS | PASS | csvtools: 107/107 |
| `dashboard.test.js` | PASS | PASS | PASS | dashboard: 25/25 |
| `decider.test.js` | PASS | PASS | PASS | decider: 144/144 |
| `dev-page.test.js` | PASS | PASS | PASS | dev-page: 97/97 |
| `devtools.test.js` | PASS | PASS | PASS | devtools: 51/51 |
| `diagnostics.test.js` | PASS | PASS | PASS | diagnostics: 5/5 |
| `diskcare.test.js` | PASS | PASS | PASS | diskcare: 97/97 |
| `doctext.test.js` | PASS | PASS | PASS | 26/26 — all passed |
| `e2e.test.js` | FAIL | FAIL | PASS | e2e: 452/452 |
| `emotion-intelligence.test.js` | PASS | PASS | PASS | 19/19 emotional intelligence checks passed |
| `extras-page.test.js` | PASS | PASS | PASS | extras-page: 640/640 |
| `facegreet.test.js` | PASS | PASS | PASS | facegreet: 33/33 |
| `focus-context.test.js` | PASS | PASS | PASS | focus-context: 6/6 checks passed |
| `gesture.test.js` | PASS | PASS | PASS | gesture: 22/22 |
| `gitsafe.test.js` | PASS | PASS | PASS | gitsafe: 46/46 |
| `hello.test.js` | PASS | PASS | PASS | hello: 31/31 |
| `hotkey.test.js` | PASS | PASS | PASS | hotkey: 12/12 |
| `imagegen.test.js` | PASS | PASS | PASS | imagegen: 64/64 |
| `instance.test.js` | PASS | PASS | PASS | instance: 17/17 |
| `jarviscode.test.js` | PASS | PASS | PASS | jarviscode: 20/20 |
| `keepalive.test.js` | PASS | PASS | PASS | keepalive: 21/21 |
| `learn.test.js` | PASS | PASS | PASS | learn: 26/26 |
| `life-page.test.js` | PASS | PASS | PASS | life-page: 173/173 |
| `lifeparse.test.js` | PASS | PASS | PASS | lifeparse: 179/179 |
| `llm.test.js` | PASS | PASS | PASS | llm: 83/83 |
| `llmqueue.test.js` | PASS | PASS | PASS | llmqueue: 20/20 |
| `lockclient.test.js` | PASS | PASS | PASS | lockclient: 21/21 |
| `memory.test.js` | FAIL | FAIL | PASS | memory: migration, validation, persistence, search, clear, delete and undo passed |
| `mirror.test.js` | PASS | PASS | PASS | mirror: 45/45 |
| `nearby.test.js` | PASS | PASS | PASS | nearby: 73/73 |
| `netsafe.test.js` | PASS | PASS | PASS | netsafe: 82/82 |
| `nlu.test.js` | FAIL | FAIL | PASS | 338/338 passed |
| `nluq.test.js` | FAIL | FAIL | PASS | nluq: 34/34 |
| `nodecheck.test.js` | PASS | PASS | PASS | nodecheck: 23/23 |
| `ocr.test.js` | PASS | PASS | PASS | ocr: 27/27 |
| `offline-fallbacks.test.js` | PASS | PASS | PASS | offline-fallbacks: 18/18 |
| `palette.test.js` | PASS | PASS | PASS | 24/24 palette checks passed |
| `paraphrase.test.js` | PASS | PASS | PASS | paraphrase: 258/266 correct (97%) · 8 to AI planner · 0 to chat · 0 confident-wrong · chat-only: 8/8 left with chat |
| `pdftools.test.js` | PASS | PASS | PASS | pdftools: 77/77 |
| `phase2-recovery.test.js` | PASS | PASS | PASS | phase2-recovery: stale checkpoint, private argument filtering and idempotence passed |
| `phoneauth.test.js` | PASS | PASS | PASS | phoneauth: 15/15 |
| `phonecmd.test.js` | PASS | PASS | PASS | phonecmd: 19/19 |
| `phonehub-android.test.js` | FAIL | FAIL | PASS | phonehub-android source checks: 22/22 |
| `phonehub-auth.test.js` | FAIL | FAIL | PASS | phonehub-auth: 35/35 |
| `phonehub-cert.test.js` | PASS | PASS | PASS | phonehub-cert: private address validation and safe onboarding guardrails defined |
| `phonehub-gateway.test.js` | FAIL | FAIL | PASS | phonehub-gateway: 26 checks passed |
| `phonehub-notifications.test.js` | FAIL | FAIL | PASS | phonehub-notifications: bounded queue and scheduler integration cases defined |
| `photocare.test.js` | PASS | PASS | PASS | photocare: 48/48 |
| `plan.test.js` | PASS | PASS | PASS | plan: 54/54 |
| `portwatch.test.js` | PASS | PASS | PASS | portwatch: 18/18 |
| `projectwiki.test.js` | PASS | PASS | PASS | projectwiki: 82/82 |
| `rag.test.js` | PASS | PASS | PASS | rag: 38/38 |
| `regen.test.js` | PASS | PASS | PASS | regen: 23/23 |
| `reliability.test.js` | PASS | PASS | PASS | reliability: 111/111 |
| `research-modes.test.js` | FAIL | FAIL | PASS | 5/5 research mode checks passed |
| `routines.test.js` | FAIL | FAIL | PASS | routines: 30/30 |
| `safewrite.test.js` | PASS | PASS | PASS | safewrite: 8/8 |
| `saved-vision.test.js` | PASS | PASS | PASS | PASS saved-vision.test.js — 2/2 |
| `scan.test.js` | PASS | PASS | PASS | scan: 47/47 |
| `scanmath.test.js` | PASS | PASS | PASS | scanmath: 55/55 |
| `scheduler.test.js` | PASS | PASS | PASS | scheduler: 21/21 |
| `services-page.test.js` | PASS | PASS | PASS | PASS services-page.test.js — 8/8 |
| `shotindex.test.js` | PASS | PASS | PASS | shotindex: 46/46 |
| `skill-hub-quality.test.js` | PASS | PASS | PASS | skill-hub-quality: 14/14 |
| `skill-hub-ui.test.js` | PASS | PASS | PASS | skill-hub-ui: 25/25 |
| `skillpack.test.js` | FAIL | FAIL | PASS | skillpack: 64/64 |
| `skillrouter.test.js` | FAIL | FAIL | PASS | skillrouter: 54/54 |
| `skills-page.test.js` | PASS | PASS | PASS | skills-page: 79/79 |
| `skills.test.js` | PASS | PASS | PASS | skills: 52/52 |
| `speechstream.test.js` | PASS | PASS | PASS | speechstream: 174/174 |
| `statemerge.test.js` | PASS | PASS | PASS | statemerge: 30/30 |
| `statesync.test.js` | PASS | PASS | PASS | statesync: 20/20 |
| `stt-page.test.js` | PASS | PASS | PASS | stt-page: 17/17 |
| `student-page.test.js` | PASS | PASS | PASS | student-page: 310/310 |
| `student.test.js` | PASS | PASS | PASS | 60/60 — all passed |
| `study.test.js` | PASS | PASS | PASS | study: 50/50 |
| `studyplus.test.js` | PASS | PASS | PASS | studyplus: 43/43 |
| `studyserver.test.js` | PASS | PASS | PASS | studyserver: 31/31 |
| `sw.test.js` | FAIL | FAIL | PASS | sw: 11/11 |
| `tendercount.test.js` | PASS | PASS | PASS | tendercount: 6/6 |
| `tenderparse.test.js` | PASS | PASS | PASS | tenderparse: 75/75 |
| `tenders-page.test.js` | PASS | PASS | PASS | tenders-page: 35/35 |
| `thresholds.test.js` | PASS | PASS | PASS | thresholds: 56/56 |
| `toolregistry.test.js` | PASS | PASS | PASS | toolregistry: 29/29 |
| `toolresults.test.js` | PASS | PASS | PASS | toolresults: 37/37 |
| `transitions.test.js` | PASS | PASS | PASS | transitions: 18/18 |
| `trashkeep.test.js` | PASS | PASS | PASS | trashkeep: 19/19 |
| `triggers.test.js` | PASS | PASS | PASS | triggers: 35/35 |
| `ttparse.test.js` | PASS | PASS | PASS | ttparse: 43/43 |
| `tts.test.js` | PASS | PASS | PASS | tts: 21/21 |
| `undo.test.js` | PASS | PASS | PASS | undo: 34/34 |
| `undolog.test.js` | PASS | PASS | PASS | undolog: 16/16 |
| `update.test.js` | PASS | PASS | PASS | 14/14 update checks passed |
| `voice.test.js` | PASS | PASS | PASS | voice: 33/33 |
| `wakeword.test.js` | PASS | PASS | PASS | wakeword: 46/46 |
| `watchdog.test.js` | PASS | PASS | PASS | watchdog: 82/82 |
| `websearch.test.js` | PASS | PASS | PASS | websearch: 11/11 |
| `whisper.test.js` | PASS | PASS | PASS | whisper: 36/36 |
| `workflow-memory.test.js` | PASS | PASS | PASS | workflow-memory: 10/10 |
| `live.test.js` | NOT RUN | NOT RUN | NOT RUN | Opt-in physical laptop checks |

Five file-symlink cases in the API suite were blocked by Windows privileges. The POSIX file mode case was inapplicable on Windows. Android tests here are source checks; no APK or phone execution was performed.
