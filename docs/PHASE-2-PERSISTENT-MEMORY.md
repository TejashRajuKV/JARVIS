# Phase 2 — Persistent memory and task recovery

JARVIS already has a local shared state file, bounded personal memory, agent run history, explicit workflow notes, and backup snapshots. This phase strengthens those stores instead of creating a competing database.

## Changes
- Persist agent task checkpoints with a schema version and a fresh checkpoint timestamp whenever the existing agent executor records a run.
- Normalize task-step fields and bound list sizes when a checkpoint is saved.
- Add a read-only recovery summary with task identity, saved goal, explicit interrupted/running/partial/failed/completed status, and per-step results.
- Make personal-memory search and clear operations explicit and bounded.
- Clear personal memory only, keep task/chat/settings untouched, and preserve the existing undo path.

## Recovery safety
A checkpoint is a record of what JARVIS knows happened, not permission to repeat it. Recovery summaries are read-only; remaining work must be planned again through the normal permission and verification pipeline. Verified and unverified outcomes remain separate so a command that was sent but not checkable is not described as verified.

## Privacy
Data remains in the existing local shared state store. This patch introduces no cloud memory, no cross-user context sharing, and no permanent mood profile.

## Validation
Regression tests were added but deliberately not run. Manually run `node tests/memory.test.js` and `node tests/phase2-recovery.test.js` from the repository root.
