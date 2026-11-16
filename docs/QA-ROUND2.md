# JARVIS QA Round 2

The pending wake-word, command, workspace and integration changes were committed on `codex/jarvis-qa-audit` in `18a38b4`, `8d097f4` and `c7ca349`. The follow-up implementation and test changes are in `78b5d35`, `0a5e9c8`, `ff01984` and `0bbb8d6`.

## Clean-checkout result

A detached worktree at `0bbb8d6` ran `npm ci` and `JARVIS_REQUIRE_ALL=1 npm test` on Windows with Node 24.16.0. The test command exited 0 and reported **All 123 suites passed**. The checkout was clean before and after the run.

The API suite passed 427/427, the main browser suite 452/452, connected services 14/14 and the positive-route suite 18/18. The API gate called 232 of 274 registered routes and lists reasons for the other 42. The individual Windows symlink checks without local privileges and the POSIX mode assertion were skipped. The live hardware suite is opt-in.

## Product and coverage changes

- Commerce now mounts one comparison handler. The module implementation validates provider selections, provides search links when listings are missing, and uses an explicit provider-domain list. It preserves the shopping aliases, provider IDs, route details and comparison fields used by the existing callers. A lowest observed price requires evidence from two providers. Checkout prices remain unverified.
- Home Assistant status makes an authenticated read-only request to the configured service. It reports a saved configuration separately from a successful connection. The fixture covers HTTP 401, HTTP 503, recovery and disconnect. Settings displays connection state and chat skips unavailable integrations.
- The new HTTP suite covers all 14 previously unexplained routes. It checks the configured calling status and Twilio form with a fake provider, local pairing and device lifecycle in disposable state, commerce results across two fake providers, exact screenshot and room-image bytes, and saved-image inference with a fake model. The route inventory identifies the 14 rows. [Route inventory](QA-ROUTES.md)
- The existing Windows workflow runs `npm ci` and `npm test` on Node 22 and 24. Its PowerShell step clears `JARVIS_REQUIRE_ALL` so a missing browser can be reported as NOT RUN. The README records port 3002, environment defaults, 123 automated suites, 274 registered API routes and 186 rule intents.

## Assertion review

Compared with the pre-audit commit `efe3556`. This table records the files specifically named for review and the additional checkpoint and browser checks that affect their results.

| Suite | What the assertions now establish |
|---|---|
| `nlu` | The earlier replacement of `OPEN_SITE` with `OPEN_APPLICATION` covered classification but lost the app-versus-website distinction for several commands. Restored it by asserting the exact app key or URL passed to the tool for six inputs. This caught and fixed “open WhatsApp Web” launching the desktop app. The contextual replay and destructive replay rejection remain covered. |
| `nluq` | The earlier declaration move fixes a reference error. The existing normalization, rejection and timeout assertions still run. |
| `routines`, browser self-test | Queue records are checked for ID, order, deduplication and scheduled status. The record type changed from an ID to an object. The execution checks remain in place. |
| `memory` | Search is asserted before eviction and again after the cap is reached. The cap, persistence, deduplication, deletion and undo checks remain in place. |
| `phonehub-android` | The three corrected regexes test the same source conditions. This remains a source inspection suite. |
| `phonehub-auth` | The owner-only POSIX mode check still runs on supported systems and explicitly skips Windows. The device access, replay, revocation and storage checks still run on Windows. Windows ACL behavior remains unverified. |
| `phonehub-cert` | Replaced source matches with CLI execution using a fake OpenSSL process. The test reads the generated SAN and server usage, checks the signing command and installer directions, and verifies existing key bytes survive a rejected overwrite. |
| `phonehub-gateway` | Voice and call capability checks exercise actual handler requests and responses. The tests check default rejection, independent grants, exact sanitized text and provider error statuses. |
| `phonehub-notifications` | The new expectation checks both queue items in order after unsubscribe. Calls, bounds, sanitization and expiry remain covered. |
| `skillpack` | The bundled list still requires an exact match, with 13 current names. Required metadata and loader rejection checks remain in place. |
| `skillrouter` | The expanded catalog still checks the longer research-brief trigger. Its addition replaced the original research fixture, so the earlier research behavior now has separate explicit and buried-trigger checks. |
| `calling-service` | Parses the form using its actual encoding and compares both numbers and the full escaped TwiML. Existing provider, opt-in, timing and rate-limit checks remain in place. |
| `sw` | Retains shell and ordinary navigation checks, and adds mixed-case, encoded and bare API exclusion plus purge checks. The Skill Hub test reads the declared cache version. |
| `phase2-recovery` | The earlier behavioral test seeded its schema version, so it could miss a regression in the writer. An executor test now asserts the persisted schema version and the active-run accessor alongside interruption behavior and redaction. |

Other audit test changes add assertions for receipt merging and syncing, research citation attribution, process verification and the workspace and voice integrations. The API gate uses mounted handlers, retains exemptions and refuses unexpected coverage gaps. The test runner and report preserve failures and identify whole-suite skips.

## Mutation checks

Each experiment used a temporary source copy. The original passed, one code change caused an assertion failure with exit 1, and restoring the original bytes returned exit 0.

| Suite | Mutation caught | Restored assertions |
|---|---|---:|
| `calling-service` | Bypassed TwiML escaping in the outgoing request | 23/23 |
| `phonehub-cert` | Generated client certificate usage in place of server usage | 20/20 |
| `phonehub-notifications` | Removed newest-first reversal | 16/16 |
| `phase2-recovery` | Wrote schema version 0 | 15/15 |
| `memory` | Removed the duplicate-note rejection | 29/29 |

## Remaining verification

The manual items from Round 1 still apply, including microphone and wake word, Windows Hello and ACLs, physical laptop controls, Android and Tailscale, live Twilio and ntfy, real Home Assistant and calendars, model behavior and checkout prices. Certificate wiring was tested with a fake OpenSSL process. The GitHub Actions workflow has local test evidence only. [Manual verification checklist](QA-AUDIT.md#manual-verification-checklist)

`npm audit` reported two high-severity dependency findings involving the installed `body-parser` and `systeminformation` versions. Dependency upgrades were outside Round 2. No product decision was needed for the commerce contract or the read-only Home Assistant status probe.
