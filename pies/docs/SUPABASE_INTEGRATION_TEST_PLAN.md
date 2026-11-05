# Real-Supabase Integration Test Plan

Automated tests so far ran on **local PostgreSQL 16** with a minimal stub for `auth.uid()`, `auth.role()` and the `anon`/`authenticated`/`service_role` roles. That proves the SQL logic. It does **not** prove production compatibility. Run this plan on a fresh free project before Phase 2.

## Known differences between the local stub and Supabase

| Area | Local stub | Supabase | Risk to check |
|---|---|---|---|
| Superuser | tests run as a real superuser | `postgres` is not a true superuser | `CREATE ROLE pies_automation` must succeed in a migration (T2) |
| Table ownership / RLS bypass | owner = postgres | owner = postgres (migrations run as postgres) | `SECURITY DEFINER` functions rely on owner bypass (check 3) |
| Default privileges | set by the stub | Supabase grants tables/functions to anon, authenticated and service_role by default | Our revokes must win (checks 4–8) |
| Extensions | `pgcrypto` in `public` | `pgcrypto` in `extensions` | We only use the built-in `sha256()` and `gen_random_uuid()` |
| JWT claims | `request.jwt.claims` set by tests | set by PostgREST per request | `auth.uid()` contract (check 15) |
| Custom login role | local TCP, trust auth | Supavisor pooler, user `pies_automation.<ref>`, port 6543 | `session_user` must equal `pies_automation` through the pooler (T4) |
| Transactions | direct connection | transaction-mode pooler | Only transaction-scoped advisory locks are used (safe); `prepare: false` set in the driver |
| Statement timeout | none | about 8 s for authenticated, configurable | Governor and automation functions finish in milliseconds |
| Auth | not exercised | magic link, PKCE, `shouldCreateUser: false` | T6–T8 |

## Steps (about 30 minutes; nothing costs money)

**T1. Apply migrations** in order through the SQL editor. Expected: no errors.

**T2. Role exists:** `select rolname, rolcanlogin from pg_roles where rolname = 'pies_automation';` → one row, `false`.

**T3. Run `supabase/verify/production_checks.sql`.** Expected: every row `ok = true`. Copy the output into your report. **If any row fails, stop.**

**T4. Pooler login as the restricted role.**
1. Run `alter role pies_automation login password '<40+ random chars>';`
2. Connect with psql to `postgres://pies_automation.<ref>:<pw>@<pooler-host>:6543/postgres`.
3. Run `select session_user, current_user;` → both `pies_automation`.
4. Run `select * from public.opportunities limit 1;` → `permission denied`.
5. Run `select public.budget_summary(null);` → `permission denied`.

**T5. Automation round trip.**
1. As the owner in the app, create an `automation_integrations` row (`enabled = true`, `allowed_agents = '{discovery}'`).
2. Run `pnpm build`, then start the app locally with `PIES_AUTOMATION_*` pointing at the pooler.
3. Run `E2E_URL=… E2E_SECRET=… E2E_INT=… node scripts/e2e-automation-client.mjs`. Expected: all `ok`.
4. Delete the test run and opportunity afterwards.

**T6. Sign-in.**
- The magic link to the allowlisted email signs you in.
- Another email gets the same "if allowed…" message, and no account is created (Authentication → Users is unchanged).

**T7. RLS through the real API.**
1. Create a second user in the dashboard.
2. Use the anon key with that user's session to `GET /rest/v1/opportunities`. Expected: `[]`.
3. Call `POST /rest/v1/rpc/automation_execute` with the anon key or a user session. Expected: permission denied.

**T8. Dashboard.**
- Sign in and click "Load initialization context". The dashboard shows zeros and the Budget page shows a $10 cap with paid operations disabled.
- Click it again. Nothing changes.

**T9. Concurrency through the pooler (optional).** Run `supabase/tests/30_concurrency.sh` with `PGHOST`/`PGPORT`/`PGUSER` pointing at the pooler and a throwaway user. Expected: 12 of 20.

Only after T1–T8 pass may the docs say "tested on Supabase".
