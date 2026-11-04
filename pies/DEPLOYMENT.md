# Deployment and Manual Setup

Nothing here has been done for you. Each step is free. None of them buys anything.

## 1. Create the Supabase project (about 10 minutes)

1. Create a free project at supabase.com. Pick a region close to you.
2. **Authentication → Providers → Email:** enable it.
3. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
4. **Authentication → Users → Add user:** create your owner account with your email.
5. **Authentication → URL Configuration:** set Site URL to your app URL (`http://localhost:3000` for local use) and add `<site>/auth/callback` to the redirect URLs.
6. **SQL Editor:** run the three files in `supabase/migrations/` in order. The Supabase CLI (`supabase db push`) works too.
7. **Project Settings → API:** copy the Project URL and the anon key.

## 2. Configure the app

```bash
cd pies
cp .env.example .env.local
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PIES_ALLOWED_EMAILS` (your email) and `PIES_SITE_URL`. Leave the AI, search and Gmail keys empty for now.

```bash
pnpm install
pnpm build
pnpm start
```

Sign in, open **Settings → Profile initialization** and click **Load initialization context**. This creates your profile, your preferences (paid operations off) and the starting facts, each marked *user asserted*.

## 3. First real test (please report the result)

- [ ] The magic link arrives and signs you in.
- [ ] Signing in with an address that is not on the allowlist fails.
- [ ] The dashboard shows zeros, not errors.
- [ ] The Budget page shows period, $10 cap and "disabled".
- [ ] "Load initialization context" reports success; a second click changes nothing.

## 4. Provider spending limits (before enabling any paid provider)

In each provider dashboard, set a hard monthly limit at or below the category cap and turn off auto-recharge. Then, in the database, add a `provider_configs` row with the verified pricing URL.

## 5. Hosting

Not chosen yet; see ARCHITECTURE.md → Hosting. Do not deploy publicly before items 1–4 in SECURITY.md "Known gaps" are reviewed.

## 6. n8n (Phase 2)

Workflows will be created through the connected n8n MCP after your approval. They will need a Supabase credential in n8n; see SECURITY.md gap 1 before creating it with the service-role key.
