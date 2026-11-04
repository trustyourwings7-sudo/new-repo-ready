---
name: budget-guard
description: Check any proposed paid service, API, plan, dependency or integration against the PIES USD 10/month incremental budget before it is enabled - verify pricing from the official page, project monthly cost, and block anything uncertain. Use before adding a provider, MCP server, SaaS, API key or upgrade.
---

# Budget guard

The hard cap is **USD 10.00/month incremental**: AI ≤ $5, search ≤ $2, infra and contingency ≤ $3. Existing subscriptions (n8n Cloud, Claude) are not counted, but they are tracked.

## Procedure
1. **Identify** the service, plan, billing model (subscription, credits or pay-as-you-go) and whether a card is required.
2. **Verify** price on the provider's official pricing page. Record the URL and the retrieval date. Third-party blogs are only leads. If the official page cannot be read, the price is **unverified**.
3. **Project** usage: requests per day × price × 30, plus a 25 % safety margin. Compare it with the category cap minus spend already committed (`BUDGET_POLICY.md`).
4. **Check traps:**
   - auto-recharge or top-up
   - free tier that converts to paid
   - overage billing
   - per-seat pricing
   - credits that expire
   - restricted-scope verification fees (Google)
   - n8n gateway credits
5. **Decide:**
   - `APPROVED-FREE`: $0, no card, hard limit exists.
   - `NEEDS-OWNER-APPROVAL`: any possible charge. Show the monthly worst case.
   - `BLOCKED`: price unverified, no hard limit, or the projection exceeds the cap.

Never sign up, enter payment details, buy credits or upgrade a plan. Those are human-only actions in `src/lib/permissions/catalog.ts`.

## Output
```
Service: <name/plan> · Decision: APPROVED-FREE | NEEDS-OWNER-APPROVAL | BLOCKED
Price: <exact> (official: <url>, YYYY-MM-DD) [Certain|Likely|Guessing]
Projected: $X.XX/month worst case · Category: ai|search|infra · Headroom after: $Y.YY
Traps found: ...
Required owner steps: ...
```
