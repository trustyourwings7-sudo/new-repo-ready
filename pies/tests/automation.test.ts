import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleAutomationRequest, type AutomationExecutor } from "@/lib/automation/handler";
import { AUTOMATION_OPERATIONS } from "@/lib/automation/operations";
import { signRequest, verifySignature } from "@/lib/automation/signature";
import { AGENT_CAPABILITIES } from "@/lib/permissions/catalog";

const SECRET = "s".repeat(40);
const INT = "11111111-0000-4000-8000-000000000001";
const NOW = 1_800_000_000;
const SQL5 = readFileSync(path.join(__dirname, "../supabase/migrations/20261105000005_automation_boundary.sql"), "utf8");

function req(body: unknown, opts: { secret?: string; integration?: string; ts?: number; contentType?: string | null; raw?: string } = {}) {
  const rawBody = opts.raw ?? JSON.stringify(body);
  const integration = opts.integration ?? INT;
  const ts = opts.ts ?? NOW;
  return {
    headers: { integration, timestamp: String(ts), signature: signRequest(opts.secret ?? SECRET, integration, ts, rawBody) },
    rawBody,
    contentType: opts.contentType === undefined ? "application/json" : opts.contentType,
  };
}
const valid = { request_id: "req-000001", agent: "discovery", operation: "run.start", payload: { workflow: "w" } };
const config = { secret: SECRET, integrationId: INT };

function exec(result: Record<string, unknown> = { ok: true }) {
  return vi.fn<AutomationExecutor>(async () => result);
}

describe("automation API: unauthorized requests never reach the database", () => {
  it("is disabled when not configured", async () => {
    const e = exec();
    expect((await handleAutomationRequest(req(valid), { secret: null, integrationId: INT }, e, NOW)).status).toBe(503);
    expect((await handleAutomationRequest(req(valid), { secret: "short", integrationId: INT }, e, NOW)).status).toBe(503);
    expect((await handleAutomationRequest(req(valid), config, null, NOW)).status).toBe(503);
    expect(e).not.toHaveBeenCalled();
  });

  it.each([
    ["missing signature", { ...req(valid), headers: { integration: INT, timestamp: String(NOW), signature: null } }],
    ["wrong secret", req(valid, { secret: "x".repeat(40) })],
    ["stale timestamp (replay)", req(valid, { ts: NOW - 301 })],
    ["future timestamp", req(valid, { ts: NOW + 301 })],
    ["unknown integration", req(valid, { integration: "22222222-0000-4000-8000-000000000002" })],
  ])("rejects %s with 401", async (_name, input) => {
    const e = exec();
    const r = await handleAutomationRequest(input, config, e, NOW);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ ok: false, error: "unauthorized" });
    expect(e).not.toHaveBeenCalled();
  });

  it("rejects a body modified after signing", async () => {
    const signed = req(valid);
    const tampered = { ...signed, rawBody: signed.rawBody.replace("run.start", "run.finish") };
    const e = exec();
    expect((await handleAutomationRequest(tampered, config, e, NOW)).status).toBe(401);
    expect(e).not.toHaveBeenCalled();
  });

  it("rejects oversized, non-JSON and malformed bodies", async () => {
    const e = exec();
    expect((await handleAutomationRequest(req(null, { raw: "x".repeat(33 * 1024) }), config, e, NOW)).status).toBe(413);
    expect((await handleAutomationRequest(req(valid, { contentType: "text/plain" }), config, e, NOW)).status).toBe(415);
    expect((await handleAutomationRequest(req(null, { raw: "{not json" }), config, e, NOW)).status).toBe(400);
    expect((await handleAutomationRequest(req({ ...valid, agent: "root" }), config, e, NOW)).status).toBe(400);
    expect((await handleAutomationRequest(req({ ...valid, user_id: "someone-else" }), config, e, NOW)).status).toBe(400);
    expect(e).not.toHaveBeenCalled();
  });

  it.each(["gmail.send", "gmail.drafts.send", "email.send", "budget.reserve", "approval.decide", "sql.execute"])(
    "refuses operation %s before the database",
    async (operation) => {
      const e = exec();
      const r = await handleAutomationRequest(req({ ...valid, agent: "outreach", operation }), config, e, NOW);
      expect(r).toEqual({ status: 404, body: { ok: false, error: "unknown_operation" } });
      expect(e).not.toHaveBeenCalled();
    },
  );

  it("passes a valid request through and maps database outcomes", async () => {
    const e = exec({ ok: true, run_id: "r1" });
    expect(await handleAutomationRequest(req(valid), config, e, NOW)).toEqual({ status: 200, body: { ok: true, run_id: "r1" } });
    expect(e).toHaveBeenCalledWith(INT, "req-000001", "discovery", "run.start", { workflow: "w" });
    expect((await handleAutomationRequest(req(valid), config, exec({ ok: false, error: "rate_limited" }), NOW)).status).toBe(429);
    expect((await handleAutomationRequest(req(valid), config, exec({ ok: false, error: "permission_denied" }), NOW)).status).toBe(422);
    const broken = vi.fn<AutomationExecutor>(async () => { throw new Error("db down"); });
    expect((await handleAutomationRequest(req(valid), config, broken, NOW)).status).toBe(502);
  });

  it("signature verification is exact", () => {
    const raw = "{}";
    const sig = signRequest(SECRET, INT, NOW, raw);
    expect(verifySignature(SECRET, { integration: INT, timestamp: String(NOW), signature: sig }, raw, NOW)).toEqual({ ok: true });
    expect(verifySignature(SECRET, { integration: INT, timestamp: "1e9", signature: sig }, raw, NOW)).toEqual({ ok: false, reason: "bad_timestamp" });
  });
});

describe("TypeScript and SQL definitions stay identical", () => {
  it("automation operations match automation_execute", () => {
    const block = SQL5.slice(SQL5.indexOf("v_action := case p_operation"), SQL5.indexOf("v_level :="));
    const sqlOps = [...block.matchAll(/when '([a-z.]+)'/g)].map((m) => m[1]).sort();
    expect(sqlOps).toEqual(Object.keys(AUTOMATION_OPERATIONS).sort());
  });

  it("pies_agent_can matches AGENT_CAPABILITIES", () => {
    const block = SQL5.slice(SQL5.indexOf("AGENT_CAPABILITIES:BEGIN"), SQL5.indexOf("AGENT_CAPABILITIES:END"));
    const sqlPairs = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    const tsPairs = Object.entries(AGENT_CAPABILITIES).flatMap(([a, actions]) => actions.map((x) => `${a}:${x}`)).sort();
    expect(sqlPairs).toEqual(tsPairs);
  });
});
