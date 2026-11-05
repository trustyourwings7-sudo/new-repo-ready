import { ESTIMATE_SAFETY_FACTOR } from "../budget/constants.ts";

/**
 * Provider prices used for budget reservations. The governor reserves the
 * estimate BEFORE a call and commits the actual cost after it.
 *
 * Rules:
 * - Use the highest price among conflicting sources (fail safe).
 * - Firecrawl's free plan cannot be billed (HTTP 402 at the limit), but its
 *   credits are still scarce, so they are charged at a conservative shadow
 *   price. That keeps ONE atomic counter (the database governor) for every
 *   provider, instead of a second quota store that could drift.
 * - `verified` is false until the owner confirms the figure on the official
 *   pricing page while signed in. Unverified prices block live calls.
 */
export interface ProviderPrice {
  provider: "exa" | "firecrawl";
  unit: string;
  usdPerUnit: number;
  source: string;
  retrieved: string;
  confidence: "Certain" | "Likely" | "Guessing";
  verified: boolean;
}

export const PRICES = {
  /** Exa /search, type "auto", up to 10 results with text. $7 per 1,000 requests is the highest figure Exa publishes. */
  exaSearch: {
    provider: "exa",
    unit: "search request",
    usdPerUnit: 0.007,
    source: "https://exa.ai/pricing (via Exa-published comparison pages; official page not reachable from the build environment)",
    retrieved: "2026-11-05",
    confidence: "Likely",
    verified: false,
  },
  /** Firecrawl /v2/scrape: 1 credit per page. Shadow price = Hobby plan, highest reported figure ($29 / 3,000 credits). */
  firecrawlCredit: {
    provider: "firecrawl",
    unit: "credit",
    usdPerUnit: 0.0097,
    source: "https://docs.firecrawl.dev/billing (1 credit/scrape, 2 credits/10 search results, free plan has no pay-as-you-go)",
    retrieved: "2026-11-05",
    confidence: "Likely",
    verified: false,
  },
} as const satisfies Record<string, ProviderPrice>;

/** Firecrawl credit cost per operation (official billing docs). */
export const FIRECRAWL_CREDITS = { scrapePage: 1, searchPer10Results: 2 } as const;

export function reserveUsd(units: number, price: ProviderPrice): number {
  if (!Number.isFinite(units) || units < 0) throw new RangeError("units must be a non-negative finite number");
  return Math.ceil(Number((units * price.usdPerUnit * ESTIMATE_SAFETY_FACTOR * 1e6).toFixed(4))) / 1e6;
}

export function actualUsd(units: number, price: ProviderPrice): number {
  return Math.ceil(Number((units * price.usdPerUnit * 1e6).toFixed(4))) / 1e6;
}
