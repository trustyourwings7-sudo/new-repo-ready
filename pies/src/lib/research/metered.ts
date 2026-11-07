import { createHash } from "node:crypto";
import { BudgetDeniedError, ChargedFailure, withBudget, type RpcClient } from "../budget/governor.ts";
import { ProviderError } from "./http.ts";
import type { ExaSearch, SearchOutcome, SearchProvider } from "./exa.ts";
import type { ExtractedPage, ExtractProvider, FirecrawlExtract } from "./firecrawl.ts";
import { exaSearchListUsd, FIRECRAWL_RESERVE_CREDITS, firecrawlListUsd, UNEXPECTED_COST_MULTIPLE, withSafety } from "./pricing.ts";

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

/** The provider reported a cost far above the reservation: pricing changed or was misread. Stop. */
export class UnexpectedCost extends Error {
  readonly reportedUsd: number;
  readonly reservedUsd: number;
  constructor(reportedUsd: number, reservedUsd: number) {
    super(`unexpected provider cost: reported $${reportedUsd} vs reserved $${reservedUsd}`);
    this.name = "UnexpectedCost";
    this.reportedUsd = reportedUsd;
    this.reservedUsd = reservedUsd;
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
  /** Calls whose recorded cost exceeded the reservation. */
  overruns: number;
  /** Failed calls charged at the reservation because the provider may have billed them. */
  chargedFailures: number;
}

export class MeteredResearch {
  readonly stats: MeterStats = { searches: 0, extractions: 0, reservedUsd: 0, committedUsd: 0, denied: [], overruns: 0, chargedFailures: 0 };
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

  async searchOnce(query: string, numResults: number, opts: { excludeDomains?: string[] } = {}): Promise<SearchOutcome> {
    if (this.stats.searches >= this.ctx.caps.searches) throw new RunCapReached("searches");
    this.stats.searches++;
    const n = Math.min(Math.max(Math.trunc(numResults), 1), 10);
    const list = exaSearchListUsd(n); // worst case: every result returns text
    await this.exaPacer.wait();
    return this.metered("search", this.search.name, `search:${h(`${n}:${query}`)}`, withSafety(list), list, async () => {
      const out = await this.search.search(query, n, opts);
      // Exa's own figure when present and sane; otherwise list price for what came back.
      const listForReturned = exaSearchListUsd(Math.min(out.hits.length + (out.dropped ?? 0), 10));
      return { result: out, actualUsd: out.reportedUsd ?? listForReturned };
    });
  }

  async extractOnce(url: string): Promise<ExtractedPage> {
    if (this.stats.extractions >= this.ctx.caps.extractions) throw new RunCapReached("extractions");
    this.stats.extractions++;
    const list = firecrawlListUsd(FIRECRAWL_RESERVE_CREDITS);
    await this.fcPacer.wait();
    return this.metered("extract", this.extract.name, `extract:${h(url)}`, withSafety(list), list, async () => {
      const page = await this.extract.extract(url);
      // No reported credits: assume the documented 1 for a returned document, 0 for none.
      const credits = page.reportedCredits ?? (page.markdown ? 1 : 0);
      return { result: page, actualUsd: firecrawlListUsd(credits) };
    });
  }

  private async metered<T>(
    operation: string,
    provider: string,
    key: string,
    reserve: number,
    chargeOnUncertainFailure: number,
    run: () => Promise<{ result: T; actualUsd: number }>,
  ): Promise<T> {
    let overrun: UnexpectedCost | null = null;
    try {
      const result = await withBudget(
        this.ctx.rpc,
        {
          category: "search",
          provider,
          operation,
          estimatedUsd: reserve,
          idempotencyKey: `${this.ctx.runKey}:${key}`,
          userId: this.ctx.userId,
          ...(this.ctx.agentRunId ? { agentRunId: this.ctx.agentRunId } : {}),
        },
        async () => {
          this.stats.reservedUsd += reserve;
          let out: { result: T; actualUsd: number };
          try {
            out = await run();
          } catch (err) {
            if (err instanceof ProviderError && err.possiblyBilled) {
              // Timeout/5xx/garbled 200: the provider may have processed it. Record it as spent.
              this.stats.chargedFailures++;
              this.stats.committedUsd += chargeOnUncertainFailure;
              throw new ChargedFailure(chargeOnUncertainFailure, err);
            }
            throw err; // definite refusal (4xx): released, not charged
          }
          if (out.actualUsd > reserve) this.stats.overruns++;
          if (out.actualUsd > reserve * UNEXPECTED_COST_MULTIPLE) overrun = new UnexpectedCost(out.actualUsd, reserve);
          this.stats.committedUsd += out.actualUsd;
          return out; // committed as reported, even when above the reservation
        },
      );
      if (overrun) throw overrun;
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
