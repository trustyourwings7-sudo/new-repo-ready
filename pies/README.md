# PIES — Personal Intelligence & Execution System

A private, single-owner system for discovering opportunities, qualifying them against a verified profile, preparing outreach and tracking pipelines across independent projects (career, education & funding, JAMOF ventures, Shemmaa, AI consulting, lead generation). It runs under a hard **USD 10/month** incremental spending cap.

> **Status: Phase 1.5 (security, architecture and cost audit) complete locally. Not deployed. No agents or workflows run.**
> Nothing has been tested against a real Supabase project. See `docs/SUPABASE_INTEGRATION_TEST_PLAN.md`.
> Audit report: [docs/PHASE_1_5_AUDIT.md](docs/PHASE_1_5_AUDIT.md)

## Checks

```bash
pnpm check   # typecheck + unit tests + DB tests + production build + local e2e
```

| Command | What it proves | Environment |
|---|---|---|
| `pnpm test` | 64 unit tests: governor client, permissions, HMAC/API rejection paths, Gmail send prohibition, n8n workflow audit, TS↔SQL mirrors | Node only |
| `pnpm test:db` | Migrations apply; RLS, tenant FKs, privilege allowlists, governor, approvals, automation boundary, parallel attacks; production checks | Local PostgreSQL 16 + Supabase stub |
| `pnpm test:e2e` | Signed HTTP → production Next.js server → `pies_automation` login → database effects; secret absent from logs | Local only |
| Real Supabase | **Not run yet** | Needs your project |

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [BUDGET_POLICY.md](BUDGET_POLICY.md) · [DEPLOYMENT.md](DEPLOYMENT.md)
- [AGENT_SPECIFICATIONS.md](AGENT_SPECIFICATIONS.md) · [docs/WORKFLOWS.md](docs/WORKFLOWS.md) · [CLAUDE.md](CLAUDE.md)
- [docs/SUPABASE_INTEGRATION_TEST_PLAN.md](docs/SUPABASE_INTEGRATION_TEST_PLAN.md) · `supabase/verify/production_checks.sql`
