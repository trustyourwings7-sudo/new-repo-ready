import { ESTIMATE_SAFETY_FACTOR } from "./constants";

export interface TokenPricing {
  /** USD per 1M input tokens, taken from a VERIFIED provider pricing page. */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens, taken from a VERIFIED provider pricing page. */
  outputPerMTokUsd: number;
}

export interface LlmEstimateInput {
  inputTokens: number;
  maxOutputTokens: number;
  pricing: TokenPricing;
}

/** Round UP to whole micro-dollars, ignoring binary floating-point noise. */
function ceilMicroUsd(usd: number): number {
  return Math.ceil(Number((usd * 1e6).toFixed(4))) / 1e6;
}

function assertNonNegativeFinite(n: number, name: string) {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`${name} must be a non-negative finite number`);
}

/**
 * Upper-bound cost for one LLM call: assumes the full output budget is used,
 * then applies the safety factor. Returns USD rounded UP to 6 decimals.
 */
export function estimateLlmCostUsd({ inputTokens, maxOutputTokens, pricing }: LlmEstimateInput): number {
  assertNonNegativeFinite(inputTokens, "inputTokens");
  assertNonNegativeFinite(maxOutputTokens, "maxOutputTokens");
  assertNonNegativeFinite(pricing.inputPerMTokUsd, "inputPerMTokUsd");
  assertNonNegativeFinite(pricing.outputPerMTokUsd, "outputPerMTokUsd");
  const raw =
    (inputTokens / 1_000_000) * pricing.inputPerMTokUsd + (maxOutputTokens / 1_000_000) * pricing.outputPerMTokUsd;
  return ceilMicroUsd(raw * ESTIMATE_SAFETY_FACTOR);
}

/** Actual cost from provider-reported usage. No safety factor. */
export function actualLlmCostUsd(inputTokens: number, outputTokens: number, pricing: TokenPricing): number {
  assertNonNegativeFinite(inputTokens, "inputTokens");
  assertNonNegativeFinite(outputTokens, "outputTokens");
  const raw = (inputTokens / 1_000_000) * pricing.inputPerMTokUsd + (outputTokens / 1_000_000) * pricing.outputPerMTokUsd;
  return ceilMicroUsd(raw);
}
