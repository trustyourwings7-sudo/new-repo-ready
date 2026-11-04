# Security

## Controls in place (tested)

- **RLS on every user-owned table.** Users see and change only rows where `user_id = auth.uid()`. The `anon` role has no table access.
- **Governed tables** (`budgets`, `usage_records`, `approval_requests`, `audit_logs`) are read-only to users; writes go through `SECURITY DEFINER` functions with `search_path = ''` and explicit owner checks.
- **Approvals** can only be decided by a signed-in human (`decide_approval` refuses the service role). Consumption is single-use and bound to action, target and content hash.
- **Audit log** is append-only (update/delete blocked by trigger; account deletion still cascades). Users cannot forge agent entries.
- **Sign-in:** magic link, `shouldCreateUser: false`, and an email allowlist checked both before sending the link and after the callback. An empty allowlist admits nobody.
- **Secrets:** only `NEXT_PUBLIC_SUPABASE_URL` and the anon key reach the browser. The logger redacts secret-named keys and secret-shaped values (JWTs, `sk-…`, Google keys and tokens, bearer tokens). Env errors name variables, never values.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, HSTS, strict referrer, restrictive permissions policy; `X-Powered-By` removed; `noindex`.
- **Prompt injection:** external content is wrapped as data (`wrapUntrusted`) and cannot close its wrapper. Agents cannot raise their own permissions; scopes are code, not prompt text.
- **Redirects:** the auth callback always redirects to a fixed path (no open redirect).

## Known gaps (accepted for Phase 1, to fix before relying on automation)

1. **The service-role key bypasses RLS.** n8n will hold it, so a misconfigured workflow could write anything. The governor and approval functions are still enforced *if called*; nothing forces a workflow to call them. Planned fix: a dedicated Postgres role for automations, with execute rights on governor functions and narrow insert rights, plus a webhook endpoint in the app so n8n does not hold the service key at all.
2. **Gmail has no draft-only OAuth scope.** `gmail.compose` lets the holder create *and send* drafts [Likely, verify on Google's scope list]. "Draft only" is therefore enforced by our code and the approval check, not by Google. Keep the Gmail credential out of any workflow that does not need it.
3. **Magic-link login is not yet tested** against a real Supabase project.
4. **Supabase Auth signups:** turn off "Allow new users to sign up" in the Supabase dashboard and create the owner user by hand. The allowlist is a second layer, not the only one.
5. **Sign-out is a plain POST** without a CSRF token. Worst case: a third-party page signs you out.
6. **No rate limiting** on the login form beyond Supabase's built-in limits.

## Reporting

Single-owner project. Rotate any key you suspect was exposed: Supabase (Settings → API → regenerate), provider dashboards for AI/search keys.
