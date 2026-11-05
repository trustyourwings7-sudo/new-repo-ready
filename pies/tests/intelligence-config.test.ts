import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PIES = path.join(__dirname, "..");
const REPO = path.join(PIES, "..");
const SKILLS_DIR = path.join(PIES, ".claude/skills");
const mcp = JSON.parse(readFileSync(path.join(REPO, ".mcp.json"), "utf8"));
const settings = JSON.parse(readFileSync(path.join(REPO, ".claude/settings.json"), "utf8"));

const EXPECTED_SKILLS = [
  "budget-guard", "contact-research", "daily-briefing", "lead-prospecting", "n8n-workflow-review",
  "opportunity-qualification", "opportunity-research", "outreach-drafting", "security-review", "ui-verification",
];

function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m?.[1]) return {};
  return Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
}

describe("PIES skills", () => {
  it("has exactly the ten PIES skills", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual(EXPECTED_SKILLS);
  });

  it.each(EXPECTED_SKILLS)("%s has valid frontmatter and body", (name) => {
    const md = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const fm = frontmatter(md);
    expect(fm.name).toBe(name);
    expect(fm.description?.length ?? 0).toBeGreaterThan(60);
    expect(fm.description?.length ?? 0).toBeLessThan(500);
    expect(md.length).toBeGreaterThan(600);
  });

  it.each(EXPECTED_SKILLS)("%s references only scripts that exist", (name) => {
    const md = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    for (const m of md.matchAll(/scripts\/[\w.-]+\.(?:mjs|ts|sh)/g)) {
      expect(existsSync(path.join(PIES, m[0])), `${name}: ${m[0]}`).toBe(true);
    }
  });

  it("no skill tells Claude to send, purchase or publish", () => {
    for (const name of EXPECTED_SKILLS) {
      const md = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8").toLowerCase();
      expect(md, name).not.toMatch(/\b(call|use) (the )?(mcp__gmail__send_message|send_message)\b/);
      expect(md, name).not.toMatch(/publish_workflow\(|publish_agent\(|buy credits now|enter (your )?card/);
    }
    // The outreach skill must state the prohibition explicitly.
    expect(readFileSync(path.join(SKILLS_DIR, "outreach-drafting/SKILL.md"), "utf8")).toMatch(/Never send, reply, forward or schedule email/);
  });
});

describe("MCP configuration", () => {
  type Server = { command?: string; args?: string[]; env?: Record<string, string>; headers?: unknown; url?: string; type?: string };
  const servers = mcp.mcpServers as Record<string, Server>;

  it("contains only the approved servers", () => {
    // Exa and Firecrawl come from the claude.ai connectors; local duplicates and keyed Tavily were removed (2026-11-05).
    expect(Object.keys(servers).sort()).toEqual(["context7", "playwright", "supabase"]);
  });

  it("pins exact package versions for every stdio server", () => {
    for (const [name, s] of Object.entries(servers)) {
      if (s.type === "http") continue;
      const pkg = (s.args ?? []).find((a) => /^(@[\w-]+\/)?[\w.-]+@/.test(a));
      expect(pkg, name).toMatch(/@\d+\.\d+\.\d+$/);
    }
  });

  it("references secrets only as ${ENV_VAR}; no literal key anywhere", () => {
    for (const [name, s] of Object.entries(servers)) {
      for (const [k, v] of Object.entries(s.env ?? {})) {
        expect(v, `${name}.${k}`).toMatch(/^\$\{[A-Z0-9_]+(:-)?\}$/);
      }
      expect(s.headers, name).toBeUndefined();
      const flat = JSON.stringify({ ...s, env: undefined });
      expect(flat, name).not.toMatch(/api[_-]?key=|token=|secret|password|bearer|sk-|fc-|tvly-/i);
    }
  });

  it("Supabase MCP is read-only, docs-only, with no project or account access", () => {
    const u = new URL(servers.supabase!.url!);
    expect(u.origin).toBe("https://mcp.supabase.com");
    expect(u.searchParams.get("read_only")).toBe("true");
    expect(u.searchParams.get("features")).toBe("docs");
    expect(u.searchParams.has("project_ref")).toBe(false);
  });

  it("runs Playwright headless with an isolated (in-memory) profile", () => {
    const args: string[] = servers.playwright!.args!;
    expect(args).toContain("--headless");
    expect(args).toContain("--isolated");
  });
});

describe("Claude Code permission guardrails", () => {
  const deny: string[] = settings.permissions.deny;
  it.each([
    "mcp__Gmail__send_message", "mcp__Gmail__reply", "mcp__Gmail__forward",
    "mcp__n8n__publish_workflow", "mcp__n8n__publish_agent", "mcp__n8n__create_agent", "mcp__n8n__call_agent", "mcp__n8n__execute_workflow",
    "mcp__github__merge_pull_request",
    "mcp__playwright__browser_run_code_unsafe", "mcp__playwright__browser_evaluate", "mcp__playwright__browser_file_upload",
    "Read(./**/.env)", "Read(./**/.env.local)",
    "mcp__Composio",
    "mcp__tavily__tavily_crawl", "mcp__tavily__tavily_research",
    "mcp__firecrawl__firecrawl_crawl", "mcp__firecrawl__firecrawl_agent", "mcp__firecrawl__firecrawl_interact",
    "mcp__firecrawl__firecrawl_monitor_create", "mcp__firecrawl__firecrawl_monitor_update", "mcp__firecrawl__firecrawl_monitor_run",
  ])("denies %s", (rule) => {
    expect(deny).toContain(rule);
  });

  // Whole servers removed from Claude's context: Gmail (unattended-send risk), Calendar (sends invites).
  it.each(["mcp__Gmail__*", "mcp__plugin_claude-for-financial-advisors_google-calendar__*"])("denies the whole server %s", (rule) => {
    expect(deny).toContain(rule);
  });

  // External communication, permission changes, purchases, destructive or autonomous actions.
  it.each([
    "mcp__Google_Drive__share_file", "mcp__Google_Drive__trash_file",
    "mcp__Adobe__asset_invite_collaborators", "mcp__Adobe__asset_share_link", "mcp__Adobe__asset_license_and_download_stock",
    "mcp__Adobe__acrobat_proxy", "mcp__Adobe__boards_delete",
    "mcp__Canva__comment-on-design", "mcp__Canva__reply-to-comment", "mcp__Canva__publish-brand-template",
    "mcp__github__create_repository", "mcp__github__fork_repository", "mcp__github__push_files", "mcp__github__actions_run_trigger",
    "mcp__claude-code-remote__create_session", "mcp__claude-code-remote__create_trigger", "mcp__claude-code-remote__fire_trigger",
    "mcp__claude-code-remote__send_message", "mcp__claude-code-remote__send_later", "mcp__claude-code-remote__request_computer_folder",
    "mcp__n8n__delete_*",
    "mcp__Exa__agent_run",
    "mcp__Firecrawl__firecrawl_agent*", "mcp__Firecrawl__firecrawl_crawl*", "mcp__Firecrawl__firecrawl_monitor*", "mcp__Firecrawl__firecrawl_interact*",
  ])("denies %s", (rule) => {
    expect(deny).toContain(rule);
  });

  // Metered calls prompt even in auto mode, so an unattended run cannot spend credits.
  it.each([
    "mcp__Exa__web_search_exa", "mcp__Exa__web_fetch_exa",
    "mcp__Firecrawl__firecrawl_search", "mcp__Firecrawl__firecrawl_scrape", "mcp__Firecrawl__firecrawl_developer_search",
    "mcp__Firecrawl__firecrawl_research_*",
    "mcp__github__add_issue_comment", "mcp__github__create_pull_request",
    "mcp__claude-code-remote__update_trigger", "mcp__claude-code-remote__delete_trigger",
  ])("asks before %s", (rule) => {
    expect(settings.permissions.ask).toContain(rule);
  });

  it("never puts a rule in both deny and ask", () => {
    const ask: string[] = settings.permissions.ask;
    expect(ask.filter((r) => deny.includes(r))).toEqual([]);
  });

  it("grants no blanket allow rules", () => {
    expect(settings.permissions.allow ?? []).toEqual([]);
    expect(settings.enableAllProjectMcpServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers.sort()).toEqual(Object.keys(mcp.mcpServers).sort());
  });

  it("keeps unrelated plugins (with failing or email-capable servers) disabled for this project", () => {
    for (const p of ["claude-for-financial-advisors", "productivity", "brand-voice", "data", "enterprise-search", "video-cleanup", "cowork-plugin-management", "operations"]) {
      expect(settings.enabledPlugins[`${p}@synced`], p).toBe(false);
    }
  });
});
