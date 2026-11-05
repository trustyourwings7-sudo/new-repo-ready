# Intelligence Infrastructure (prepared 2026-11-05, updated same day)

> **Update:** with the owner's approval, Exa, Tavily, Firecrawl and Supabase (read-only, docs-only) are now configured with keys referenced as environment variables only. Eight irrelevant plugins are disabled for this project (failing servers about 45 → 0), and Composio is denied. Step-by-step evidence is in [INTEGRATION_LOG.md](INTEGRATION_LOG.md). They become usable after the owner allowlists their hosts and adds free keys as environment variables.

**Supabase upgrade path:** once a *development* project exists, change the URL to `…?project_ref=<dev-ref>&read_only=true&features=docs,database`. Never use a production project, never drop `read_only`, and update the test in `tests/intelligence-config.test.ts` in the same commit.

Scope: developer and research tooling for **Claude Code sessions working on PIES**. This is not PIES runtime: nothing here runs on a schedule, holds a database credential, or is part of the deployed app. Phase 2 has not started, and no agent is active.

## 1. Inventory (inspected in this cloud session)

| Item | State | Notes |
|---|---|---|
| Built-in WebSearch / WebFetch | Available | Free under your Claude plan; the main research path |
| GitHub MCP (official, via the Claude GitHub integration) | Connected, scoped to this repo | Merge, auto-merge and delete-file are now denied |
| n8n MCP | Connected; 0 workflows, 0 credentials | Publish, execute, agent creation and community-node install are denied |
| Gmail connector + Google Drive/Calendar (plugin) | Connected | **The Gmail connector exposes send/reply/forward tools.** Now denied for this repo |
| Canva, Adobe, Claude Docs, Composio | Connected | Not used by PIES. Composio is a broad third-party tool gateway; consider disconnecting it if unused |
| ~45 plugin servers (financial-advisor, brand-voice, productivity suites) | Failing (proxy 403) | Not relevant to PIES. Disabling unused plugins in claude.ai reduces noise and attack surface |
| Claude in Chrome | **Not available in this cloud session** | It only works in Claude Code on your own computer with the Chrome extension |
| Project MCP config / project skills | **None existed** | Created in this change |

**Overlaps:**
- Exa and Tavily overlap with the built-in WebSearch.
- Firecrawl overlaps with WebFetch + Playwright, and with the n8n gateway Firecrawl node (banned by the workflow auditor).
- Gmail is reachable two ways: the connector and the plugin.
- GitHub MCP is already provided.

## 2. Evaluation

Package ownership was verified from the npm registry, where each package names its source repository. GitHub repository pages themselves were not readable from this session (repository scope). Pricing comes from web search; the official pricing pages were **unreachable from this session's network**, so every price is at best [Likely].

| Integration | Official source | Auth | Price (best evidence) | Security notes | Decision |
|---|---|---|---|---|---|
| **Context7** | `@upstash/context7-mcp` → github.com/upstash/context7 (Upstash maintainers) | None required; free key optional | Free tier with rate limits; the exact quota is disputed (60/hr to 1,000/month) [Guessing]; Pro about $7–10/seat [Guessing] | Read-only docs lookup; sends library names and your query text to context7.com | **Configured** (keyless, pinned 4.4.4) |
| **Playwright MCP** | `@playwright/mcp` → github.com/microsoft/playwright-mcp (Microsoft maintainers) | None | Free, open source, local | Can browse any site (prompt-injection exposure) and has code-execution tools; origin filters are "not a security boundary" per its docs | **Configured** (pinned 0.0.83, `--headless --isolated`; code-exec and file-upload tools denied) |
| **GitHub MCP** | Official GitHub MCP; the old `@modelcontextprotocol/server-github` npm package is **deprecated** | Already provided via Claude's GitHub app | Free | Write tools exist | **Not added** (already present); destructive tools denied |
| **Supabase MCP** | `@supabase/mcp-server-supabase` → github.com/supabase/mcp (official) | Supabase account login (OAuth/PAT) | Free | Full mode can run arbitrary SQL. Even `read_only` mode exposes all rows, including your profile, to the model. Supabase advises dev projects only and warns about prompt injection | **Not configured.** Conflicts with "never unrestricted DB access". Revisit only as `read_only=true&project_ref=<dev>&features=docs`, with your login and approval |
| **Exa** | `exa-mcp-server` → github.com/exa-labs/exa-mcp-server | API key (signup) | $10/month free credits, no card [Likely]; about $7 per 1,000 searches after that [Likely]; pricing changed twice in 2026 | Third-party search; queries leave your machine | **Not activated.** Needs your signup; overlaps WebSearch |
| **Tavily** | `tavily-mcp` → github.com/tavily-ai/tavily-mcp | API key (signup) | 1,000 credits/month free, no card [Likely, Tavily docs via search]; $0.008/credit only if pay-as-you-go is enabled | Same as Exa | **Not activated.** Best candidate if PIES needs a search API in Phase 2, used through the PIES governor rather than as an MCP server |
| **Firecrawl** | `firecrawl-mcp` → github.com/firecrawl/firecrawl-mcp-server | API key (signup) | Free plan conflicting (500 one-time vs 1,000/month) [Guessing]; Hobby about $16–19/month | Crawls at scale; ToS and robots responsibility is yours | **Blocked** until the official price is read; WebFetch + Playwright cover current needs |

