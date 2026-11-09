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
- MCP servers are in the repo-root `.mcp.json`: Context7 (docs), Playwright (headless, isolated) and Supabase (docs-only, read-only, no project). Web search and scraping use the claude.ai **Exa** and **Firecrawl** connectors; local duplicates and Tavily were removed. Do not add servers that need keys, or that touch the database, without the owner's approval.
- The repo-root `.claude/settings.json` denies the **whole Gmail and Calendar servers**, n8n publish/execute/agents/delete/credentials, GitHub merge/delete/push/repo creation, session and scheduled-task creation, Drive/Adobe/Canva sharing, invites, comments, purchases and generative credits, Exa `agent_run`, Firecrawl crawl/agent/monitor, Playwright code-exec, and reading `.env*`. Metered research calls and outward GitHub writes are `ask` rules: they prompt even in auto mode. Never work around these rules.
- These rules load only in a single-repo cloud session (or local session) whose checkout contains them. Project threads and scheduled tasks on the default branch do **not** get them (see `docs/INTEGRATION_LOG.md`).
- Research output goes to `pies/intel/` (git-ignored). Never commit it.

## Commands (run from `pies/`)
- `pnpm check` — typecheck + unit tests + DB tests + build. Must pass before every commit.
- `pnpm test:pipeline` — research runner e2e on throwaway Postgres + mock Exa/Firecrawl (no network, no keys).
- `pnpm research` — the research runner itself. Refuses to call anything unless every live gate passes (docs/RUNNER.md).
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
- 2026-11-05 — Cloud sessions and scheduled tasks clone the repo's **default branch**. Config living only on a feature branch never loads there. Check the branch before trusting any repo rule.
- 2026-11-05 — Settings are hot-reloaded: adding `mcp__Gmail__*` to deny removed all 24 Gmail tools mid-session. Verify a deny by watching the tool disappear, or with a harmless dummy (`.env` with a fake value), never by attempting the dangerous call.
- 2026-11-05 — Nested project skills (`pies/.claude/skills`) are discovered only after a file under `pies/` is touched in the session.
- 2026-11-05 — `ask` rules prompt even in auto mode, so they are the right gate for metered connector calls (an unattended run blocks instead of spending).
- 2026-11-05 — Node's built-in TypeScript is strip-only: constructor parameter properties and enums crash it, while Vitest and Next compile them fine. Runner code must use plain fields; a test now loads the runner modules in bare Node.
- 2026-11-05 — `automation_execute` replays the stored response for a reused request id. Day-stable request ids made a same-day retry receive the previous, already-closed run (`run_not_active`). Request ids need a per-invocation nonce; only budget idempotency keys stay day-stable.
- 2026-11-05 — `pg_ctl` refuses to run as root, so the test scripts' cleanup silently leaked a Postgres server per run. Stop the cluster as its owner (`RUN_AS`), defined before the trap.
- 2026-11-05 — A page with injected instructions can plant an address on its own domain; same-domain is not proof of legitimacy. Injection-flagged pages never supply a draft recipient.
- 2026-11-05 — On a public repo, GitHub Actions logs are public. Runners print aggregate metrics only; details go to the database.
- 2026-11-05 — A fetched page proves the page exists, not that it is authoritative. Verification needs an official source (owner allowlist or institutional domain); aggregators and other publishers stay third-party leads.
- 2026-11-05 — An internal budget cap limits what PIES starts, not what a provider bills. Retry only 429 on paid calls, charge timeouts/5xx as billed, and keep provider accounts card-free as the hard limit.
- 2026-11-07 — Supabase's pooler (Supavisor) can keep using a rotated role password for a while; the first connection may succeed and pooled backend connections fail with 28P01. Wait a few minutes after rotation, and read supavisor_logs before guessing.
- 2026-11-08 — GitHub Actions `schedule` is best-effort: on a free public repo it skipped most hourly slots for a day. Never rely on one cron slot; use several daily attempts with per-day idempotency, and treat "already done" as success, not failure.
- 2026-11-08 — Vercel Hobby blocks CLI deployments whose git commit author is not on the account (TEAM_ACCESS_REQUIRED). Deploy from a git-free copy of the tracked files. And check `auth/v1/settings` before trusting "sign-ups are off": it was still on.
- 2026-11-09 — Shipped the chat without a real-browser test because sign-in blocks automated testing, and it crashed on the first message: an arrow-body effect returned `scrollIntoView()`, which newer Chrome makes return a Promise, so React called it as a cleanup. Use braces in effects, and run every interactive page in Chromium (setup mode exercises the client code without signing in) before deploying.
