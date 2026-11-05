import { ESTIMATE_SAFETY_FACTOR } from "../budget/constants.ts";

/**
 * Provider prices used for PIES's OWN accounting. The database governor reserves an
 * estimate before each call and commits the actual cost after it.
 *
 * What this does NOT do: it does not limit what a provider can bill. Provider-side
 * limits exist only in each provider's account (Firecrawl's free plan stops at its
 * allowance with HTTP 402; Exa bills a card on file once free credits are used).
 * The internal cap stops PIES from making further calls; it cannot undo a charge.
 *
 * Billing semantics used here (official docs, retrieved 2026-11-05):
 * - Exa /search: $7 per 1,000 requests (type "auto"), PLUS $1 per 1,000 pages of
 *   contents; text for N results is N content pages. Results above 10 cost extra
 *   (PIES caps at 10). The response's costDollars is Exa's own figure.
 *   https://exa.ai/docs/admin/pricing
 * - Firecrawl /v2/scrape: 1 credit per returned document; +1 credit per PDF page;
 *   JSON/PII/lockdown/injection-check options add credits (PIES uses none of them);
 *   cached results still cost 1; enhanced/auto proxy escalation costs nothing extra;
 *   no document returned = 0 credits. https://docs.firecrawl.dev/billing
 * - Neither provider documents billing for timeouts or 5xx: PIES counts them as billed.
 *
 * Firecrawl's free plan cannot be charged money, but credits are scarce, so they carry a
 * conservative shadow price (Hobby plan, highest reported figure) and share the same
 * atomic counter as Exa.
 */
export interface ProviderPrice {
  provider: "exa" | "firecrawl";
  unit: string;
  usdPerUnit: number;
  source: string;
  retrieved: string;
  confidence: "Certain" | "Likely" | "Guessing";
}

export const PRICES = {
  exaSearchRequest: {
    provider: "exa",
    unit: "search request (type auto)",
    usdPerUnit: 0.007,
    source: "https://exa.ai/docs/admin/pricing",
    retrieved: "2026-11-05",
    confidence: "Likely",
  },
  exaContentPage: {
    provider: "exa",
    unit: "content page (text of one result)",
    usdPerUnit: 0.001,
    source: "https://exa.ai/docs/admin/pricing",
    retrieved: "2026-11-05",
    confidence: "Likely",
  },
  firecrawlCredit: {
    provider: "firecrawl",
    unit: "credit (shadow price)",
    usdPerUnit: 0.0097,
    source: "https://docs.firecrawl.dev/billing",
    retrieved: "2026-11-05",
    confidence: "Likely",
  },
} as const satisfies Record<string, ProviderPrice>;

/** Credits reserved per scrape. 1 is the documented base; the margin covers one surprise add-on. */
export const FIRECRAWL_RESERVE_CREDITS = 2;
/** A reported cost above this multiple of the reservation is treated as a pricing change: stop the run. */
export const UNEXPECTED_COST_MULTIPLE = 3;

const ceil6 = (usd: number) => Math.ceil(Number((usd * 1e6).toFixed(4))) / 1e6;

/** List-price cost of one Exa search returning up to `results` results with text. */
export function exaSearchListUsd(results: number): number {
  if (!Number.isInteger(results) || results < 0 || results > 10) throw new RangeError("results must be an integer 0..10");
  return ceil6(PRICES.exaSearchRequest.usdPerUnit + results * PRICES.exaContentPage.usdPerUnit);
}

export function firecrawlListUsd(credits: number): number {
  if (!Number.isFinite(credits) || credits < 0) throw new RangeError("credits must be a non-negative finite number");
  return ceil6(credits * PRICES.firecrawlCredit.usdPerUnit);
}

/** Reservation = worst-case list price x safety factor. */
export function withSafety(usd: number): number {
  return ceil6(usd * ESTIMATE_SAFETY_FACTOR);
}
