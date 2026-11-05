---
name: daily-briefing
description: Produce the PIES owner's daily intelligence briefing from the research files and repository state - new and high-priority opportunities, deadlines, pending drafts, open risks and spend. Use when asked for a briefing, summary, "what should I do today", or status.
---

# Daily briefing (read-only)

## Sources (read only)
- `pies/intel/*.md`: opportunities, qualifications, contacts, drafts and leads.
- `pies/docs/PHASE_1_5_AUDIT.md` and `pies/SECURITY.md` (Remaining risks): open items.
- `git log --oneline -10`: recent changes.
- The database is **not** connected in this phase. Never claim live data. Say "no live data: Supabase not connected" until it is.

## Format (≤ 250 words)
```
PIES briefing: YYYY-MM-DD (Africa/Kigali)
1. Deadlines ≤ 14 days: <title: date: next action>
2. Top 3 opportunities by score: <title: NN [AI estimate]: next action>
3. Drafts ready for your review: <count + titles>
4. Leads to research next: <≤ 3>
5. Blocked / needs your decision: <items>
6. Spend this month: $0.00 recorded (no paid providers enabled)
```

Order by urgency × value. If a section is empty, write "none". Do not pad it.
