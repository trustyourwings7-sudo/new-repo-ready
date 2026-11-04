# Deployment and Secure Setup

Nothing here has been done for you. Every step is free, and none buys anything. Public deployment is **not** approved yet.

## 1. Supabase project (secure configuration)

1. Create a free project. Enable **2FA** on your Supabase account (Account → Security).
2. **Authentication → Sign In / Providers**:
   - Turn **off** "Allow new users to sign up".
   - Keep Email enabled.
   - Disable every provider you do not use.
3. **Authentication → Users → Add user** with your email (the owner account).
4. **Authentication → URL Configuration**: Site URL = your app URL; Redirect URLs = `<site>/auth/callback` only.
5. **SQL Editor**: run the files in `supabase/migrations/` **in filename order** (5 files).
6. Run `supabase/verify/production_checks.sql`. **Every row must be `ok = true`.** If not, stop.
7. **Project Settings → API**: copy the Project URL and the **anon/publishable** key.
   - **Do not copy the service-role/secret key anywhere.** PIES does not use it.
8. Optional hardening: Project Settings → API → "Exposed schemas": keep only `public`.

## 2. App configuration

```bash
cd pies
cp .env.example .env.local
pnpm install
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PIES_ALLOWED_EMAILS` and `PIES_SITE_URL`. Then:

```bash
pnpm build
pnpm start
```

Sign in, then **Settings → Load initialization context**. This creates the profile, preferences with paid operations off, and six starting projects.

## 3. Automation boundary (only when Phase 2 is approved)

1. In the SQL editor, give the restricted role a login. Generate the password locally with `openssl rand -hex 24`, and do not reuse it:
   ```sql
   alter role pies_automation login password '<generated>';
   ```
2. As the owner (signed in), create an integration. Using the SQL editor with your user id also works:
   ```sql
   insert into public.automation_integrations (user_id, name, enabled, allowed_agents)
   values ('<your auth user id>', 'n8n', true, '{discovery,qualification}') returning id;
   ```
3. Server environment (never n8n):
   - `PIES_AUTOMATION_DATABASE_URL=postgres://pies_automation.<ref>:<password>@<pooler-host>:6543/postgres`
   - `PIES_AUTOMATION_INTEGRATION_ID=<id from step 2>`
   - `PIES_AUTOMATION_SECRET=<openssl rand -hex 32>`
4. n8n receives only the secret and integration id, as n8n **variables**, never credentials. Requests are signed with the Crypto node.
5. Before publishing any workflow, export its JSON and run it through `auditN8nWorkflow()`. It must return no findings.
6. Run `docs/SUPABASE_INTEGRATION_TEST_PLAN.md` T4–T5.

**Rotation:** to rotate the secret, change it in both places. To rotate the database password, run `alter role pies_automation password '<new>'` and update the env. Emergency stop: `update public.automation_integrations set enabled = false;` or `alter role pies_automation nologin;`.

## 4. Provider spending limits (before enabling any paid provider, Phase 2)

1. In each provider dashboard, set a hard monthly limit at or below its category cap and **turn off auto-recharge**.
2. Add a `provider_configs` row with the pricing page URL and date.
3. Turn on `paid_operations_enabled` only after that.

## 5. Gmail (Phase 3, not approved)

Recommended: no OAuth (compose links). If you choose OAuth, read SECURITY.md → Gmail first.

## 6. Hosting

Not chosen. ARCHITECTURE.md → Hosting lists the options.
