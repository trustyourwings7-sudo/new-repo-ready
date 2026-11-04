# Workflow Specifications (n8n Cloud)

Status: **specifications only.** At inspection (2026-11-04) the connected n8n instance had 0 workflows and 0 credentials. None are created until you approve Phase 2.

## Boundary (Phase 1.5)

- Workflows call **only** `POST <PIES>/api/automation/v1`, signed with HMAC (Crypto node, secret in an n8n variable).
- No Supabase, Postgres, Gmail, AI or search nodes; no credentials. `auditN8nWorkflow()` must return no findings before a workflow is published.
- Paid AI/search calls happen inside PIES (Phase 2 paid-call proxy), never inside n8n.

## Rules shared by every workflow

| Concern | Rule |
|---|---|
| Trigger | Schedule or webhook only. No workflow triggers another in a loop; the coordinator queues tasks instead. |
| Input validation | Validate payloads against a fixed schema (n8n Code node or the app's webhook). Reject unknown fields. |
| Permission check | Enforced by `automation_execute` (and logged) on every call. |
| Budget check | Paid work is requested from PIES, which reserves, calls and commits server-side. n8n never touches the governor. |
| Duplicate prevention | Upsert on `dedupe_key` or `idempotency_key`; idempotency key = workflow + item hash + date. |
| Retries | At most 3 with backoff of 1, 5 and 15 minutes. After that, mark the task `failed` and notify. |
| Limits | `agent_runs.max_tasks` (default 50), timeout 600 s, task depth ≤ 3. |
| Logging | One `agent_runs` row per execution with status, item count and cost; errors in `agent_runs.error` (redacted). |
| n8n quota | Each schedule below is chosen to stay well under a typical Cloud execution quota (about 300 runs/month in total). Check your plan's limit. |

## A. Scheduled opportunity discovery — Discovery Agent
- **Trigger:** daily, 05:00 Africa/Kigali.
- **Steps:** load enabled sources (RSS/official pages) → fetch with polite rate limits, honouring robots.txt → extract fields deterministically, or with a small LLM when free text needs it (governed) → compute `dedupe_key` = normalized(org + title + deadline) → upsert `opportunities` + `opportunity_sources` with evidence excerpt and hash.
- **Output:** new rows with status `new`. Queues workflow B.

## B. Opportunity qualification — Qualification Agent
- **Trigger:** after A, and nightly for rows with status `new`.
- **Steps:** load profile facts → apply the 100-point rubric → mandatory eligibility failures set `ineligible` → write score, breakdown, missing information and next action. No LLM is needed for scoring.

## C. Contact research — Contact Research Agent
- **Trigger:** manual or weekly, only for opportunities with score ≥ 70.
- **Steps:** official "team", "about" and "contact" pages only → store name, role and public channel with source URL. No email guessing; no LinkedIn scraping.

## D. Gmail draft preparation — Outreach Agent
- **Trigger:** manual (you choose which contacts).
- **Steps:** build the draft from verified profile facts → create the Gmail draft → store `gmail_draft_id`, status `gmail_draft_created` → notify. **No send node exists in this workflow.**

## E. Deadline monitoring — Executive Coordinator
- **Trigger:** daily. Deterministic.
- **Steps:** opportunities and applications due in 14, 7, 3 and 1 days → `notifications` + `activities`. Mark overdue items.

## F. Daily executive briefing — Executive Coordinator
- **Trigger:** daily at `user_preferences.daily_briefing_hour`.
- **Steps:** summarize new and high-priority opportunities, deadlines, pending approvals, failures and spend, using deterministic templates. An LLM summary is optional and governed.

## G. Budget monitoring — system
- **Trigger:** daily. Deterministic.
- **Steps:** `budget_summary` → notify at 50 %, 80 % and 100 % per category → flag `overrun` records. It never raises limits.

## H. Commercial lead discovery — Revenue Intelligence Agent
- **Trigger:** weekly.
- **Steps:** public directories and official sites for the target segments → `organizations` + `client_pipeline` (`prospect`) with pain-point evidence and labelled deal assumptions.
