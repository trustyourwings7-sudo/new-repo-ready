# PIES — Personal Intelligence & Execution System

A private, single-owner system for discovering opportunities, qualifying them against a verified profile, preparing outreach and tracking pipelines, under a hard **USD 10/month** incremental spending cap.

> **Status: Phase 1 (Foundation) complete locally. Not deployed. No agents run yet.**
> Nothing in this app runs while your computer is off until Supabase is created and the n8n workflows (Phase 2) are published.

## What works now (tested)

| Component | Status | Evidence |
|---|---|---|
| Database schema (18 required + 3 support tables) | Works | `pnpm test:db` applies all migrations to a throwaway Postgres 16 |
| Row Level Security, owner-only access, anon locked out | Works | SQL tests: cross-user read/write/insert refused |
| Budget governor (hard cap, category caps, provider caps, kill switch, idempotency, unverified-pricing block) | Works | SQL tests + unit tests |
| Approval mechanism (single-use, bound to action + target + content hash, human-only decisions) | Works | SQL + unit tests |
| Append-only audit log | Works | SQL tests: update/delete refused |
| Permission engine (4 levels, per-agent scopes) | Works | Unit tests |
| Dashboard, Budget, Settings, module status pages | Renders | Production build + headless browser check at 1366px and 390px |
| Magic-link sign-in with email allowlist | **Built, not tested** | Needs a real Supabase project |
| Dashboard reading live data | **Built, not tested** | Needs a real Supabase project |

## Quick start

```bash
cd pies
pnpm install
cp .env.example .env.local   # fill in Supabase values, see DEPLOYMENT.md
pnpm dev
```

Without Supabase values the app runs in **setup mode**: every section says "Not connected" instead of showing sample data.

## Checks

```bash
pnpm check   # typecheck + unit tests + database tests + production build
```

`pnpm test:db` needs local PostgreSQL server binaries (`initdb`, `pg_ctl`). It never touches a real Supabase project.

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — components, data flow, why each choice
- [AGENT_SPECIFICATIONS.md](AGENT_SPECIFICATIONS.md) — the seven agents, scopes and limits
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md) — n8n workflow specifications A–H
- [SECURITY.md](SECURITY.md) — threat model, permissions, known gaps
- [BUDGET_POLICY.md](BUDGET_POLICY.md) — spending rules and cost estimates
- [DEPLOYMENT.md](DEPLOYMENT.md) — manual setup steps
- [CLAUDE.md](CLAUDE.md) — rules for AI sessions working on this code
