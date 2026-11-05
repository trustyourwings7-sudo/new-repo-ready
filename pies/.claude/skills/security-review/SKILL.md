---
name: security-review
description: Run the PIES security and quality gate before any commit that touches pies/ - full test suite, migration rules, privilege allowlists, secret scan, Gmail send prohibition and Shemmaa isolation. Use before committing, when writing a migration, or when asked to review PIES changes.
---

# PIES security review gate

Run from `pies/`. All steps must pass. Report the actual output and never assume a step passed.

1. `pnpm check`: typecheck, unit tests, DB tests (local Postgres), build, e2e. Any failure blocks the commit.
2. **Migration rules** (for every new or changed `supabase/migrations/*.sql`):
   - New tables: RLS enabled plus an owner policy. References between user-owned rows are composite `(id, user_id)` FKs.
   - New functions: `security definer` only with `set search_path = ''` and explicit owner checks. End the migration with explicit `revoke`/`grant`.
   - If grants change, update the allowlists in `supabase/tests/20_automation_boundary.sql` **and** `supabase/verify/production_checks.sql`, and state why.
   - Never edit an already-applied migration; add a new one.
3. **Automation boundary:** a new operation needs the SQL case in `automation_execute`, an `AUTOMATION_OPERATIONS` entry, a strict key list, `pies_claim_run`, and tests. TS↔SQL mirror tests must pass.
4. **Secrets:** run `git diff --cached` and grep for `eyJ…`, `sk-…`, `AIza…`, `ya29.`, `postgres://…:…@`, and private keys. No `.env*` files except `.env.example`.
5. **Never:**
   - a Gmail send capability (`tests/gmail.test.ts`)
   - the service-role key
   - an n8n credential
   - a paid service without `budget-guard`
6. **Isolation:** `git diff --cached --name-only` must not include `SHEMMAA.md`, `research/` or any JAMOF material.
7. Commit messages state what was tested. Do not claim Supabase compatibility until `docs/SUPABASE_INTEGRATION_TEST_PLAN.md` passes.

For library or framework questions (Next.js, Supabase, Postgres, Zod), use Context7 MCP when it is reachable. If it is not, use WebFetch on official docs. Do not rely on memory for APIs that change.
