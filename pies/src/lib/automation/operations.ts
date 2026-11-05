import { z } from "zod";
import { AGENT_IDS } from "@/lib/agents/registry";
import type { ActionId } from "@/lib/permissions/catalog";

/**
 * The complete automation (n8n) interface. Mirrors the CASE list in
 * public.automation_execute; a unit test checks they match.
 *
 * There is deliberately no operation that sends email, submits applications,
 * spends budget, decides or consumes approvals, changes integrations or
 * providers, or runs arbitrary SQL. Adding one requires a migration, a test
 * and an owner decision.
 */
export const AUTOMATION_OPERATIONS = {
  "run.start": { action: null, description: "Open an agent run (task and time limits apply)" },
  "run.finish": { action: null, description: "Close an agent run" },
  "opportunity.upsert": { action: "upsert_opportunity", description: "Create/refresh an opportunity by dedupe key" },
  "source.add": { action: "upsert_opportunity", description: "Attach source evidence to an opportunity" },
  "task.create": { action: "create_task", description: "Create an internal task" },
  "notification.create": { action: "create_notification", description: "Create an internal notification" },
  "approval.request": { action: "requested_level4_action", description: "Ask the owner to approve a level-4 action (never executes it)" },
} as const satisfies Record<string, { action: ActionId | "requested_level4_action" | null; description: string }>;

export type AutomationOperation = keyof typeof AUTOMATION_OPERATIONS;

export function isAutomationOperation(op: string): op is AutomationOperation {
  return Object.prototype.hasOwnProperty.call(AUTOMATION_OPERATIONS, op);
}

/** Envelope accepted by POST /api/automation/v1. The payload is validated again in SQL. */
export const automationEnvelopeSchema = z
  .object({
    request_id: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
    agent: z.enum(AGENT_IDS),
    operation: z.string().min(1).max(64),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AutomationEnvelope = z.infer<typeof automationEnvelopeSchema>;

export const MAX_AUTOMATION_BODY_BYTES = 32 * 1024;
