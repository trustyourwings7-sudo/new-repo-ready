# Architecture

## Components

```
 n8n Cloud (existing)                      holds ONLY: HMAC secret + integration id (n8n variables)
   Schedule → Code/Crypto → HTTP Request ──────────────┐  signed JSON, ≤32 KB
                                                       ▼
 ┌──────────────────────── PIES Next.js server ────────────────────────┐
 │ /api/automation/v1  verify HMAC + window → strict envelope →         │
 │                     operation allowlist → postgres login as          │
 │                     pies_automation → automation_execute()           │
 │ pages (dashboard)   anon key + user session → PostgREST (RLS)        │
 │ (Phase 2) paid-call proxy: provider keys live here; reserve→call→commit│
 │ (Phase 3) Gmail drafts module: refresh token lives here               │
 └───────────────┬───────────────────────────────┬──────────────────────┘
                 │ pies_automation (4 functions,  │ authenticated (RLS, 6 functions)
                 ▼ 0 tables)                      ▼
 ┌──────────────────────────── Supabase Postgres ───────────────────────┐
 │ automation_execute: validate · permission · idempotency · rate limit │
 │   · run limits · write · audit   (one transaction)                   │
 │ budget governor · approvals · append-only audit · composite FKs      │
 └──────────────────────────────────────────────────────────────────────┘
```

- **Supabase Postgres is the source of truth** for records *and* policy. Budget limits, approvals, audit immutability, tenant isolation and the automation rules are enforced in SQL.
- **Nobody holds the service-role key.** The browser uses the anon key and RLS. Automation uses the `pies_automation` login role, which has no table privileges.
- **n8n Cloud** keeps the schedules running while your computer is off. It can only call the seven automation operations. It holds no database key, no provider key and no Gmail token.
- **Projects** (`projects` table) separate independent objectives: career, education & funding, JAMOF ventures, Shemmaa, AI consulting, lead generation, and any future ones. Opportunities, organizations, contacts, pipeline, outreach, applications, tasks, runs and documents carry an optional `project_id`. Adding a venture is a new row, not a code change.
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

| projects | Independent objectives/ventures; composite FK keeps them per-owner. |
| automation_integrations, automation_requests | Owner-managed integration settings and limits; request ledger for idempotency, rate limits and audit. |

Support tables beyond the 18 requested: `profile_entries`, `approval_requests`, `provider_configs`, `projects`, `automation_integrations` and `automation_requests`. Each exists because a requirement could not be met safely without it.

All references between user-owned rows are composite `(id, user_id)` foreign keys. Without them, PostgreSQL foreign-key checks bypass RLS and allow cross-owner links.

## Why these choices

- **Policy in SQL, not only TypeScript.** Limits hold even if app code has a bug. `reserve_budget` and `automation_execute` serialize with transaction-scoped advisory locks, which are safe through Supabase's transaction-mode pooler.
- **Restricted login role instead of a service key.** A custom Postgres role restricted to four functions is the narrowest credential Supabase offers that works without custom JWT signing. The `postgres` driver connects through the pooler with `prepare: false`.
- **HMAC-signed API instead of a database credential for n8n.** If n8n is compromised, the attacker gets seven rate-limited, audited operations. They do not get the database.
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
