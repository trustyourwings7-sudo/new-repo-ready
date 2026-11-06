# Integration Log: intelligence tooling

Every step, result, failure and fix, in order. Status: ✅ verified · ⚠️ partial · ❌ failed · 🔒 needs owner.

## Session 2026-11-05

| # | Step | Result | Evidence / fix |
|---|---|---|---|
| 1 | Retest network after owner allowlisted Context7 domains | ✅ `context7.com` 200, `mcp.context7.com` responding (404 on `/` is normal) | `curl` probes |
| 2 | Check the second domain the owner typed, `mco.context7.com` | ❌ does not exist (DNS failure) | Typo of `mcp.context7.com`; remove it from Allowed domains |
| 3 | Recheck Exa, Tavily, Firecrawl and Supabase hosts | ❌ all `connect_rejected` by the environment network policy | 🔒 The owner must allow: `api.exa.ai`, `mcp.exa.ai`, `api.tavily.com`, `api.firecrawl.dev`, `mcp.supabase.com`, `api.supabase.com` |
| 4 | Context7 live: `resolve-library-id("Next.js")` | ✅ returned `/vercel/next.js` with versions | MCP tool call in session |
| 5 | Context7 live: `query-docs` on Next.js 16 `proxy.ts` | ✅ official docs; confirmed `pies/src/proxy.ts` uses the correct `export function proxy` + `config.matcher` | Converts a Phase 1 [Likely] into verified |
| 6 | Context7: further lookups | ❌ **"Monthly quota exceeded"** after 4 keyless calls (shared cloud egress) | Fix: `.mcp.json` now passes `CONTEXT7_API_KEY` (optional, `${CONTEXT7_API_KEY:-}`). 🔒 The owner creates a free key |
| 7 | Claude in Chrome | ❌ unavailable: no `mcp__claude-in-chrome__*` or enable tool exists in a cloud session | It only connects to Claude Code on the owner's computer with the extension. Not fixable from the cloud |
| 8 | Create API keys in the owner's Exa, Tavily, Firecrawl and Supabase accounts | ❌ impossible from here | The owner's sign-ins live in their browser; this container cannot reach it (see 7). Keys must never be pasted in chat |
| 9 | Inventory plugins | ✅ 11 synced plugins; 8 bring irrelevant or failing servers | `claude plugin list` |
| 10 | Disable irrelevant plugins (project scope) | ✅ disabled: claude-for-financial-advisors, productivity, brand-voice, data, enterprise-search, video-cleanup, cowork-plugin-management, operations | Written to `/.claude/settings.json` `enabledPlugins` |
| 11 | Recount failing MCP servers | ✅ about 45 → 4 → **0** | First pass left 4 from `operations` (shared Slack/Notion/Atlassian/Asana); disabled it too |
| 12 | Composio (broad gateway incl. remote bash) | ✅ blocked for this repo with server-wide deny `mcp__Composio`; the session dropped all 12 Composio tools at once | 🔒 Full disconnect is account-level: claude.ai → Settings → Connectors |
| 13 | Second Gmail route (financial-advisors plugin) | ✅ removed with the plugin | The Gmail connector's send/reply/forward stay denied |
| 14 | Pick pinned versions (≥ 2 weeks old) | ✅ exa-mcp-server 3.4.2, tavily-mcp 0.2.22, firecrawl-mcp 3.33.4 | npm publish dates |
| 15 | Start each stdio server (placeholder key) and list tools | ✅ Exa 2 tools; Tavily 5; Firecrawl 28 | MCP handshake. Real calls are impossible until step 3 is unblocked and keys exist |
| 16 | Identify credit-burning or autonomous tools | ✅ Tavily crawl/research; Firecrawl crawl/agent/interact/monitor create-update-run | Denied in `/.claude/settings.json` (monitors = recurring jobs = autonomous) |
| 17 | Verify `${VAR}` expansion syntax in `.mcp.json` | ⚠️ `claude mcp get` shows raw text only (inconclusive) | Fix: a probe server showed Claude Code validates the syntax and warns **"Missing environment variables: X"**; the `:-default` form is accepted |
| 18 | Run the probe through Claude Code to see the expanded values | ⚠️ the probe never ran: new project servers stay "Pending approval" until the first interactive launch | Expected security behaviour. Approve on first launch (`/mcp`) |
| 19 | Supabase MCP form | ✅ chosen: official remote `https://mcp.supabase.com/mcp?read_only=true&features=docs` (sign-in via OAuth; no stored token; **no database or account tools**) | The stdio form needs a personal access token with full account power, so it was rejected. Upgrade path in INTELLIGENCE_INFRASTRUCTURE.md |
| 20 | Supabase: create an organization | ❌ needs the owner's dashboard session, and the host is blocked (step 3) | 🔒 Owner: supabase.com/dashboard → New organization (Free plan) |
| 21 | `claude mcp list` after config | ✅ 6 servers, 0 failing; warnings only for the 3 missing keys | Expected until keys are added |
| 22 | Config tests updated (only `${VAR}` secrets, Supabase read-only + docs, deny list, disabled plugins) | ✅ 116/116 unit tests pass | `pnpm test` |
| 23 | Mutation: paste a literal key into `.mcp.json` | ✅ the test fails as intended; config restored | Proves the secret guard works |
| 25 | `pies:security-review` gate (skill used in-session) | ✅ pnpm check exit 0 (116 unit, DB, concurrency, 16 prod checks, e2e); no migrations changed; secret scan clean; no `.env`; no service-role; Shemmaa/research untouched | Gate output in session |
| 26 | `budget-guard` decision for new services | ✅ APPROVED-FREE **on condition that no payment method is added** to Exa, Tavily, Firecrawl or Context7; Supabase Free org/project only | Monthly incremental cost: $0.00 |
| 24 | Skill discovery | ✅ all 10 skills discovered by Claude Code in this session; `security-review` appears as `pies:security-review` (a built-in has the same name) | Session skill list |

