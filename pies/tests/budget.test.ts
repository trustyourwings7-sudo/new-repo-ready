import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CATEGORY_LIMITS_USD, HARD_MONTHLY_CAP_USD } from "@/lib/budget/constants";
import { actualLlmCostUsd, estimateLlmCostUsd } from "@/lib/budget/estimate";
import { BudgetDeniedError, reserve, totals, withBudget, type RpcClient } from "@/lib/budget/governor";

const USAGE_ID = "11111111-1111-4111-8111-111111111111";
const req = { category: "ai" as const, provider: "anthropic", operation: "classify", estimatedUsd: 0.01, idempotencyKey: "op-00000001" };

function fakeClient(reserveResult: unknown, opts: { reserveError?: boolean; commitError?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "reserve_budget") return opts.reserveError ? { data: null, error: { message: "down" } } : { data: reserveResult, error: null };
      if (fn === "commit_usage" && opts.commitError) return { data: null, error: { message: "x" } };
      return { data: { ok: true }, error: null };
    }),
  };
  return { client, calls };
}

describe("budget constants", () => {
  it("default category limits sum to the hard cap", () => {
    const sum = Object.values(DEFAULT_CATEGORY_LIMITS_USD).reduce((a, b) => a + b, 0);
    expect(sum).toBe(HARD_MONTHLY_CAP_USD);
    expect(HARD_MONTHLY_CAP_USD).toBe(10);
  });

  it("TypeScript hard cap matches the SQL hard cap", () => {
    const sql = readFileSync(path.join(__dirname, "../supabase/migrations/20261104000002_governor_functions.sql"), "utf8");
    const m = sql.match(/pies_hard_monthly_cap_usd\(\)[\s\S]*?select\s+([\d.]+)::numeric/);
    expect(Number(m?.[1])).toBe(HARD_MONTHLY_CAP_USD);
  });
});

describe("cost estimation", () => {
  const pricing = { inputPerMTokUsd: 1, outputPerMTokUsd: 5 };
  it("is an upper bound with safety factor", () => {
    // 2000 in + 500 out = 0.002 + 0.0025 = 0.0045 * 1.25 = 0.005625
    expect(estimateLlmCostUsd({ inputTokens: 2000, maxOutputTokens: 500, pricing })).toBeCloseTo(0.005625, 6);
    expect(estimateLlmCostUsd({ inputTokens: 2000, maxOutputTokens: 500, pricing })).toBeGreaterThan(actualLlmCostUsd(2000, 500, pricing));
  });
  it("rejects invalid inputs", () => {
    expect(() => estimateLlmCostUsd({ inputTokens: -1, maxOutputTokens: 1, pricing })).toThrow(RangeError);
    expect(() => estimateLlmCostUsd({ inputTokens: 1, maxOutputTokens: Number.NaN, pricing })).toThrow(RangeError);
  });
});

describe("governor client", () => {
  it("fails closed when the governor is unreachable", async () => {
    const { client } = fakeClient(null, { reserveError: true });
    expect(await reserve(client, req)).toEqual({ allowed: false, reason: "governor_unavailable" });
  });

  it("fails closed on a malformed response", async () => {
    const { client } = fakeClient({ allowed: "yes" });
    expect((await reserve(client, req)).reason).toBe("governor_invalid_response");
  });

  it("does not run the operation when denied", async () => {
    const { client } = fakeClient({ allowed: false, reason: "monthly_limit_reached" });
    const run = vi.fn();
    await expect(withBudget(client, req, run)).rejects.toThrow(BudgetDeniedError);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not re-run a duplicate operation", async () => {
    const { client } = fakeClient({ allowed: true, reason: "duplicate", usage_id: USAGE_ID });
    const run = vi.fn();
    await expect(withBudget(client, req, run)).rejects.toThrow("duplicate_operation");
    expect(run).not.toHaveBeenCalled();
  });

  it("commits the actual cost on success", async () => {
    const { client, calls } = fakeClient({ allowed: true, reason: "reserved", usage_id: USAGE_ID });
    const out = await withBudget(client, req, async () => ({ result: "ok", actualUsd: 0.004 }));
    expect(out).toBe("ok");
    expect(calls.map((c) => c.fn)).toEqual(["reserve_budget", "commit_usage"]);
    expect(calls[1]?.args).toMatchObject({ p_usage_id: USAGE_ID, p_actual_usd: 0.004 });
  });

  it("releases the reservation when the operation throws", async () => {
    const { client, calls } = fakeClient({ allowed: true, reason: "reserved", usage_id: USAGE_ID });
    await expect(withBudget(client, req, async () => { throw new Error("provider down"); })).rejects.toThrow("provider down");
    expect(calls.map((c) => c.fn)).toEqual(["reserve_budget", "release_usage"]);
  });

  it("surfaces commit failures instead of hiding spend", async () => {
    const { client } = fakeClient({ allowed: true, reason: "reserved", usage_id: USAGE_ID }, { commitError: true });
    await expect(withBudget(client, req, async () => ({ result: 1, actualUsd: 0.01 }))).rejects.toThrow(/commit usage/);
  });

  it("computes totals", () => {
    const t = totals({
      period_month: "2026-11-01",
      hard_cap_usd: 10,
      paid_operations_enabled: true,
      categories: [
        { category: "ai", limit_usd: 5, committed_usd: 1.5, pending_usd: 0.5 },
        { category: "search", limit_usd: 2, committed_usd: 0.25, pending_usd: 0 },
      ],
    });
    expect(t).toEqual({ committed: 1.75, pending: 0.5, remaining: 7.75 });
  });
});
