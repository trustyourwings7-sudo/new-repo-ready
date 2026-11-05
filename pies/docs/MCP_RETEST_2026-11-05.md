# MCP retest, 2026-11-05 (second session)

Retest of every MCP server per `pies/docs/INTEGRATION_LOG.md` (branch `claude/upbeat-carson-2prwrq`).
Rows continue that log's numbering and status keys: ✅ verified · ⚠️ partial · ❌ failed · 🔒 needs owner.

**Headline:** this session started on `claude/funny-turing-yx41kh`, which has no `pies/`, `.mcp.json` or `.claude/settings.json`.
The project config (6 servers, deny rules, plugin disables) therefore **did not load**. Open item 5 of the log is still unmet.
Stdio servers were tested out-of-band from a scratch worktree of the PIES branch with `pies/scripts/mcp-smoke-test.mjs`.

| # | Step | Result | Evidence / fix |
|---|---|---|---|
| 27 | Session branch check | ❌ wrong branch: PIES config absent | 🔒 Start the next session **on `claude/upbeat-carson-2prwrq`**, or merge it into the branch sessions start on |
| 28 | Env keys `CONTEXT7_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY` | ❌ all missing | 🔒 Open item 2 not done |
| 29 | Network: `api.exa.ai`, `mcp.exa.ai`, `api.tavily.com`, `mcp.supabase.com`, `api.supabase.com` | ✅ now reachable (were `connect_rejected` at step 3) | `curl` + proxy status |
| 30 | Network: `context7.com`, `mcp.context7.com` | ❌ **regressed**: now `connect_rejected` (was ✅ at step 1) | 🔒 Allowlist edit probably replaced instead of appended; re-add both |
| 31 | Network: `api.firecrawl.dev`, `mcp.firecrawl.dev`, `mcp.tavily.com` | ❌ `connect_rejected` | 🔒 Add `api.firecrawl.dev` (stdio server needs it) |
| 32 | `mco.context7.com` typo | ✅ still rejected/nonexistent | Remove from list if present |
| 33 | Stdio handshake + tools/list | ✅ context7 4.4.4 (2), playwright 0.0.83 (25), exa 3.4.2 (2), tavily 0.2.22 (5), firecrawl 3.33.4 (**26**, was 28) | smoke test |
| 34 | Firecrawl tool diff | ⚠️ 26 tools now; new: `firecrawl_monitor_delete`, `_checks`, `_check`, research/dev/gov search, `credit_usage` | Deny list still covers crawl/agent/interact/monitor create-update-run. Consider denying `firecrawl_monitor_delete` too |
| 35 | Context7 live `resolve-library-id` | ❌ timed out | Caused by step 30 |
| 36 | Tavily live `tavily_search` (placeholder key) | ⚠️ reached the API end to end, got `401 Unauthorized: missing or invalid API key` | Path works; only the key is missing (step 28) |
| 37 | Supabase remote MCP `initialize` | ⚠️ `401` + `WWW-Authenticate` OAuth metadata | Correct behaviour. Needs OAuth approval in an interactive `/mcp` once the project config loads |
| 38 | claude.ai connector **Exa** live search | ✅ returned nextjs.org `proxy.js` docs | Works with **no API key**. Option: drop the stdio Exa server and use the connector |
| 39 | claude.ai connector **Firecrawl** live search | ✅ 1 result, 2 credits used | Same: works without a local key. Billed against the connected account |
| 40 | GitHub MCP `get_me` | ✅ `trustyourwings7-sudo` | |
| 41 | Gmail `list_labels` (read only) | ✅ | Send/reply/forward deny rules **not active** this session (step 27) |
| 42 | Google Drive `list_recent_files` | ✅ | |
| 43 | Canva `help` | ✅ | |
| 44 | Adobe `adobe_mandatory_init` | ✅ | |
| 45 | Google Calendar (financial-advisors plugin) | ❌ `Incompatible auth server: does not support dynamic client registration` | Moot once that plugin is disabled |
| 46 | n8n connector | ❌ 404 `CLIENT_HTTP_NOT_IMPLEMENTED` | 🔒 Reconnect n8n in claude.ai → Settings → Connectors, or remove it |
| 47 | Plugin MCP servers (financial-advisors, brand-voice, operations, productivity…) | ❌ ~48 fail with proxy 403 | Expected: plugin disables in `.claude/settings.json` did not load (step 27). Not a regression |
| 48 | Composio | ✅ no Composio tools present in this session | Appears disconnected at account level (open item 4 done, or unavailable) |

## Owner actions, in priority order

1. Start the next session on `claude/upbeat-carson-2prwrq` (or merge it). Without that, steps 41 and 47 stay unsafe and noisy.
2. Network allowlist: re-add `context7.com` and `mcp.context7.com`, add `api.firecrawl.dev`.
3. Add the four keys as environment variables. **Or decide first:** Exa and Firecrawl already work as claude.ai connectors with no key (steps 38–39). Keeping both routes doubles the tool surface and the deny rules you have to maintain.
4. Fix or remove the n8n connector.