## Open items (owner)

1. Environment settings → Network access → Allowed domains: remove `mco.context7.com`; add the hosts in step 3.
2. Create free keys (no card, Free plan only) and add them as **environment variables** in the environment settings: `CONTEXT7_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`. Never paste them in chat.
3. Supabase: create a Free organization and a project for PIES (the next phase needs it anyway).
4. claude.ai → Settings → Connectors: disconnect Composio if unused.
5. Start a **new session** in this repo so the plugin changes, deny rules and keys take effect. Then ask for: "retest all MCP servers per pies/docs/INTEGRATION_LOG.md".

## Session 2026-11-05 (second): retest, consolidation, enforcement

Rows 27–48 are in `docs/MCP_RETEST_2026-11-05.md`. Rows below continue from there.

| # | Step | Result | Evidence / fix |
|---|---|---|---|
| 49 | Branch topology | ✅ `upbeat-carson` (PIES, 4 commits) and `funny-turing` (retest report, 1 commit) both fork from `fc17c83` = repo default branch `claude/inspiring-pasteur-hpkrv2`; no file overlap | `git merge-base`, `comm` on changed files |
| 50 | Consolidate | ✅ `--no-ff` merge of `upbeat-carson` into `claude/funny-turing-yx41kh`; both histories kept; default branch untouched | merge commit `4f6c77a` |
| 51 | Session type | ✅ single-repo **cloud session** (`origin web_claude_ai`, `anthropic_cloud`, auto mode), not a project thread | `get_session`; docs: repo `.claude/settings.json` and `.mcp.json` apply in this type only |
| 52 | Deny rules enforced? | ✅ yes, live: on merge the session removed Gmail send/reply/forward/trash/delete_draft and GitHub merge/auto-merge/delete_file; after adding `mcp__Gmail__*` all 24 Gmail tools vanished | harness tool-removal notices |
| 53 | `.env` read deny | ✅ `Read` and `cat` both refused on a dummy `pies/.env` (fake value, deleted after) | Docs: a script opening the file itself is **not** covered; not an OS boundary |
| 54 | Plugin disables (`enabledPlugins: false`) | ⚠️ not applied live; ~50 plugin servers still listed. Docs: cloud sessions don't install repo-declared plugins; synced plugins come from the claude.ai account | 🔒 Disable unused plugins at account level, or recheck in a fresh session |
| 55 | Scheduled tasks | ❌ **risk**: 1 enabled daily task (`trig_011oqFZEoLw6qgd7UwWikfc4`, other repo `my-personal-files`, Gmail drafts, n8n). Scheduled runs include all connectors by default and clone the default branch, so this repo's rules never protect them | 🔒 Owner decision (see final report) |
| 56 | Gmail in unattended sessions | ⚠️ denied for every session of **this repo** that loads the settings. Not enforceable for other repos/default branch from here | 🔒 claude.ai → Connectors → Gmail: turn off send/reply/forward tools, or remove Gmail from the scheduled task |
| 57 | Risky connectors inventoried | ✅ denied: Calendar (whole), Drive share/trash, Adobe invite/share/Stock licence/acrobat_proxy/boards_delete/font kits/generative expand, Canva comment/reply/publish/generate, GitHub create/fork repo, push_files, create_or_update_file, actions_run_trigger, claude-code-remote create_session/create_trigger/fire_trigger/send_message/send_later/computer folder/trust/watch_url, n8n delete/credential, Exa agent_run, Firecrawl agent/crawl/monitor/interact | `.claude/settings.json`; tests |
| 58 | Metered calls | ✅ `ask` (prompts even in auto mode): Exa search/fetch, Firecrawl search/scrape/developer/research, Drive create/copy/update, GitHub comments/issues/PRs/reviews, trigger update/delete, Docs delete | |
| 59 | Duplicates removed | ✅ `.mcp.json` now: context7, playwright, supabase. Exa/Firecrawl via claude.ai connectors; Tavily removed (no demonstrated need, needs a key) | tests updated first (40 red → green) |
| 60 | Context7 | ❌ network policy: gateway 403 on CONNECT to `context7.com`, `mcp.context7.com`. One environment exists (`Default`), so the allowlist itself changed between sessions | 🔒 Environment → Network access → Allowed domains: add both, keep "Allow package managers" ticked |
| 61 | n8n | ❌ connector returns 404 via Anthropic's MCP proxy (`CLIENT_HTTP_NOT_IMPLEMENTED`). It worked 2026-11-04 07:47Z for one write, then dropped; failed all of 2026-11-05 | 🔒 Probable n8n-side change (instance MCP access disabled, token rotated, or instance stopped). Check n8n Settings → MCP access, then reconnect the connector. No workflows or credentials touched |
| 62 | Supabase | ⚠️ unchanged: OAuth pending; deliberately not connected | Do not approve OAuth until the Supabase phase |
| 63 | Budget (budget-guard) | see final report table | |
| 64 | Skills | ✅ all 10 discovered after touching `pies/` | session notice |
| 65 | Tests | ✅ 155/155 unit tests | `pnpm test` |

