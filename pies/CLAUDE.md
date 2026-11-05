# CLAUDE.md — rules for AI sessions on PIES

Read this file first in every session. Update the **Lessons log** at the end of every session.

## Non-negotiables
- Hard cap is **$10/month incremental**. Never add a paid dependency, purchase or upgrade. Paid calls go through `withBudget()` / `reserve_budget`.
- Never weaken RLS, the governor, the approval functions or the audit triggers. Change policy only through a new migration plus a test in `supabase/tests/`.
- Never send email, submit applications, pay, sign or delete critical records. Level 4 actions need a single-use approval; human-only actions never run from code.
- Never invent profile facts, contacts, emails, opportunities or prices. Every record needs a source. Unknown stays unknown (`null`).
- No sample or demo data in the UI. Show honest empty or not-configured states.
- Never print, log or commit secrets. Only `NEXT_PUBLIC_*` values may reach the browser.
- Follow the phases in order. Stop at the end of each phase and wait for owner approval.
- Never use or request the Supabase service-role key. n8n gets only the HMAC secret + integration id.
- New automation operations need: SQL case in `automation_execute`, TS entry in `AUTOMATION_OPERATIONS`, strict key allowlist, `pies_claim_run`, and tests (TS and SQL lists are checked identical).
- Every new function migration must end with explicit grants. `production_checks.sql` and `20_automation_boundary.sql` enforce exact allowlists.
- Every user-owned reference must be a composite `(id, user_id)` FK.
- No Gmail send capability, ever. `tests/gmail.test.ts` scans `src/`.
- Every n8n workflow must pass `auditN8nWorkflow()` before publishing.
- Do not claim "works on Supabase" until `docs/SUPABASE_INTEGRATION_TEST_PLAN.md` T1–T8 pass.

## Tooling for Claude sessions (see docs/INTELLIGENCE_INFRASTRUCTURE.md)
- Project skills live in `pies/.claude/skills/` (10). Use `security-review` before every PIES commit and `budget-guard` before any paid service.
- MCP servers are in the repo-root `.mcp.json`: Context7 (docs) and Playwright (headless, isolated). Do not add servers that need keys, or that touch the database, without the owner's approval.
- The repo-root `.claude/settings.json` denies Gmail sending, n8n publish/execute/agents, GitHub merge/delete, Playwright code-exec, and reading `.env*`. Never work around these denies.
- Research output goes to `pies/intel/` (git-ignored). Never commit it.

## Commands (run from `pies/`)
- `pnpm check` — typecheck + unit tests + DB tests + build. Must pass before every commit.
- `pnpm test:db` — needs local Postgres binaries. Uses a throwaway cluster in /tmp (a scratchpad under /tmp/claude-0 is not readable by the postgres user).
- Use **pnpm**, not npm (npm 10.9 crashed during peer-dependency resolution here).

## Conventions
- Policy lives in SQL; TypeScript mirrors constants (tests check that the two match).
- Pin exact dependency versions that are at least 2 weeks old.
- Agent IDs: `src/lib/agents/registry.ts` and `pies_is_valid_agent()` must match.

## Lessons log (append; newest last)
- 2026-11-04 — Postgres `CHECK (col ~ 'regex')` passes when `col` is NULL. Wrap with `coalesce(col, '')`. Caught by the test suite (contact emails without a source were being accepted).
- 2026-11-04 — `Math.ceil(x * 1e6)` overshoots on float noise (0.005625 → 0.005626). Snap with `toFixed` before ceiling.
- 2026-11-04 — Test runners that pipe output must preserve the exit status. Verified by injecting a failing test.
- 2026-11-04 — On mobile, a horizontally scrolling flex nav inside a flex column needs `min-w-0` on its ancestor, or the whole page overflows.
- 2026-11-04 — Gmail `gmail.compose` can also send. "Draft only" must be enforced in code, not by OAuth scope.
- 2026-11-05 — `revoke ... from public, anon` is not enough on Supabase-style setups: default privileges grant EXECUTE to `authenticated` directly. A SECURITY DEFINER helper was callable by every user and wrote into another user's rows. Always revoke from `authenticated` too, and test exact allowlists.
- 2026-11-05 — Foreign-key checks ignore RLS. A user could link rows to another user's records by UUID. Use composite `(id, user_id)` FKs; `ON DELETE SET NULL (col)` keeps `user_id` intact (PG15+).
- 2026-11-05 — Concurrency tests must avoid accidental serialization: first-call `INSERT … ON CONFLICT` blocked the racers, so a mutant without the lock survived. Pre-create rows, then race. Verify with a mutant.
- 2026-11-05 — n8n Cloud exposes built-in AI/search "gateway credits" usable without credentials. A governor in PIES cannot see them; audit workflow JSON instead.
- 2026-11-05 — PL/pgSQL parameters cannot be `record`; use the table rowtype.
- 2026-11-05 — A source-scan test caught its own module's comment. Keep forbidden strings out of comments and scan narrowly.
- 2026-11-05 — `SET SESSION AUTHORIZATION` (not `SET ROLE`) is needed to test logic that checks `session_user`.
- 2026-11-05 — Claude Code reads `.mcp.json` and `.claude/settings.json` from the launch directory (repo root here); configs placed only in `pies/` would never load. Skills can be nested (`pies/.claude/skills`).
- 2026-11-05 — This cloud session's network allows npm and api.github.com but blocks most SaaS hosts (context7, exa, tavily, firecrawl, supabase docs). A started MCP server is not a working one; test a real tool call.
- 2026-11-05 — Playwright MCP ships `browser_run_code_unsafe` and `browser_evaluate` (arbitrary code). Deny them by default.
- 2026-11-05 — Context7's keyless tier ran out ("Monthly quota exceeded") after 4 calls from shared cloud egress. Plan for a free key.
- 2026-11-05 — `claude mcp get` shows the raw `${VAR}` text; that is not proof of expansion. `claude mcp list` diagnostics do validate it ("Missing environment variables").
- 2026-11-05 — Project-scoped `claude plugin disable --scope project` writes `enabledPlugins` into the repo settings: a durable way to drop irrelevant or failing plugin servers for this repo only.
- 2026-11-05 — A server-level deny (`mcp__Composio`) removes every tool of that server immediately in the running session.
- 2026-11-05 — The Phase 1 "no mobile overflow" claim was wrong: `sr-only` (absolute) spans escaped a scrolling nav. Check `documentElement.scrollWidth` on every page and both widths, and give scroll containers `position: relative`.