## 3. What was configured (all free, keyless, no secrets)

| File | Purpose |
|---|---|
| `/.mcp.json` (repo root) | Context7 + Playwright MCP, exact versions, no env, no keys |
| `/.claude/settings.json` (repo root) | Pre-enables only those two servers. **Denies:** Gmail send/reply/forward/trash/delete-draft; n8n publish/execute/agent/community-node; GitHub merge/auto-merge/delete; Playwright code-exec/evaluate/file-upload; reading `.env*` secrets and Claude credentials |
| `/.gitignore` (repo root) | Ignores Playwright output and local settings |
| `pies/.claude/skills/*` | 10 PIES skills (below) |
| `pies/scripts/mcp-smoke-test.mjs` | MCP stdio client that tests the real config |
| `pies/scripts/audit-n8n-workflow.ts` | Command-line wrapper for the n8n workflow auditor |
| `pies/scripts/check-ui-overflow.mjs` | Phone and desktop overflow check |
| `pies/tests/intelligence-config.test.ts` | Locks skills, MCP config and deny rules (40 tests) |

The root files are new. No Shemmaa or JAMOF file was touched.

## 4. The ten PIES skills

No list of "ten proposed skills" existed in the repository or the conversation, so these are **my proposal**, matched to the seven agent roles plus three development gates. Rename or replace any of them.

| Skill | Role |
|---|---|
| `opportunity-research` | Official-source discovery with quoted evidence → `pies/intel/` |
| `opportunity-qualification` | Fixed 100-point rubric, eligibility overrides, labelled estimates |
| `contact-research` | Public business contacts with source URLs; no guessed emails |
| `outreach-drafting` | Unsent drafts + Gmail compose link; you press Send |
| `lead-prospecting` | Schools, clinics, travel, hospitality; evidence-based pain points |
| `daily-briefing` | Read-only summary; never claims live data |
| `budget-guard` | Official-price verification before any paid service |
| `security-review` | The commit gate: tests, migration rules, secrets, isolation |
| `n8n-workflow-review` | Auditor + manual checks before any workflow is published |
| `ui-verification` | Playwright MCP checks of the PIES interface |

Research output is written to `pies/intel/`, which is git-ignored because it may name real people.

## 5. Tests run

| Test | Result |
|---|---|
| Playwright MCP via `/.mcp.json`: handshake, 25 tools, `browser_navigate` to local PIES `/login` and `/budget` | **Pass** (real browser, real server) |
| Context7 MCP: handshake, 2 tools listed | **Pass** |
| Context7 lookup (`resolve-library-id`) | **Fail in this session**: `fetch failed`, because the network policy blocks context7.com. Expected to work where that host is allowed [Likely] |
| n8n auditor command line: clean workflow → exit 0; bad workflow → 3 findings, exit 1 | **Pass** |
| Overflow script: 6 pages × 2 widths | **Pass** |
| Unit tests (incl. 40 new config tests) | **104 pass** |
| Whether Claude Code actually loads the skills and enforces the deny rules | **Not testable from inside this session.** It takes effect in the next session; check that `/skills` lists them |

## 6. Needs you

| Item | Why | Cost |
|---|---|---|
| Allow `context7.com` (and `mcp.context7.com`) in this cloud environment's Network access settings, or use Claude Code locally | Context7 lookups are blocked here | $0 |
| Claude in Chrome | Only in Claude Code on your computer; not reachable from cloud sessions | $0 |
| Exa / Tavily / Firecrawl keys | Each needs your signup. **Not recommended now**: WebSearch covers Phase 1.5 research | $0 on free tiers if no card is added; uncertain beyond that |
| Supabase MCP | Needs your login and conflicts with the no-unrestricted-DB rule | $0, **not recommended** |
| Disconnect unused connectors (Composio, failing plugins) | Smaller attack surface | $0 |

**Monthly cost of everything configured: $0.00.** [Certain] Nothing paid was signed up for, enabled or connected.
