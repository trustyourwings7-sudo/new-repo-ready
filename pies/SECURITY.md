# Security

Status after Phase 1.5: every control below is backed by an automated test that ran against **local PostgreSQL 16 with a Supabase-like stub**, unless marked otherwise. Nothing has been tested against a real Supabase project yet (see `docs/SUPABASE_INTEGRATION_TEST_PLAN.md`).

## Trust boundaries

```
Browser (owner)  ──anon key + session──▶ Supabase PostgREST ──▶ RLS (own rows only), 6 functions
n8n Cloud        ──HMAC-signed HTTPS──▶ PIES /api/automation/v1 ──pies_automation login──▶ 4 functions, 0 tables
PIES server      holds: HMAC secret, pies_automation password, (Phase 2) provider API keys, (Phase 3) Gmail refresh token
Nobody           holds the Supabase service-role key
```

## Controls (tested)

**Data isolation**
- RLS on every table; `anon` has no table or function access.
- Foreign keys are composite `(id, user_id)`, so a row can never reference another owner's row. Before Phase 1.5, FK checks bypassed RLS and this was possible.

**Function privileges (allowlist, regression-tested)**
- `authenticated` (browser) can execute exactly these: `budget_summary`, `set_category_limit`, `decide_approval`, `initialize_profile`, `initialize_projects`, `pies_is_valid_agent`.
- `pies_automation` can execute exactly these: `automation_execute`, `reserve_budget`, `commit_usage`, `release_usage`. It has no table grants, no `CREATE`, no `BYPASSRLS`, and belongs to no other role.
- Default privileges revoke `EXECUTE` from `PUBLIC` and `anon` on future functions. Any new grant fails `production_checks.sql` and the test suite.

**Automation boundary (n8n)**
- HMAC-SHA256 over `v1:<integration>:<timestamp>:<body>`, ±300 s window, constant-time compare. Body ≤ 32 KB, JSON only, strict envelope.
- Fixed operation catalogue: `run.start`, `run.finish`, `opportunity.upsert`, `source.add`, `task.create`, `notification.create`, `approval.request`. There are no operations to send, submit, spend, approve, change settings or run SQL; these are refused in TypeScript *and* in SQL.
- `automation_execute` does all of the following in one transaction under a per-integration lock:
  - integration enabled + agent enabled for it
  - permission check (SQL mirror of the TS catalogue, test-verified identical)
  - idempotency: the same `request_id` replays the stored result, and a reused id with different content is refused
  - rate limits: per minute ≤ 120, per day ≤ 5,000; defaults 30 and 1,000
  - run limits: concurrent runs ≤ 5 (default 2), tasks per run ≤ 200 (default 50), timeout ≤ 3,600 s (default 600)
  - strict payload keys: agents cannot set scores, eligibility, status or `user_id`
  - audit row for every attempt, including rejections
- A failed operation rolls back everything it wrote; only the rejection and its audit row are kept.

**Budget**
- See BUDGET_POLICY.md. Paid-call RPCs are callable only by `pies_automation`, so browser sessions and n8n cannot reserve or under-report spend. Parallel attack test: 20 simultaneous $0.40 reservations against $5.00 → exactly 12 accepted.

**Approvals**
- Only a signed-in human decides; decisions must be on time; each approval is single-use and bound to action, target and SHA-256 of content.
- Outreach cannot become `approved_to_send` without an approved, matching `send_email` approval, nor `sent` without a consumed one (trigger).

**Web**
- Magic link with `shouldCreateUser: false` and an email allowlist (fail-closed).
- Sign-out rejects cross-origin POSTs.
- Security headers, `noindex`, no `X-Powered-By`, and a fixed post-login redirect.
- The logger redacts secret-shaped values; env errors name variables only. The end-to-end test confirms the HMAC secret never appears in server logs.

**n8n workflow audit**
- `auditN8nWorkflow()` must pass before any workflow is published. It checks:
  - only allowlisted node types; no AI, search, Gmail, Postgres or Supabase nodes
  - HTTP only to the PIES API
  - no credentials
  - no network calls from Code nodes

## Gmail (Phase 3, not connected)

- **Fact:** there is no draft-only Gmail scope. `users.drafts.create` accepts only the full-mailbox scope, `gmail.modify` or `gmail.compose`. **All three allow sending.** `gmail.compose` is the narrowest, and Google classifies it as a **restricted** scope. (Sources: Google's Gmail API scope and `drafts.create` reference pages, read via search because developers.google.com is blocked by this session's network policy.)
- **What PIES does:**
  - The token lives only on the PIES server.
  - `src/lib/gmail/drafts.ts` exposes `createDraft`, `getDraft` and `listDrafts` only.
  - The agent interface has no email operation.
  - Tests fail if a send method, a send endpoint string or a broader scope appears anywhere in `src/`.
- **What that does NOT do:** these are application restrictions. They do not change what the Google token permits. **If the refresh token or the OAuth client secret leaks, an attacker can send email as you and read/modify/delete your drafts** until you revoke access at myaccount.google.com → Security → Third-party connections.
- **Further residual facts [Likely]:**
  - A personal OAuth app left in "Testing" mode issues refresh tokens that expire after about 7 days, so weekly re-authorization is needed.
  - Publishing an app with a restricted scope requires Google verification, which can include a paid security assessment. Do not publish it.
- **Safest option (recommended for Phase 3):** no OAuth at all. PIES shows the draft and a "compose in Gmail" link (`https://mail.google.com/mail/?view=cm&to=…&su=…&body=…`), and you press Send yourself. Zero token risk, at the cost of one click per message.

## Remaining risks

| # | Risk | Severity | Status |
|---|---|---|---|
| R1 | Nothing verified on real Supabase (pooler + custom role, `session_user`, default privileges, auth flow) | High | Test plan written; needs your project |
| R2 | Gmail token, if connected and stolen, can send mail | High (Phase 3) | Recommend the no-OAuth option |
| R3 | n8n built-in AI/search credits bypass the governor if someone adds those nodes | Medium | Auditor + manual review; cannot be blocked from PIES |
| R4 | The auditor's Code-node scan can be evaded by obfuscated code | Low | Review every Code node by eye |
| R5 | Supabase project owner (you) still has the dashboard and service key | Accepted | Use a strong password + 2FA on Supabase, GitHub, n8n and Google |
| R6 | The concurrency test detects a missing lock probabilistically (killed the mutant in 4 of 5 runs) | Low | The lock itself is deterministic |
| R7 | No Content-Security-Policy header yet | Low | Add a nonce-based CSP before public deployment |
