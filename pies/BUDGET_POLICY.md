# Budget Policy

**Hard limit: USD 10.00 incremental spend per calendar month (UTC).** It is a ceiling, not a target.

| Category | Default limit | Covers |
|---|---|---|
| ai | $5.00 | LLM API calls |
| search | $2.00 | Search APIs |
| infra | $3.00 | Hosting, domains, contingency |

The sum of category limits can never exceed $10 (`set_category_limit` refuses). `user_preferences.monthly_budget_usd` can only lower the total, and a check constraint keeps it at $10 or below.

## Enforcement (tested locally)

1. **Kill switch:** `paid_operations_enabled` defaults to `false`.
2. **Provider gate:** a provider must be enabled **and** pricing-verified with a source URL and date. Unknown pricing means blocked.
3. **Reserve → execute → commit/release:** `reserve_budget` checks the total, category and optional provider cap against committed spend plus live reservations, under a per-user lock.
   - Parallel test: 20 simultaneous $0.40 requests against $5.00 → exactly 12 accepted ($4.80).
4. **Who can reserve:** only the `pies_automation` role, i.e. the PIES server. Browser sessions and n8n cannot call the governor, so they cannot under-report cost.
5. **Estimates are upper bounds** (×1.25, rounded up). Actual cost is always committed, even when over the estimate (flagged as an overrun). Reservations expire after 1 hour.
6. **Idempotency keys** stop double reservation and double billing.
7. **Fail closed:** if the governor is unreachable, the paid call does not happen.
8. **No purchases:** no code path buys credits or upgrades plans; those actions are human-only.

## Where the governor cannot reach (and the mitigation)

| Bypass path | Mitigation |
|---|---|
| n8n built-in "gateway credits" for AI/search nodes (OpenAI, Anthropic, Gemini, Brave, Firecrawl…) were found on your instance during this audit | These nodes are banned by `auditN8nWorkflow()`. Every workflow must pass it before publishing. Check whether your n8n plan charges for these credits beyond the included amount. |
| Someone pastes an API key into an n8n credential or Code node | The auditor rejects any credential and any Code-node network call. Provider keys live only on the PIES server. |
| A provider bills more than PIES recorded (pricing change, bug) | Set provider-side hard limits and turn auto-recharge off (DEPLOYMENT.md §4). These are the outer wall. |

## Cost audit (2026-11-05)

**Dependencies:** all 8 runtime packages are open source with no cost: `next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `postgres` (Unlicense), `zod`, `server-only`. Transitive licences are MIT, Apache-2.0, ISC, BSD, 0BSD and CC-BY-4.0, plus LGPL-3.0 for `sharp`'s libvips image binary (Next.js image optimizer; used unmodified, no cost). **Package cost: $0.** [Certain]

**Outbound services referenced in code:** only Supabase, and `googleapis.com` in the Gmail stub, which is not called. [Certain]

| Service | Incremental cost | Confidence |
|---|---|---|
| Supabase Free (DB, Auth, pooler) | $0 | [Likely] Free projects pause after about a week idle; 500 MB DB limit. |
| GitHub Free | $0 | [Certain] |
| n8n Cloud | $0 incremental (existing plan): 0 workflows, 0 credentials on 2026-11-05 | [Certain] state; [Guessing] whether gateway credits ever bill |
| Hosting | $0 (local) to $0 (free tiers); not chosen | [Likely] |
| Google Cloud OAuth client (Phase 3) | $0 if kept in Testing; restricted-scope verification for a published app can require a paid assessment, so do not publish | [Likely] |
| AI API (Phase 2) | $0 until enabled; planned ≤ $5 | Prices unverified, so blocked |
| Search API (Phase 2) | $0 until enabled; planned ≤ $2 | Prices unverified, so blocked |
| **Current total** | **$0.00 / month** | Nothing paid is enabled |
| **Phase 2 projection** | $0.50–$5 / month | [Guessing] until prices are verified |

## Existing subscriptions (not incremental)
n8n Cloud and Claude Code/Desktop are your existing plans. PIES does not call Claude Code at runtime.
