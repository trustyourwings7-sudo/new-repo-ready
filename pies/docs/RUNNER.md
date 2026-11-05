# PIES research runner (n8n replacement)

Status 2026-11-05: **built and tested locally; not activated.** n8n Cloud is retired as a PIES dependency.

## Architecture

```
GitHub Actions (manual today; cron after owner approval)
  └─ node scripts/run-pipeline.ts            Node 22, no framework, no Claude dependency
       ├─ Exa /search          (discover)    ┐ every call: per-run cap → pacing →
       ├─ Firecrawl /v2/scrape (extract)     ┘ reserve_budget → call → commit/release
       ├─ robots.txt check before every extraction (5xx/unreachable = skip)
       ├─ deterministic verify / qualify (rubric v1) / prioritize / contacts / draft   ($0, no model)
       └─ Postgres as role pies_automation  → automation_execute(...)  (same boundary n8n used)
            run.start → opportunity.upsert → source.add → task.create (review + draft) → run.finish
```

Why this shape:
- **Same security boundary as before.** `pies_automation` can execute four functions and read no table. Automation still cannot set scores, eligibility or status, send email, or approve anything. The runner adds no grants and no migration.
- **One budget counter.** Every paid call is reserved in the database governor first (atomic, advisory-locked, monthly and category caps, per-provider caps, `paid_operations_enabled`, `pricing_verified`). Same-day retries reuse budget idempotency keys and never re-spend; automation request ids are unique per invocation so a retry opens a fresh run.
- **No model in the loop.** Verification, scoring and drafts are deterministic, so page text can never act as instructions. Pages with instruction-like text are flagged, their titles withheld, and their contacts never used as draft recipients.

### Scheduler decision
| Option | Verdict | Evidence |
|---|---|---|
| **GitHub Actions (public repo)** | **Chosen** | Plain Node, existing `postgres` driver works unchanged, no CPU cap that matters. Risks: cron runs can be delayed; scheduled workflows in a public repo are **disabled after 60 days without repository activity** ([GitHub docs](https://docs.github.com/actions/managing-workflow-runs/disabling-and-enabling-a-workflow)) |
| Cloudflare Workers Free + Cron | Rejected for now | **10 ms CPU per cron run**, 50 external subrequests, 5 cron triggers per account ([limits](https://developers.cloudflare.com/workers/platform/limits/)). Markdown parsing of 10 pages risks the CPU cap, and Postgres needs a socket shim. Revisit only if Actions becomes unreliable. The pipeline code is runtime-agnostic (`fetch` only), except the Postgres sink. |
| n8n Cloud | Retired | Trial expired; renewal not authorized. Workflows/data in the n8n account are untouched. |

## What it costs, and what the internal cap does NOT guarantee

**Two different things limit spend. Only one of them is in PIES.**

| Layer | What it limits | Where it lives |
|---|---|---|
| PIES governor (internal) | Whether PIES *starts* another call. Reserves before each call, records the cost after. Caps: $10 total, $2 search category, optional per-provider caps | Supabase (`reserve_budget`, `commit_usage`) |
| Provider account (external) | What the provider can actually *bill* | Exa and Firecrawl dashboards; your payment method |

The internal cap **cannot** stop a provider from billing. A single call can cost more than reserved
(`commit_usage` records it with `overrun = true`), and a request PIES abandoned may still have been
processed. The only hard money limit is on the provider side: Firecrawl's free plan stops with HTTP 402
at its allowance; Exa bills a card on file once free credits are used. **Keep both accounts on free plans
with no card and no auto top-up** while the internal cap is the plan of record.

### Billing semantics used for accounting (official docs, 2026-11-05)

| Event | Exa `/search` (type auto) | Firecrawl `/v2/scrape` | PIES records |
|---|---|---|---|
| Success | $7/1k requests **+ $1/1k content pages** (text for N results = N pages) ([pricing](https://exa.ai/docs/admin/pricing)) | 1 credit per returned document; cached still 1; proxy escalation 0 extra ([billing](https://docs.firecrawl.dev/billing)) | provider's reported figure if present and sane (`costDollars`, `creditsUsed`); else list price for what came back |
| PDF | n/a | **+1 credit per PDF page** (unbounded) | refused before the call (URL check) and `parsers: []` sent |
| No document returned | n/a | 0 credits | $0 |
| 400/401/402/403/429 | treated as not billed | treated as not billed | reservation released |
| Timeout, 5xx, unparseable 200 | **undocumented** | **undocumented** | **charged at list price** (assume billed) |
| Retry | each attempt billed | each attempt billed | paid calls retry **only 429**; never after a timeout/5xx |
| Reported cost > 3× reservation | — | — | committed as reported, then the run **stops** (`UnexpectedCost`) |

Reservations: Exa = (0.007 + 10 × 0.001) × 1.25 = **$0.02125** per search; Firecrawl = 2 credits × $0.0097
shadow price × 1.25 = **$0.02425** per scrape. A default run (3 searches, 10 scrapes) reserves up to $0.31 and
records about $0.15 at list prices (3 × $0.017 + 10 × $0.0097). The $2 search allocation therefore covers
roughly 13 such runs a month before PIES stops itself. The $10 total and $2 search ceilings are unchanged
(`pies_hard_monthly_cap_usd()`, `budgets`, verified by the SQL tests).

**Confidence:** prices [Likely] (official pages read through search; the build container cannot open them).
Billing of failed requests [Guessing] — hence the conservative "assume billed" rule.

## Owner setup (each step is yours; nothing here was done for you)
1. **Supabase**: create the Free project, apply `supabase/migrations/*` in order, run `supabase/verify/production_checks.sql` (all rows `ok = true`), sign in once (seeds projects), then follow DEPLOYMENT.md to give `pies_automation` a login password and create one `automation_integrations` row with `allowed_agents = '{discovery}'`.
2. **Providers**: in Supabase, insert `provider_configs` rows for `exa` and `firecrawl` (category `search`, `enabled`, `pricing_verified` with the pricing URL you checked, `monthly_cap_usd` e.g. 1.50 / 0.50), then set `user_preferences.paid_operations_enabled = true`.
3. **Accounts**: confirm Exa and Firecrawl are on free plans with **no card and no auto top-up**. This, not the PIES governor, is the hard money limit.
4. **GitHub**: Settings → Environments → create `pies-production` (add yourself as required reviewer to approve every run). Add secrets: `PIES_PIPELINE_CONFIG_JSON` (profile + queries; see `config.example.json`; it contains personal data and must never be committed), `PIES_AUTOMATION_DATABASE_URL`, `PIES_AUTOMATION_INTEGRATION_ID`, `PIES_OWNER_USER_ID`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `PIES_PRICES_CONFIRMED_ON` (date you checked the pricing pages), `PIES_LIVE_RESEARCH=1`.
5. Run **PIES research run** by hand once; read the report task in PIES. Only then consider uncommenting `schedule`.

## Rollback and recovery
- Stop everything instantly: set `paid_operations_enabled = false` (governor denies before any provider call), or remove `PIES_LIVE_RESEARCH`, or disable the workflow.
- A crashed run leaves at most one live reservation per call; reservations expire, and `agent_runs` time out (`run_timed_out`).
- Revert code: the runner is additive; reverting its files changes nothing in the database.

## Not yet proven
- Real Exa and Firecrawl responses (adapters follow the documented shapes and are tested with mocks only).
- Real Supabase (all DB evidence is local PostgreSQL 16 with the Supabase auth stub).
- A real GitHub Actions run of the research workflow (CI for tests runs on push).
