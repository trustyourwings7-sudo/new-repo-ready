import { createHash } from "node:crypto";
import { BudgetDeniedError, withBudget, type RpcClient } from "../budget/governor.ts";
import type { ExaSearch, SearchOutcome, SearchProvider } from "./exa.ts";
import type { ExtractedPage, ExtractProvider, FirecrawlExtract } from "./firecrawl.ts";
import { actualUsd, PRICES, reserveUsd } from "./pricing.ts";

/**
 * Wraps providers so that EVERY call is (1) under a per-run cap, (2) paced to the
 * provider's free-plan rate limit, and (3) reserved and committed in the database
 * governor (atomic, concurrency-safe, monthly caps, paid_operations_enabled switch).
 * Nothing here can spend without a successful reservation.
 */

export class RunCapReached extends Error {
  readonly what: string;
  constructor(what: string) {
    super(`per-run cap reached: ${what}`);
    this.what = what;
    this.name = "RunCapReached";
  }
}

export interface MeterContext {
  rpc: RpcClient;
  userId: string;
  /** Stable for one logical run (e.g. "2026-11-05:education"); retries of the same run never double-spend. */
  runKey: string;
  agentRunId?: string;
  caps: { searches: number; extractions: number };
  /** Minimum milliseconds between calls per provider (free-plan rate limits). */
  pacingMs?: { exa?: number; firecrawl?: number };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

class Pacer {
  private last = -Infinity;
  private readonly gapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  constructor(gapMs: number, sleep: (ms: number) => Promise<void>, now: () => number) {
    this.gapMs = gapMs;
    this.sleep = sleep;
    this.now = now;
  }
  async wait() {
    const delta = this.now() - this.last;
    if (delta < this.gapMs) await this.sleep(this.gapMs - delta);
    this.last = this.now();
  }
}

export interface MeterStats {
  searches: number;
  extractions: number;
  reservedUsd: number;
  committedUsd: number;
  denied: string[];
}

export class MeteredResearch {
  readonly stats: MeterStats = { searches: 0, extractions: 0, reservedUsd: 0, committedUsd: 0, denied: [] };
  private readonly exaPacer: Pacer;
  private readonly fcPacer: Pacer;

  private readonly search: SearchProvider | ExaSearch;
  private readonly extract: ExtractProvider | FirecrawlExtract;
  private readonly ctx: MeterContext;
  constructor(search: SearchProvider | ExaSearch, extract: ExtractProvider | FirecrawlExtract, ctx: MeterContext) {
    this.search = search;
    this.extract = extract;
    this.ctx = ctx;
    const sleep = ctx.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = ctx.now ?? Date.now;
    // Firecrawl free: 10 scrapes/min -> 6.5 s spacing. Exa free: 10 QPS -> 250 ms is ample.
    this.exaPacer = new Pacer(ctx.pacingMs?.exa ?? 250, sleep, now);
    this.fcPacer = new Pacer(ctx.pacingMs?.firecrawl ?? 6500, sleep, now);
  }

  async searchOnce(query: string, numResults: number): Promise<SearchOutcome> {
    if (this.stats.searches >= this.ctx.caps.searches) throw new RunCapReached("searches");
    this.stats.searches++;
    const estimate = reserveUsd(1, PRICES.exaSearch);
    await this.exaPacer.wait();
    return this.metered("search", this.search.name, `search:${h(query)}`, estimate, async () => {
      const out = await this.search.search(query, numResults);
      const cost = out.reportedUsd ?? actualUsd(1, PRICES.exaSearch);
      return { result: out, actualUsd: cost };
    });
  }

  async extractOnce(url: string): Promise<ExtractedPage> {
    if (this.stats.extractions >= this.ctx.caps.extractions) throw new RunCapReached("extractions");
    this.stats.extractions++;
    const estimate = reserveUsd(1, PRICES.firecrawlCredit);
    await this.fcPacer.wait();
    return this.metered("extract", this.extract.name, `extract:${h(url)}`, estimate, async () => {
      const page = await this.extract.extract(url);
      const credits = page.reportedCredits ?? 1;
      return { result: page, actualUsd: actualUsd(credits, PRICES.firecrawlCredit) };
    });
  }

  private async metered<T>(operation: string, provider: string, key: string, estimate: number, run: () => Promise<{ result: T; actualUsd: number }>): Promise<T> {
    try {
      const result = await withBudget(
        this.ctx.rpc,
        {
          category: "search",
          provider,
          operation,
          estimatedUsd: estimate,
          idempotencyKey: `${this.ctx.runKey}:${key}`,
          userId: this.ctx.userId,
          ...(this.ctx.agentRunId ? { agentRunId: this.ctx.agentRunId } : {}),
        },
        async () => {
          this.stats.reservedUsd += estimate;
          const out = await run();
          this.stats.committedUsd += out.actualUsd;
          return out;
        },
      );
      return result;
    } catch (err) {
      if (err instanceof BudgetDeniedError) this.stats.denied.push(`${operation}:${err.reason}`);
      throw err;
    }
  }
}

/**
 * Live calls need all three: the switch, a fresh owner confirmation that the
 * prices in pricing.ts match the official pages, and keys. The database's
 * paid_operations_enabled flag is a fourth, independent gate.
 */
export function liveModeProblems(env: Record<string, string | undefined>, today = new Date()): string[] {
  const p: string[] = [];
  if (env.PIES_LIVE_RESEARCH !== "1") p.push("PIES_LIVE_RESEARCH is not 1");
  const confirmed = env.PIES_PRICES_CONFIRMED_ON;
  const d = confirmed && /^\d{4}-\d{2}-\d{2}$/.test(confirmed) ? new Date(`${confirmed}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) p.push("PIES_PRICES_CONFIRMED_ON (YYYY-MM-DD) is missing");
  else {
    const ageDays = (today.getTime() - d.getTime()) / 86_400_000;
    if (ageDays < 0 || ageDays > 31) p.push("PIES_PRICES_CONFIRMED_ON is older than 31 days or in the future");
  }
  if (!env.EXA_API_KEY) p.push("EXA_API_KEY is missing");
  if (!env.FIRECRAWL_API_KEY) p.push("FIRECRAWL_API_KEY is missing");
  return p;
}
