# Budget Policy

**Hard limit: USD 10.00 incremental spend per calendar month (UTC).** It is a ceiling, not a target.

## Allocation (defaults)

| Category | Limit | Covers |
|---|---|---|
| ai | $5.00 | LLM API calls (extraction, drafting) |
| search | $2.00 | Search APIs |
| infra | $3.00 | Hosting, domains, contingency |

The three limits can be changed with `set_category_limit`, but their sum can never exceed $10. `user_preferences.monthly_budget_usd` can lower the total further (never above $10; a check constraint enforces it).

## How spending is controlled

1. **Kill switch.** `user_preferences.paid_operations_enabled` defaults to `false`. While false, every paid call is refused.
2. **Provider gate.** A provider must be `enabled` **and** `pricing_verified`, with a pricing source URL and date. Unknown pricing means blocked.
3. **Reserve before spending.** `reserve_budget(category, provider, operation, estimate, idempotency_key)` checks the monthly total, category and optional provider cap against committed spend plus live reservations. Decisions are serialized per user, so parallel workflows cannot overspend.
4. **Estimates are upper bounds:** full output budget × 1.25 safety factor, rounded up to whole micro-dollars.
5. **Commit actuals.** `commit_usage` records the provider-reported cost, even when it exceeds the estimate (flagged `overrun`). `release_usage` returns unused reservations; reservations also expire after 1 hour.
6. **No double billing.** The same idempotency key never reserves twice, and `withBudget` will not re-run a duplicate.
7. **Fail closed.** If the governor is unreachable or answers oddly, the paid call does not happen.
8. **No purchases.** There is no code path that buys credits or upgrades plans; these actions are human-only in the permission catalog. Set a hard spending limit or use prepaid credit in every provider dashboard as an outer guard.
9. **Monthly reset** happens by period key. Nothing is deleted.

When the budget is exhausted, free and deterministic work continues: RSS, official pages, rule-based scoring, internal records.

## Existing subscriptions (not incremental, tracked separately)

| Service | Status | Cost |
|---|---|---|
| n8n Cloud | Connected; 0 workflows, 0 credentials at inspection (2026-11-04) | Your existing plan. Check its monthly execution quota, because every scheduled run counts. |
| Claude Code / Claude Desktop | Development tool only; PIES does not call it at runtime | Your existing plan |

## Estimated incremental cost (unverified, pending your checks)

| Item | Estimate | Confidence |
|---|---|---|
| Supabase Free | $0 | [Likely] Free projects pause after about a week without activity; scheduled n8n runs keep the project active. 500 MB database limit. |
| GitHub Free | $0 | [Certain] |
| Hosting (see ARCHITECTURE.md) | $0 | [Likely] |
| AI: about 3,000 extraction calls per month on a small model | $0.50–$3 | [Guessing] Depends on verified per-token prices; enter them before enabling. |
| Search API | $0–$2 | [Guessing] Free tiers and credits change often; verify on the provider's pricing page. |
| n8n gateway AI credits | Possibly $0 | [Guessing] n8n lists built-in credits for Anthropic, OpenAI and Gemini nodes; the quota was not checked. |
| **Total** | **$0.50–$5 / month** | Below the cap only if usage follows the plan above |
