import { getText, type FetchLike } from "./http.ts";

/**
 * Minimal robots.txt check (RFC 9309 subset): groups for "*" and our agent,
 * longest-match Allow/Disallow. Policy when robots.txt cannot be fetched:
 * 4xx = no restrictions (per RFC), 5xx/network failure = disallow (fail closed).
 */
export const PIES_AGENT = "pies-research";

export function isAllowedByRobots(robotsTxt: string, path: string, agent = PIES_AGENT): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const r of applicable.flatMap((g) => g.rules)) {
    if (matches(r.pattern, path) && (!best || r.pattern.length > best.len || (r.pattern.length === best.len && r.allow))) {
      best = { allow: r.allow, len: r.pattern.length };
    }
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

export class RobotsPolicy {
  private cache = new Map<string, string | "deny-all" | "allow-all">();
  private readonly fetchImpl: FetchLike | undefined;
  constructor(fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl;
  }

  async allowed(url: string): Promise<boolean> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const origin = u.origin;
    if (!this.cache.has(origin)) {
      const res = await getText(`${origin}/robots.txt`, this.fetchImpl);
      if (!res || res.status >= 500) this.cache.set(origin, "deny-all");
      else if (res.status >= 400) this.cache.set(origin, "allow-all");
      else this.cache.set(origin, res.text);
    }
    const entry = this.cache.get(origin)!;
    if (entry === "deny-all") return false;
    if (entry === "allow-all") return true;
    return isAllowedByRobots(entry, u.pathname + u.search);
  }
}
