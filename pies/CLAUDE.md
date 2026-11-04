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
