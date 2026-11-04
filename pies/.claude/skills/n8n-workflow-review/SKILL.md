---
name: n8n-workflow-review
description: Review an n8n workflow for PIES before it is published - run the static auditor, check the automation boundary, schedules, limits and execution quota. Use whenever a PIES workflow is created, changed or about to be published.
---

# n8n workflow review

Phase status: **no PIES workflow may be published until the owner approves Phase 2.** This skill reviews drafts only. Publishing, executing and agent tools are denied in `.claude/settings.json`.

## Steps
1. Get the workflow JSON. Use the n8n MCP `get_workflow_details` (read-only) or an export the owner provides.
2. Save the JSON to a scratch file and run the auditor from `pies/`:
   ```bash
   node scripts/audit-n8n-workflow.ts /path/to/workflow.json https://<pies-origin>
   ```
   Exit 0 means no findings; exit 1 lists each finding. **Anything other than exit 0 blocks publishing.**
3. Manual checks the auditor cannot do:
   - Every HTTP call is signed (Crypto node HMAC over `v1:<integration>:<timestamp>:<body>`), with the secret taken from `$vars`, not hard-coded.
   - Every write is preceded by `run.start` and followed by `run.finish`.
   - Request ids are deterministic (`<workflow>:<item-hash>:<date>`) so retries replay rather than duplicate.
   - Retries ≤ 3 with backoff. No loops that call PIES unboundedly.
   - Schedule × items stays well within the integration limits (default 30/min, 1,000/day) **and** within the n8n plan's monthly execution quota.
   - Read every Code node by eye. Regex checks can be evaded.
4. Report: findings (must be none), estimated executions per month, and the owner approval needed to publish.
