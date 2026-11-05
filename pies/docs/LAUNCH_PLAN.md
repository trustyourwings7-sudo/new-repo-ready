# PIES launch plan: Supabase Free setup + one-search / one-extraction live validation

Status: **plan only. Nothing here has been executed.** Every step is the owner's, and each step marked 🔒
needs explicit authorization. Nothing below buys anything, schedules anything or deploys anything publicly.

## Phase A — Supabase Free, minimal and safe (no live API calls)

| # | Step | Check before moving on |
|---|---|---|
| A1 | Create a **Free** Supabase project (no card). Enable 2FA on the account. | Plan shows "Free"; Billing has no payment method |
| A2 | Auth: sign-ups **off**, email only, add your owner user, redirect URL = `http://localhost:3000/auth/callback` only (no public hosting yet) | Sign-up toggle off |
| A3 | SQL editor: run `supabase/migrations/*.sql` in filename order (5 files) | No errors |
| A4 | Run `supabase/verify/production_checks.sql` | **Every row `ok = true`**, otherwise stop and report |
| A5 | Locally: `cp .env.example .env.local`, set the Supabase URL + **anon** key + `PIES_ALLOWED_EMAILS`; `pnpm build && pnpm start`; sign in; Settings → Load initialization context | Profile, preferences (paid **off**) and 6 projects exist |
| A6 | Run `docs/SUPABASE_INTEGRATION_TEST_PLAN.md` T1–T8 against the project | All pass; this is the first evidence on real Supabase |
| A7 | `alter role pies_automation login password '<openssl rand -hex 24>'`; insert one `automation_integrations` row (`name 'pies-research-runner'`, `allowed_agents '{discovery}'`) | Pooler URL connects **as `pies_automation`** and `select 1 from public.opportunities` is **denied** |

Never copy the service-role key anywhere. PIES never uses it.

## Phase B — accounts and limits (still no calls)

| # | Step |
|---|---|
| B1 | Exa and Firecrawl: confirm **Free plan, no card, no auto top-up**. This is the only hard money limit (the PIES governor limits PIES's own calls, not provider billing). |
| B2 | Open both official pricing pages, compare with `src/lib/research/pricing.ts` and docs/RUNNER.md. If anything differs, stop: update the code and tests first. Note the date. |
| B3 | Validation-sized caps in SQL (owner user id): |

```sql
insert into public.provider_configs (user_id, provider, category, enabled, pricing_verified,
       pricing_source_url, pricing_verified_at, monthly_cap_usd)
values ('<owner>', 'exa',       'search', true, true, 'https://exa.ai/docs/admin/pricing',     now(), 0.05),
       ('<owner>', 'firecrawl', 'search', true, true, 'https://docs.firecrawl.dev/billing',    now(), 0.05);
-- paid stays OFF until C2.
```

## Phase C — one live validation run 🔒 (needs your explicit go-ahead)

Run locally (not in Actions, so nothing reaches a public log):

| # | Step |
|---|---|
| C1 | Create `pies/config.json` (git-ignored) from `config.example.json` with **one** query, `"numResults": 3`, `"caps": {"searches": 1, "extractions": 1}`, and `officialDomains` for the institutions you expect. |
| C2 | 🔒 `update public.user_preferences set paid_operations_enabled = true where user_id = '<owner>';` |
| C3 | 🔒 Run once: |

```bash
cd pies
PIES_PIPELINE_CONFIG=config.json PIES_REPORT_PATH=validation.report.md \
PIES_LIVE_RESEARCH=1 PIES_PRICES_CONFIRMED_ON=<B2 date> \
PIES_AUTOMATION_DATABASE_URL='<pooler url as pies_automation>' \
PIES_AUTOMATION_INTEGRATION_ID=<A7 id> PIES_OWNER_USER_ID=<owner> \
EXA_API_KEY=<key> FIRECRAWL_API_KEY=<key> pnpm research
```

| C4 | Immediately: `update public.user_preferences set paid_operations_enabled = false where user_id = '<owner>';` |

**Maximum exposure for C3:** PIES reserves $0.0125 (Exa) + $0.02425 (Firecrawl) and refuses anything past
1 search and 1 scrape. Expected provider usage: 1 Exa search with ≤3 content pages (≈ $0.010 of free credits)
and 1 Firecrawl credit. Both come out of free allowances if B1 holds.

### Pass criteria (all must hold)
1. Runner exit 0 and printed `outcome` is not `blocked`.
2. `usage_records`: exactly 2 rows, both `committed`, none `reserved`; `overrun = false`.
3. Recorded Exa cost equals Exa's `costDollars` (compare with the Exa dashboard usage); recorded Firecrawl
   credits equal the dashboard's credit delta (expected 1).
4. `agent_runs`: 1 row `succeeded`; `opportunity_sources.source_type` matches the page's real publisher.
5. The review task text starts with "REVIEW ONLY"; any draft is unsent text; no email left your account.
6. `validation.report.md` and the terminal contain no key or password.

### If anything fails
Leave paid operations off (C4), keep the report locally, and send me the runner's JSON line plus the
`usage_records` rows. No retry until the cause is understood.

## Phase D — only after C passes 🔒
1. GitHub: create environment `pies-production` with yourself as required reviewer; add the secrets listed in
   docs/RUNNER.md; run the workflow **by hand** once with the same caps.
2. Raise caps gradually (e.g. Exa $1.50, Firecrawl $0.50 per month) only after reviewing a week of reports.
3. Scheduling (`schedule:` in `.github/workflows/pies-research.yml`) is a separate decision.

## Rollback at any point
`paid_operations_enabled = false` (governor denies before any call) · `alter role pies_automation nologin;` ·
`update public.automation_integrations set enabled = false;` · revoke the provider keys in their dashboards.
