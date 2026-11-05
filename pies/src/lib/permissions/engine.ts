import { isAgentId, type AgentId } from "@/lib/agents/registry";
import { ACTIONS, AGENT_CAPABILITIES, type ActionId, type PermissionLevel } from "./catalog";

export type Decision =
  | { outcome: "allow"; level: PermissionLevel; reason: string }
  | { outcome: "require_approval"; level: PermissionLevel; reason: string }
  | { outcome: "deny"; level: PermissionLevel | null; reason: string };

/** A user approval as stored in public.approval_requests. */
export interface ApprovalEvidence {
  id: string;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  action: string;
  targetId: string | null;
  payloadHash: string | null;
  expiresAt: Date;
}

export interface PermissionRequest {
  agent: string;
  action: string;
  targetId?: string | null;
  /** Hash of the exact content (e.g. email body) the action would use. */
  payloadHash?: string | null;
  approval?: ApprovalEvidence | null;
  now?: Date;
}

function isActionId(v: string): v is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, v);
}

/**
 * Pure, deterministic permission check. Every agent calls this before acting,
 * and the result is written to audit_logs. The database independently enforces
 * the approval binding when the approval is consumed.
 */
export function decide(req: PermissionRequest): Decision {
  if (!isAgentId(req.agent)) return { outcome: "deny", level: null, reason: "unknown_agent" };
  if (!isActionId(req.action)) return { outcome: "deny", level: null, reason: "unknown_action" };

  const agent: AgentId = req.agent;
  const spec = ACTIONS[req.action];
  const level = spec.level;

  if (!AGENT_CAPABILITIES[agent].includes(req.action)) {
    return { outcome: "deny", level, reason: "action_outside_agent_scope" };
  }

  if (level === 1 || level === 2 || level === 3) {
    return { outcome: "allow", level, reason: `level_${level}_automatic` };
  }

  // Level 4
  if (!("level4Mode" in spec) || spec.level4Mode === "human_only") {
    return { outcome: "deny", level, reason: "human_only_action" };
  }

  const a = req.approval;
  if (!a) return { outcome: "require_approval", level, reason: "no_approval" };
  const now = req.now ?? new Date();
  if (a.status !== "approved") return { outcome: "deny", level, reason: `approval_${a.status}` };
  if (a.expiresAt.getTime() <= now.getTime()) return { outcome: "deny", level, reason: "approval_expired" };
  if (a.action !== req.action) return { outcome: "deny", level, reason: "approval_action_mismatch" };
  if ((a.targetId ?? null) !== (req.targetId ?? null)) return { outcome: "deny", level, reason: "approval_target_mismatch" };
  if (a.payloadHash !== null && a.payloadHash !== (req.payloadHash ?? null)) {
    return { outcome: "deny", level, reason: "approval_content_changed" };
  }
  return { outcome: "allow", level, reason: "single_use_approval" };
}
