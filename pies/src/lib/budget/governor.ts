import { z } from "zod";
import type { BudgetCategory } from "./constants";

/**
 * Thin client over the database governor (public.reserve_budget / commit_usage / release_usage).
 * The DATABASE is the source of truth and enforces every limit atomically;
 * this module only sequences reserve -> execute -> commit/release.
 */

export const reservationSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  usage_id: z.string().uuid().optional(),
  category_remaining_usd: z.coerce.number().optional(),
  total_remaining_usd: z.coerce.number().optional(),
});
export type Reservation = z.infer<typeof reservationSchema>;

/** Minimal RPC surface so the governor is testable without Supabase. */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface SpendRequest {
  category: BudgetCategory;
  provider: string;
  operation: string;
  estimatedUsd: number;
  /** Stable per logical operation, so retries never double-reserve. */
  idempotencyKey: string;
  agentRunId?: string;
  /** Required only when calling with the service role. */
  userId?: string;
}

export class BudgetDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`Budget governor denied operation: ${reason}`);
    this.name = "BudgetDeniedError";
  }
}

export interface SpendOutcome<T> {
  result: T;
  /** Real cost reported by the provider. Must be returned even on partial failure where money was spent. */
  actualUsd: number;
}

export async function reserve(client: RpcClient, req: SpendRequest): Promise<Reservation> {
  const { data, error } = await client.rpc("reserve_budget", {
    p_category: req.category,
    p_provider: req.provider,
    p_operation: req.operation,
    p_estimated_usd: req.estimatedUsd,
    p_idempotency_key: req.idempotencyKey,
    p_agent_run_id: req.agentRunId ?? null,
    p_user_id: req.userId ?? null,
  });
  // Fail closed: any transport or parse failure is a denial.
  if (error) return { allowed: false, reason: "governor_unavailable" };
  const parsed = reservationSchema.safeParse(data);
  if (!parsed.success) return { allowed: false, reason: "governor_invalid_response" };
  return parsed.data;
}

/**
 * Run a paid operation under the governor. If the operation throws before
 * any money is spent, the reservation is released. If it reports a cost,
 * that cost is committed.
 */
export async function withBudget<T>(
  client: RpcClient,
  req: SpendRequest,
  run: () => Promise<SpendOutcome<T>>,
): Promise<T> {
  const reservation = await reserve(client, req);
  if (!reservation.allowed || !reservation.usage_id) {
    throw new BudgetDeniedError(reservation.reason);
  }
  if (reservation.reason === "duplicate") {
    // A prior attempt with this key already holds or spent the budget; do not run again.
    throw new BudgetDeniedError("duplicate_operation");
  }
  const usageId = reservation.usage_id;
  let outcome: SpendOutcome<T>;
  try {
    outcome = await run();
  } catch (err) {
    await client.rpc("release_usage", { p_usage_id: usageId, p_user_id: req.userId ?? null });
    throw err;
  }
  const { error } = await client.rpc("commit_usage", {
    p_usage_id: usageId,
    p_actual_usd: outcome.actualUsd,
    p_user_id: req.userId ?? null,
  });
  if (error) {
    // The money is spent; surface loudly. The reservation still counts until it expires.
    throw new Error("Failed to commit usage; reservation left in place to stay conservative");
  }
  return outcome.result;
}

export const budgetSummarySchema = z.object({
  period_month: z.string(),
  hard_cap_usd: z.coerce.number(),
  paid_operations_enabled: z.boolean(),
  categories: z.array(
    z.object({
      category: z.enum(["ai", "search", "infra"]),
      limit_usd: z.coerce.number(),
      committed_usd: z.coerce.number(),
      pending_usd: z.coerce.number(),
    }),
  ),
});
export type BudgetSummary = z.infer<typeof budgetSummarySchema>;

export function totals(summary: BudgetSummary) {
  const committed = summary.categories.reduce((a, c) => a + c.committed_usd, 0);
  const pending = summary.categories.reduce((a, c) => a + c.pending_usd, 0);
  return {
    committed,
    pending,
    remaining: Math.max(summary.hard_cap_usd - committed - pending, 0),
  };
}
