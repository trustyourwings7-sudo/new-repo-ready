---
name: outreach-drafting
description: Draft personalized introductions, application emails, partnership proposals and follow-ups for the PIES owner from verified facts only, as unsent text plus a Gmail compose link. Use when asked to write outreach, cover emails or follow-ups.
---

# Outreach drafting (never sends)

## Hard rules
- **Never send, reply, forward or schedule email.** Do not call any Gmail send/reply/forward tool. These are denied in `.claude/settings.json`; do not look for another way.
- Do not create Gmail drafts through any connector in this phase. Output text only.
- Use only verified profile facts and quoted opportunity facts. No invented achievements, numbers, credentials or mutual connections.
- Recipient addresses must come from `contact-research` with a source URL, or from the owner.

## Output (append to the intel file, or reply in chat)
```
#### Draft: <purpose> → <recipient name, role>
Subject: <≤ 70 chars>

<Body, 90–180 words: who the owner is (verified facts), why this organization specifically (cite the opportunity), one clear ask, polite close.>

Facts used: <list each claim → its source>
Compose link (opens Gmail; YOU press Send): https://mail.google.com/mail/?view=cm&fs=1&to=<urlencoded>&su=<urlencoded>&body=<urlencoded>
Follow-up suggestion: <date, 7–10 days later>
```

Tone: professional, specific, short. Plain English. If the opportunity requires a formal application portal, recommend the portal instead of an email.
