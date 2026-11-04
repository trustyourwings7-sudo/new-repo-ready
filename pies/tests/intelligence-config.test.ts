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
  it("contains only the approved free, keyless servers", () => {
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["context7", "playwright"]);
  });

  it("pins exact package versions and carries no secrets", () => {
    for (const [name, s] of Object.entries<{ command: string; args: string[]; env?: Record<string, string>; headers?: unknown; url?: string }>(mcp.mcpServers)) {
      const pkg = s.args.find((a) => a.startsWith("@"));
      expect(pkg, name).toMatch(/@\d+\.\d+\.\d+$/);
      expect(s.env, name).toBeUndefined();
      expect(s.headers, name).toBeUndefined();
      expect(JSON.stringify(s), name).not.toMatch(/api[_-]?key|token|secret|password|bearer/i);
    }
  });

  it("runs Playwright headless with an isolated (in-memory) profile", () => {
    const args: string[] = mcp.mcpServers.playwright.args;
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
  ])("denies %s", (rule) => {
    expect(deny).toContain(rule);
  });

  it("grants no blanket allow rules", () => {
    expect(settings.permissions.allow ?? []).toEqual([]);
    expect(settings.enableAllProjectMcpServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers.sort()).toEqual(Object.keys(mcp.mcpServers).sort());
  });
});
