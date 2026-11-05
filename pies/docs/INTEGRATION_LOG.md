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
