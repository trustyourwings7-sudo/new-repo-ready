import type { RpcClient } from "../budget/governor.ts";

/**
 * Where pipeline results go. The production sink connects as the restricted
 * `pies_automation` role, which can execute exactly four functions
 * (automation_execute, reserve_budget, commit_usage, release_usage) and holds
 * no table privileges. Same boundary n8n used; no service-role key anywhere.
 */
export interface PipelineSink {
  rpc: RpcClient;
  execute(requestId: string, agent: string, operation: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

type Sql = {
  <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  json(v: unknown): unknown;
  end(): Promise<void>;
};

const GOVERNOR_FNS = new Set(["reserve_budget", "commit_usage", "release_usage"]);

export function dbSink(sql: Sql, integrationId: string): PipelineSink {
  return {
    rpc: {
      async rpc(fn, a) {
        if (!GOVERNOR_FNS.has(fn)) return { data: null, error: { message: "function_not_allowed" } };
        try {
          let rows: { r: unknown }[];
          if (fn === "reserve_budget") {
            rows = await sql<{ r: unknown }[]>`select public.reserve_budget(${a.p_category}, ${a.p_provider}, ${a.p_operation}, ${a.p_estimated_usd}::numeric, ${a.p_idempotency_key}, ${a.p_agent_run_id ?? null}::uuid, ${a.p_user_id}::uuid) as r`;
          } else if (fn === "commit_usage") {
            rows = await sql<{ r: unknown }[]>`select public.commit_usage(${a.p_usage_id}::uuid, ${a.p_actual_usd}::numeric, ${a.p_user_id}::uuid) as r`;
          } else {
            rows = await sql<{ r: unknown }[]>`select public.release_usage(${a.p_usage_id}::uuid, ${a.p_user_id}::uuid) as r`;
          }
          return { data: rows[0]?.r ?? null, error: null };
        } catch (err) {
          // Message only (no parameters): it never contains secrets.
          return { data: null, error: { message: err instanceof Error ? err.message.slice(0, 200) : "db_error" } };
        }
      },
    },
    async execute(requestId, agent, operation, payload) {
      const rows = await sql<{ r: Record<string, unknown> }[]>`select public.automation_execute(${integrationId}::uuid, ${requestId}, ${agent}, ${operation}, ${sql.json(payload)}::jsonb) as r`;
      const r = rows[0]?.r;
      if (!r || typeof r !== "object") throw new Error("empty automation result");
      return r;
    },
    close: () => sql.end(),
  };
}

/** In-memory sink for tests and dry runs. Mirrors the governor's essential rules. */
export function memorySink(opts: { budgetUsd: number; paidEnabled: boolean }) {
  const calls: { requestId: string; operation: string; payload: Record<string, unknown> }[] = [];
  const usage = new Map<string, { key: string; estimate: number; actual: number | null; released: boolean }>();
  const byKey = new Map<string, string>();
  let n = 0;
  const spent = () => [...usage.values()].filter((u) => !u.released).reduce((a, u) => a + (u.actual ?? u.estimate), 0);
  const sink: PipelineSink & { calls: typeof calls; spentUsd: () => number } = {
    calls,
    spentUsd: spent,
    rpc: {
      async rpc(fn, a) {
        if (fn === "reserve_budget") {
          if (!opts.paidEnabled) return { data: { allowed: false, reason: "paid_operations_disabled" }, error: null };
          const key = String(a.p_idempotency_key);
          const prior = byKey.get(key);
          if (prior) return { data: { allowed: true, reason: "duplicate", usage_id: prior }, error: null };
          const est = Number(a.p_estimated_usd);
          if (spent() + est > opts.budgetUsd) return { data: { allowed: false, reason: "category_limit_exceeded" }, error: null };
          const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
          usage.set(id, { key, estimate: est, actual: null, released: false });
          byKey.set(key, id);
          return { data: { allowed: true, reason: "reserved", usage_id: id }, error: null };
        }
        const u = usage.get(String(a.p_usage_id));
        if (!u) return { data: null, error: { message: "unknown_usage" } };
        if (fn === "commit_usage") u.actual = Number(a.p_actual_usd);
        else if (fn === "release_usage") u.released = true;
        return { data: { ok: true }, error: null };
      },
    },
    async execute(requestId, _agent, operation, payload) {
      calls.push({ requestId, operation, payload });
      if (operation === "run.start") return { ok: true, run_id: "11111111-1111-4111-8111-111111111111", max_tasks: 50 };
      if (operation === "opportunity.upsert") return { ok: true, opportunity_id: `22222222-2222-4222-8222-${String(calls.length).padStart(12, "0")}`, created: true };
      return { ok: true };
    },
    close: async () => {},
  };
  return sink;
}
