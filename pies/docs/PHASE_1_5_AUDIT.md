# Phase 1.5 Audit Report: Security, Architecture and Cost

Date: 2026-11-05 · Branch: `claude/upbeat-carson-2prwrq` · Scope: everything in `pies/`.

**Bottom line:** the critical design flaw (n8n holding the Supabase service-role key) is removed, and four real vulnerabilities found in the Phase 1 code are fixed, each with a test that would fail if it came back. **No test has run against a real Supabase project.** Production compatibility is unproven until `SUPABASE_INTEGRATION_TEST_PLAN.md` T1–T8 pass.

## 1. Repository integrity

| Check | Result |
|---|---|
| Branch / remote | `claude/upbeat-carson-2prwrq` → `origin` (trustyourwings7-sudo/new-repo-ready) |
| Uncommitted changes at start | None (clean tree) |
| PIES isolation | All PIES files are under `pies/` |
| Shemmaa files | `git diff --name-only fc17c83 HEAD` outside `pies/`: **empty**, so they are unchanged |
| History | Preserved; Phase 1.5 is additive (2 new migrations; Phase 1 migrations untouched) |

## 2. Findings

| ID | Finding | Severity | Status | Proof |
|---|---|---|---|---|
| F-01 | Plan gave n8n the service-role key (bypasses all RLS and every governor rule) | **Critical** (design) | **Fixed.** New boundary: HMAC API + `pies_automation` role with 4 functions and 0 tables; the service key is used nowhere | `20_automation_boundary.sql` (19 raw-access attempts refused), `test:e2e` |
| F-02 | Foreign keys accepted references to **another user's** rows (FK checks bypass RLS) | High | **Fixed:** composite `(id, user_id)` FKs on every reference | Probe reproduced it; tests now get `foreign_key_violation` |
| F-03 | `SECURITY DEFINER` helper `pies_ensure_budgets` executable by every signed-in user, writing into **another user's** budget rows | High | **Fixed:** privilege lockdown, exact allowlists, default-privilege revokes | Probe reproduced it (user B wrote A's rows); allowlist test + `production_checks.sql` (mutation confirmed detection) |
| F-04 | Browser sessions could call `reserve/commit/release_usage` and so under-report spend | Medium | **Fixed:** budget RPCs are callable only by `pies_automation` | `10_security_and_governor.sql` |
| F-05 | Outreach could be marked `approved_to_send`/`sent` while pointing at a pending or rejected approval | Medium | **Fixed:** trigger validates the approval's status, action and target | `20_…`: pending, unconsumed and reused approvals refused |
| F-06 | n8n instance exposes built-in AI/search **gateway credits** usable without credentials, outside the governor | Medium | **Mitigated:** `auditN8nWorkflow()` bans those nodes, credentials, non-PIES HTTP calls and Code-node network calls. It cannot be enforced from PIES | `n8n-audit.test.ts` |
| F-07 | Gmail: no draft-only scope exists; `gmail.compose` (restricted) permits sending | High (Phase 3) | **Documented and constrained:** draft-only module, no send anywhere, source scan; recommend the no-OAuth compose-link option | `gmail.test.ts`; SECURITY.md lists the residual risk |
| F-08 | Sign-out accepted cross-site POSTs (CSRF) | Low | **Fixed:** origin check | Browser test: cross-origin POST → 403 |
| F-09 | Phase 1 mobile check was wrong: screen-reader labels widened the page at 390 px | Low | **Fixed:** nav is now `relative` | Re-measured 5 pages at 390 and 1366 px: no overflow |
| F-10 | Phase 1 had no rate limits, run limits or idempotency for automation | Medium | **Fixed** in `automation_execute` | Rate-limit test, run limit/timeout/concurrency tests, parallel replay test |
| F-11 | The DB test runner skipped `01_*.sql` after the restructure | Low | **Fixed:** runner globs all files except the stub | All suites now print their pass line |
| F-12 | No Content-Security-Policy | Low | Open | Before public deployment |

## 3. Automated tests (all local, all passing)

| Suite | Count | Covers |
|---|---|---|
| Unit (`pnpm test`) | 64 | HMAC: wrong secret, stale/future timestamp, tampered body, unknown integration; oversized, non-JSON and bad envelopes; `gmail.send`, `budget.reserve` and other forbidden ops refused before the DB; Gmail draft-only surface + source scan; n8n audit; TS↔SQL mirrors for operations and agent permissions; governor client; permissions |
| SQL (`pnpm test:db`) | ~150 assertions | Cross-user read/write/insert; tenant FKs; exact function allowlists; automation role cannot touch tables or 15 sensitive functions; unknown/disabled integrations; unknown agents; permission matrix; idempotent replay; reused id with changed content; dedupe; agent cannot set score or owner; run task limit, timeout, concurrency; rate limit (and audit of rejected calls); budget exhaustion, category/monthly caps; invalid, expired, mismatched, modified and reused approvals; outreach send guard |
| Parallel (`30_concurrency.sh`) | 3 | 20 concurrent reservations → 12 accepted ($4.80 ≤ $5); 10 concurrent identical requests → 1 run + 9 replays; 10 concurrent upserts → 1 row |
| Production checks | 16 | Same file you will run on Supabase |
| E2E (`pnpm test:e2e`) | 11 HTTP + DB | Real Next.js server + real Postgres login as `pies_automation`; secret absent from logs |
| Typecheck + production build | pass | |

**Mutation checks** (to prove the tests can fail):
- Removing the budget lock was caught in 4 of 5 runs. Detection depends on timing; the lock itself does not.
- Re-granting the vulnerable helper was caught by `production_checks.sql`.

**Not tested (requires real systems):** Supabase pooler login with a custom role, Supabase default privileges, magic-link auth, PostgREST exposure, n8n execution, any provider or Gmail call.

## 4. Remaining risks

See SECURITY.md → Remaining risks (R1–R7). Highest:
- **R1:** nothing has been verified on real Supabase.
- **R2:** a connected Gmail token can send mail if stolen.
- **R3:** n8n gateway credits can be misused by a careless workflow edit.

## 5. Real-world prerequisites (yours)

1. Free Supabase project with sign-ups disabled and 2FA on.
2. Run the 5 migrations, then `production_checks.sql`, which must be all `ok`.
3. Run T1–T8 of the integration test plan and send me the output.
4. Choose a hosting option (ARCHITECTURE.md).
5. Before Phase 2: verify the AI and search provider prices on their pricing pages, and set provider-side hard limits.

## 6. Updated cost estimate

- **Current: $0.00/month**, because nothing paid is enabled. [Certain]
- **Phase 2 projection: $0.50–$5/month** within the $5 AI and $2 search caps. [Guessing] until prices are verified.
- All 8 runtime dependencies are free and open source. [Certain]
- Watch the n8n plan: whether gateway credits or execution overages ever bill is not verified. [Guessing]

## 7. Recommended next step

Run the real-Supabase test plan (about 30 minutes). Approve Phase 2 only after T1–T8 pass. If Phase 2 is approved, build the server-side paid-call proxy **before** any discovery workflow, so that no AI or search call can exist outside the governor.