## Session 2026-11-06: real Supabase (project `pies`, eu-west-2, Postgres 17.11, Free plan)

| # | Step | Result | Evidence / fix |
|---|---|---|---|
| 66 | Free-plan slot | ✅ owner deleted unused projects in other orgs; `pies` org is Free | `get_organization` → plan free |
| 67 | Supabase connector guardrail | ✅ ask on SQL/migrations/project changes; deny branches, edge functions | commit 9932eb9; 8 tools removed live |
| 68 | T1 apply migrations 1–5 via connector (owner approved each) | ✅ all succeeded; `create role pies_automation` works on Supabase | `apply_migration` |
| 69 | T2/T3 `production_checks.sql` | ✅ checks 1–15 `ok = true`; 16 = login not yet enabled (expected) | `execute_sql` |
| 70 | Copy fidelity | ✅ functions (35), columns, constraints (188), policies, triggers fingerprints **identical** to a local build from the files | md5 fingerprint query, both sides |
| 71 | Supabase security advisor | ⚠️ 1 WARN (lint 0029): the 5 intended SECURITY DEFINER functions callable by `authenticated`; each has an owner check. Intended, no change | `get_advisors` |
| 72 | Remaining Phase A | 🔒 owner: auth lockdown, owner user, DB password reset, `pies_automation` login, T4 restricted-login proof | LAUNCH_PLAN.md A2, A5, A7 |
