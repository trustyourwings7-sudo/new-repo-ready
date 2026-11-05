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

## What it costs

| Provider | Verified facts (2026-11-05) | PIES reservation price | Confidence |
|---|---|---|---|
| Exa `/search` (type auto, ≤10 results with text) | $7 per 1,000 is the highest published figure; free plan $10 credits/month | $0.007 × 1.25 | Likely (official pricing page not reachable from the build container) |
| Firecrawl `/v2/scrape` | 1 credit/page; **free plan has no pay-as-you-go: HTTP 402 at the limit**; 1,000 credits/month; 10 scrapes/min ([billing](https://docs.firecrawl.dev/billing), [rate limits](https://docs.firecrawl.dev/rate-limits)) | shadow $0.0097/credit × 1.25 | Likely |
| GitHub Actions | Standard runners in public repositories are free | $0 | Likely |
| Supabase | Free plan (owner's project) | $0 | Needs owner confirmation |

Default run (3 searches + 10 extractions): reserve $0.1475, commit $0.118 at list prices
(3 × $0.007 + 10 × $0.0097). The **search** category cap ($2/month) stops it after roughly 13–17 runs a month; per-provider caps
(`provider_configs.monthly_cap_usd`) split that further. **Worst case is bounded by the governor at $2.00
search + $0 AI + $0 infra**, and real money only moves if the Exa account has a card and exceeds its free credits.

## Owner setup (each step is yours; nothing here was done for you)
1. **Supabase**: create the Free project, apply `supabase/migrations/*` in order, run `supabase/verify/production_checks.sql` (all rows `ok = true`), sign in once (seeds projects), then follow DEPLOYMENT.md to give `pies_automation` a login password and create one `automation_integrations` row with `allowed_agents = '{discovery}'`.
2. **Providers**: in Supabase, insert `provider_configs` rows for `exa` and `firecrawl` (category `search`, `enabled`, `pricing_verified` with the pricing URL you checked, `monthly_cap_usd` e.g. 1.50 / 0.50), then set `user_preferences.paid_operations_enabled = true`.
3. **Accounts**: confirm Exa and Firecrawl are on free plans with **no card and no auto top-up**.
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
