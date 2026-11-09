export type Tone = "ok" | "warn" | "bad" | "info";

export interface Finding {
  cause: string;
  fix: string;
  tone: Tone;
}

/** Turns a stored stop reason into a plain cause and fix. */
export function explainStop(reason: string): Finding | null {
  const r = reason.toLowerCase();
  if (r.includes("paid_operations_disabled") || r.includes("paused")) return { cause: "Paid research was switched off, so the run stopped before spending anything.", fix: "Turn paid research back on (ask Claude, or set paid_operations_enabled in Supabase).", tone: "warn" };
  if (r.includes("duplicate_operation") || r.includes("already done")) return { cause: "Today's research had already been done; this attempt correctly spent nothing.", fix: "Nothing to fix.", tone: "ok" };
  if (r.includes("provider_limit_reached") || r.includes("monthly_limit_reached") || r.includes("category_limit_reached") || r.includes("exceeds_hard_cap")) return { cause: "A monthly spending cap was reached, so the budget governor refused new paid calls.", fix: "Wait until the 1st of next month, or approve a higher provider cap (must stay within the $1.95 research and $10 total caps).", tone: "warn" };
  if (r.includes("provider_not_enabled") || r.includes("pricing_unverified")) return { cause: "A provider is disabled or its price is unverified in provider_configs.", fix: "Re-verify the provider's price page, then enable it.", tone: "bad" };
  if (r.includes("unauthorized")) return { cause: "A provider rejected the API key (expired, revoked or wrong).", fix: "Create a new key in the provider dashboard and update the GitHub secret.", tone: "bad" };
  if (r.includes("quota_exhausted")) return { cause: "A provider's free credits ran out (it answered 402/429).", fix: "Wait for the monthly reset. Do not add a card: that is the hard spending limit.", tone: "bad" };
  if (r.includes("per-run cap")) return { cause: "The run used its full allowance (3 searches / 4 pages). That is normal.", fix: "Nothing to fix.", tone: "ok" };
  if (r.includes("unexpected") && r.includes("cost")) return { cause: "A provider charged far more than expected, so the run stopped as a safety measure.", fix: "Check the provider's usage page and pricing before the next run.", tone: "bad" };
  if (r.includes("all candidates failed")) return { cause: "Every page it tried to read failed (blocked sites, timeouts or provider errors).", fix: "Usually temporary; run again later. If it repeats, check Firecrawl's status and credits.", tone: "warn" };
  return null;
}

