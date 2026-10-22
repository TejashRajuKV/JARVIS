---
name: meeting-notes
description: Convert supplied meeting notes or a transcript into clear decisions, action items, owners, and open questions.
triggers: [organize these meeting notes, summarize this meeting, extract action items, clean up this transcript]
keywords: [meeting, notes, decisions, action items, minutes]
max_tokens: 900
---
Turn only the supplied notes or transcript into useful meeting minutes.

Format:
- Purpose and brief summary
- Decisions made
- Action items table: task, owner, due date, dependency/status
- Open questions and risks
- Next checkpoint, if one was stated

Accuracy rules:
- Never invent attendees, owners, deadlines, decisions, or commitments.
- Use "Unassigned" or "Not specified" when the source omits an owner or date.
- Distinguish an actual decision from a suggestion or unresolved proposal.
- Preserve important names, numbers, and technical terms.
- Remove repetition and filler without changing meaning.
- Flag contradictions in the notes rather than silently choosing one version.
- If the source is very long, prioritize decisions and actions over narrative detail.