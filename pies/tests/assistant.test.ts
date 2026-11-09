import { describe, expect, it } from "vitest";
import { explainStop } from "../src/lib/assistant/explain";
import { cleanQuery, parseIntent } from "../src/lib/assistant/intent";

describe("command chat: intent parsing (no AI, no network)", () => {
  it.each([
    ["Find scholarships in Canada", { kind: "research", query: "scholarships in Canada", category: "scholarship" }],
    ["find me grants in Germany for youth", { kind: "research", query: "grants in Germany for youth", category: "grant" }],
    ["search for master's programmes in Belgium", { kind: "research", query: "master's programmes in Belgium", category: "education" }],
    ["Research now", { kind: "research", query: null, category: "scholarship" }],
    ["run research", { kind: "research", query: null, category: "scholarship" }],
    ["Show my deadlines", { kind: "deadlines" }],
    ["what's due?", { kind: "deadlines" }],
    ["Explain why today's research failed", { kind: "diagnose" }],
    ["diagnose research", { kind: "diagnose" }],
    ["why did research return nothing", { kind: "diagnose" }],
    ["Check PIES health", { kind: "health" }],
    ["show my budget", { kind: "budget" }],
    ["how much have I spent", { kind: "budget" }],
    ["research status", { kind: "status" }],
    ["show my tasks", { kind: "tasks" }],
    ["show opportunities about Canada", { kind: "opportunities", search: "Canada" }],
    ["show scholarships", { kind: "opportunities", search: null }],
    ["find my opportunities", { kind: "opportunities", search: null }],
    ["show contacts at Maastricht University", { kind: "contacts", search: "Maastricht University" }],
    ["help", { kind: "help" }],
    ["tell me a joke", { kind: "help" }],
  ])("%s", (input, expected) => {
    expect(parseIntent(input)).toEqual(expected);
  });

  it("never passes unsafe characters to research", () => {
    expect(cleanQuery("grants; rm -rf / $(id) `x`")).toBe("grants rm -rf / (id) x");
    expect(cleanQuery("<script>")).toBe("script");
    expect(cleanQuery("!!")).toBeNull();
    const i = parseIntent("find grants $(curl evil) in Kenya");
    expect(i.kind).toBe("research");
    if (i.kind === "research") expect(i.query).not.toMatch(/[$`;<>|]/);
  });

  it("caps research queries at 120 characters", () => {
    const i = parseIntent(`find ${"scholarship ".repeat(30)}`);
    expect(i.kind).toBe("research");
    if (i.kind === "research") expect(i.query!.length).toBeLessThanOrEqual(120);
  });
});

describe("diagnosis: stop reasons become causes and fixes", () => {
  it.each([
    ["budget: paid_operations_disabled", "warn"],
    ["paused: paid operations are off", "warn"],
    ["budget: duplicate_operation", "ok"],
    ["budget: provider_limit_reached", "warn"],
    ["exa: unauthorized (HTTP 401)", "bad"],
    ["firecrawl: quota_exhausted (HTTP 402)", "bad"],
    ["per-run cap reached", "ok"],
    ["all candidates failed", "warn"],
  ])("%s", (reason, tone) => {
    const f = explainStop(reason);
    expect(f?.tone).toBe(tone);
    expect(f?.fix.length).toBeGreaterThan(5);
  });
  it("returns null for unknown reasons instead of guessing", () => {
    expect(explainStop("something new")).toBeNull();
  });
});
