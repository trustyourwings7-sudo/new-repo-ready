# Architecture

## Components

```
            ┌──────────────── n8n Cloud (existing) ────────────────┐
            │  Schedule triggers → workflows A–H (Phase 2+)        │
            │  Uses SUPABASE_SERVICE_ROLE_KEY, calls governor RPCs  │
            └───────────────┬──────────────────────────────────────┘
                            │ HTTPS (PostgREST / RPC)
┌──────────────┐   anon key + user session   ┌────────────────────────────┐
│ Next.js app  │ ──────────────────────────▶ │ Supabase (Free)            │
│ (dashboard)  │                             │  Postgres + RLS            │
│ server-only  │ ◀────────────────────────── │  Auth (magic link)         │
│ data access  │                             │  Governor + approval funcs │
└──────────────┘                             └────────────────────────────┘
        ▲
        │ browser (no secrets, no tokens in storage)
      Owner
```

- **Supabase Postgres is the source of truth** for records *and* for policy: budget limits, approvals and audit immutability are enforced in SQL, so they hold no matter which client calls (web app, n8n, a future Worker).
- **Next.js** (App Router, server components) reads data as the signed-in user with the anon key; RLS applies. The service-role key is never loaded by the web app.
- **n8n Cloud** runs scheduled work so the system keeps working when Claude Code and your computer are off. Phase 1 created no workflows; specs are in `docs/WORKFLOWS.md`.
- **Cloudflare Workers** are optional for cron jobs or webhooks n8n handles poorly. Not used yet.

## Data model

| Table | Purpose |
|---|---|
| user_profiles, profile_entries, skills, documents | Profile. Every fact carries `source` and `verification_status`; agents may only cite stored facts. |
| organizations, contacts | Contacts need a `source_url`; an email is only accepted with an `email_source_url` (no guessed emails). |
| opportunities, opportunity_sources | Analysis fields (score, breakdown, recommended action) on `opportunities`; evidence (URL, retrieval time, excerpt, hash) on `opportunity_sources`. `dedupe_key` is unique per user. `ineligible` forces status `ineligible`/`archived`. |
| applications, outreach, approval_requests | Outreach cannot be `approved_to_send`/`sent` without an approval row. |
| client_pipeline | Deal estimates require written assumptions and currency. |
| agent_runs, agent_tasks | Runs have task and timeout ceilings; tasks have max depth 3 and max 5 attempts. |
| budgets, usage_records, provider_configs | Budget governor (see BUDGET_POLICY.md). |
| audit_logs | Append-only. |
| activities, notifications, user_preferences | Tasks, alerts, settings including the paid-operations kill switch (default off). |

Tables marked "support" (beyond the 18 requested): `profile_entries`, `approval_requests`, `provider_configs`. Each exists because a requirement could not be met safely without it.

## Why these choices

- **Policy in SQL, not only TypeScript.** n8n will call the database directly. If limits lived only in the app, any workflow could bypass them. `reserve_budget` serializes decisions with an advisory lock, so parallel workflows cannot overspend.
- **No vector DB, Redis, Docker or paid observability.** Nothing in Phase 1–2 needs them. Deduplication uses deterministic `dedupe_key` + content hashes.
- **Deterministic scoring (Phase 2).** The 100-point rubric is plain TypeScript. An LLM is used only for extraction from messy text, and only through the governor.
- **pnpm.** npm 10.9 crashed while resolving peer dependencies in this environment; pnpm also produces a strict lockfile.
- **Next.js 16 `proxy.ts`** replaces `middleware.ts` (Next 16 naming).

## Hosting

Not deployed. Candidates, with what is known:

| Option | Cost | Risk |
|---|---|---|
| Cloudflare Workers via OpenNext | Free tier | Free-tier Worker size limit (about 3 MiB compressed) may be too small for this bundle [Likely]; Node-runtime proxy support must be verified. |
| Vercel Hobby | Free | Hobby terms are for non-commercial use [Likely]; PIES supports income generation, so read the terms before choosing it. |
| Local only (`pnpm start`) | Free | The dashboard is offline when your computer is; n8n automations still run. |

Decision deferred to the deployment step. It needs your approval.
