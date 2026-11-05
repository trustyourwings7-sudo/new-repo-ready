import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_IDS } from "@/lib/agents/registry";
import { ACTIONS, AGENT_CAPABILITIES, type ActionId } from "@/lib/permissions/catalog";
import { decide, type ApprovalEvidence } from "@/lib/permissions/engine";

const NOW = new Date("2026-11-04T12:00:00Z");
const TARGET = "22222222-2222-4222-8222-222222222222";
const approval = (over: Partial<ApprovalEvidence> = {}): ApprovalEvidence => ({
  id: "a1",
  status: "approved",
  action: "send_email",
  targetId: TARGET,
  payloadHash: "h1",
  expiresAt: new Date("2026-11-05T00:00:00Z"),
  ...over,
});

describe("permission engine", () => {
  it("denies unknown agents and actions", () => {
    expect(decide({ agent: "rogue", action: "fetch_public_source" }).reason).toBe("unknown_agent");
    expect(decide({ agent: "discovery", action: "rm_rf" }).reason).toBe("unknown_action");
  });

  it("allows level 1-3 actions within an agent's scope", () => {
    expect(decide({ agent: "discovery", action: "fetch_public_source" })).toMatchObject({ outcome: "allow", level: 1 });
    expect(decide({ agent: "qualification", action: "score_opportunity" })).toMatchObject({ outcome: "allow", level: 2 });
    expect(decide({ agent: "outreach", action: "create_gmail_draft" })).toMatchObject({ outcome: "allow", level: 3 });
  });

  it("denies actions outside an agent's scope", () => {
    expect(decide({ agent: "discovery", action: "create_gmail_draft" }).reason).toBe("action_outside_agent_scope");
    expect(decide({ agent: "executive_coordinator", action: "send_email" }).reason).toBe("action_outside_agent_scope");
  });

  it("requires approval for sending and accepts only a matching approval", () => {
    const base = { agent: "outreach", action: "send_email", targetId: TARGET, payloadHash: "h1", now: NOW };
    expect(decide(base).outcome).toBe("require_approval");
    expect(decide({ ...base, approval: approval() })).toMatchObject({ outcome: "allow", reason: "single_use_approval" });
    expect(decide({ ...base, approval: approval({ status: "pending" }) }).reason).toBe("approval_pending");
    expect(decide({ ...base, approval: approval({ status: "consumed" }) }).reason).toBe("approval_consumed");
    expect(decide({ ...base, approval: approval({ expiresAt: new Date("2026-11-04T11:00:00Z") }) }).reason).toBe("approval_expired");
    expect(decide({ ...base, approval: approval({ action: "submit_job_application" }) }).reason).toBe("approval_action_mismatch");
    expect(decide({ ...base, approval: approval({ targetId: "other" }) }).reason).toBe("approval_target_mismatch");
    expect(decide({ ...base, payloadHash: "edited", approval: approval() }).reason).toBe("approval_content_changed");
  });

  it("no agent can ever perform human-only actions, even with an approval", () => {
    const humanOnly = (Object.keys(ACTIONS) as ActionId[]).filter((a) => {
      const s = ACTIONS[a];
      return "level4Mode" in s && s.level4Mode === "human_only";
    });
    expect(humanOnly).toEqual(expect.arrayContaining(["make_payment", "purchase_credits_or_upgrade", "sign_agreement", "change_security_permissions", "delete_critical_record"]));
    for (const agent of AGENT_IDS) {
      for (const action of humanOnly) {
        expect(AGENT_CAPABILITIES[agent]).not.toContain(action);
        expect(decide({ agent, action, approval: approval({ action }), now: NOW }).outcome).toBe("deny");
      }
    }
  });

  it("every level-4 action has an explicit mode", () => {
    for (const [id, spec] of Object.entries(ACTIONS)) {
      if (spec.level === 4) expect("level4Mode" in spec, id).toBe(true);
    }
  });

  it("agent IDs match the database allowlist", () => {
    const sql = readFileSync(path.join(__dirname, "../supabase/migrations/20261104000001_core_schema.sql"), "utf8");
    const block = sql.match(/select p_agent in \(([\s\S]*?)\);/)?.[1] ?? "";
    const dbAgents = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(dbAgents.sort()).toEqual([...AGENT_IDS].sort());
  });
});
