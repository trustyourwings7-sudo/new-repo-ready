/** Mirrors public.pies_hard_monthly_cap_usd(). Changing either requires changing both. */
export const HARD_MONTHLY_CAP_USD = 10;

export const BUDGET_CATEGORIES = ["ai", "search", "infra"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const DEFAULT_CATEGORY_LIMITS_USD: Readonly<Record<BudgetCategory, number>> = {
  ai: 5,
  search: 2,
  infra: 3,
};

/** Estimates are inflated by this factor so that rounding and retries cannot breach a cap. */
export const ESTIMATE_SAFETY_FACTOR = 1.25;
