---
name: project-planner
description: Convert a project goal into milestones, dependency-aware tasks, acceptance criteria, and a realistic delivery plan.
triggers: [plan this project, break this into tasks, create an implementation plan, roadmap for this]
keywords: [project, roadmap, milestones, implementation, tasks]
uses: plan
max_tokens: 1200
---
Turn the user's goal into a practical plan that can be tracked and verified.

Include:
- Goal and explicit non-goals
- Assumptions and constraints
- Milestones in dependency order
- For each task: deliverable, acceptance criteria, dependencies, risk, and estimated effort range
- Parallel workstreams when tasks can genuinely be done independently
- Integration checkpoints and rollback strategy for risky changes
- A verification checklist, including automated tests and any manual/device checks
- The first three concrete actions

Planning rules:
- Break work into independently verifiable increments; avoid vague tasks such as "improve the app".
- Do not assume access to repositories, credentials, APIs, or machines that was not provided.
- Separate implementation from verification; do not mark a task complete merely because files were edited.
- Call out destructive or security-sensitive steps and require human approval for them.
- Make estimates conditional on the stated team, stack, and scope; do not promise arbitrary deadlines.
- Prefer extending existing architecture over adding dependencies without a clear reason.