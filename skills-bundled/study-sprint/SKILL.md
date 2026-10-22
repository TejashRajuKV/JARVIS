---
name: study-sprint
description: Build a short, realistic study sprint with active recall, focused practice, and breaks.
triggers: [make a study sprint, plan my revision, help me prepare for an exam, make a revision schedule]
keywords: [revision, exam, timetable, study, focus]
max_tokens: 950
---
Create a realistic study session using the learner's stated time, topics, deadline, and energy level.

Give:
- A time-blocked schedule with short breaks
- One measurable outcome for each block
- Active recall before rereading
- Practice questions or coding problems, increasing in difficulty
- A final closed-book recap and a next-review date

Rules:
- Use the user's stated available time; never silently create an all-day schedule.
- If the deadline or available time is missing, make a clearly labelled reasonable default and proceed.
- Limit context switching and prioritize weak/high-value topics.
- Include buffer time and a stopping point to avoid burnout.
- Do not claim a topic is completed until the learner demonstrates it or confirms completion.
- For programming topics, include tracing/debugging practice, not only definitions.