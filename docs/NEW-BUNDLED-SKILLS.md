# New bundled JARVIS skills

These skills are discovered by the existing `skillpack.js` loader from `skills-bundled/<name>/SKILL.md`. No new runtime dependency is required. After updating an existing JARVIS instance, use the existing **reload skills** command or restart JARVIS so the bundled catalogue is rescanned.

## Added skills

| Skill | Purpose | Example request |
|---|---|---|
| `debugging-coach` | Evidence-led diagnosis, minimal fixes, and regression-test ideas | “Use the debugging coach to diagnose this stack trace” |
| `study-sprint` | Realistic time-boxed revision with active recall and breaks | “Make a 90-minute study sprint for binary trees” |
| `meeting-notes` | Decisions, action items, owners, dates, and open questions from supplied notes | “Extract action items from these meeting notes” |
| `career-helper` | Evidence-based resume bullets, interview practice, and application planning | “Improve these project bullets without inventing metrics” |

## Safety and reliability

- Skill files are prompt instructions only; they do not execute scripts or grant new operating-system permissions.
- The skills explicitly prohibit inventing test results, source evidence, credentials, owners, dates, or achievements.
- Existing server-side tool permissions and approval checks remain authoritative.
- The skills are suggestions for the assistant's reasoning, not proof that an action or external operation happened.

## Manual verification (not run as part of this change)

1. Start JARVIS and request the skill list / reload skills.
2. Confirm the four names appear in `GET /api/skills`.
3. Run each skill with a small, safe example and confirm the output follows its stated structure.
4. Restart JARVIS and confirm the bundled skills remain discoverable.
5. Run `npm test` locally to execute the existing automated suite.
