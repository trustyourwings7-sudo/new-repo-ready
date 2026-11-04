import type { AgentId } from "@/lib/agents/registry";

/**
 * Permission levels
 * 1 AUTOMATIC_RESEARCH            read public sources, extract, classify, verify, dedupe
 * 2 AUTOMATIC_INTERNAL_EXECUTION  update internal records, tasks, reports, scores
 * 3 RESTRICTED_EXTERNAL_PREP      create Gmail drafts, prepare materials (nothing leaves the account)
 * 4 PROHIBITED_BY_DEFAULT         anything that commits the user externally or weakens security
 */
export type PermissionLevel = 1 | 2 | 3 | 4;

export interface ActionSpec {
  level: PermissionLevel;
  description: string;
  /**
   * For level 4 only. `approval` = an agent may execute after a single-use,
   * content-bound user approval. `human_only` = no agent may ever execute it.
   */
  level4Mode?: "approval" | "human_only";
}

export const ACTIONS = {
  // Level 1
  fetch_public_source: { level: 1, description: "Read a permitted public web page, RSS feed or API" },
  extract_opportunity: { level: 1, description: "Extract structured fields from fetched content" },
  classify_record: { level: 1, description: "Classify or tag a record" },
  verify_source: { level: 1, description: "Re-check that a source URL is live and consistent" },
  dedupe_records: { level: 1, description: "Detect duplicate records" },
  // Level 2
  upsert_opportunity: { level: 2, description: "Create or update an internal opportunity record" },
  upsert_organization: { level: 2, description: "Create or update an internal organization record" },
  upsert_contact: { level: 2, description: "Store a publicly listed contact with its source URL" },
  score_opportunity: { level: 2, description: "Compute and store a qualification score" },
  create_task: { level: 2, description: "Create an internal task or activity" },
  create_notification: { level: 2, description: "Create an internal notification" },
  generate_report: { level: 2, description: "Generate an internal report or briefing" },
  update_pipeline: { level: 2, description: "Update internal pipeline stage or fields" },
  // Level 3
  create_gmail_draft: { level: 3, description: "Create a Gmail draft (unsent)" },
  prepare_application_materials: { level: 3, description: "Prepare application documents for review" },
  prepare_external_crm_update: { level: 3, description: "Prepare (not push) an external CRM change" },
  // Level 4 - may run once per explicit approval
  send_email: { level: 4, description: "Send an email", level4Mode: "approval" },
  submit_job_application: { level: 4, description: "Submit a job application", level4Mode: "approval" },
  submit_university_application: { level: 4, description: "Submit a university application", level4Mode: "approval" },
  push_external_crm_update: { level: 4, description: "Write to an external CRM", level4Mode: "approval" },
  // Level 4 - never by an agent
  make_payment: { level: 4, description: "Make a payment or purchase", level4Mode: "human_only" },
  purchase_credits_or_upgrade: { level: 4, description: "Buy API credits or upgrade a plan", level4Mode: "human_only" },
  sign_agreement: { level: 4, description: "Sign or accept an agreement", level4Mode: "human_only" },
  commit_to_contract: { level: 4, description: "Commit the user to a contract", level4Mode: "human_only" },
  delete_critical_record: { level: 4, description: "Delete critical records", level4Mode: "human_only" },
  change_security_permissions: { level: 4, description: "Change permissions, roles or security settings", level4Mode: "human_only" },
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTIONS;

/** Which actions each agent may even request. Everything else is denied. */
export const AGENT_CAPABILITIES: Readonly<Record<AgentId, readonly ActionId[]>> = {
  discovery: ["fetch_public_source", "extract_opportunity", "classify_record", "verify_source", "dedupe_records", "upsert_opportunity", "upsert_organization", "create_task"],
  qualification: ["classify_record", "verify_source", "score_opportunity", "upsert_opportunity", "create_task", "create_notification"],
  contact_research: ["fetch_public_source", "verify_source", "dedupe_records", "upsert_organization", "upsert_contact", "create_task"],
  outreach: ["create_gmail_draft", "create_task", "create_notification", "send_email"],
  career_strategist: ["classify_record", "score_opportunity", "create_task", "generate_report", "prepare_application_materials", "submit_job_application", "submit_university_application"],
  revenue_intelligence: ["fetch_public_source", "extract_opportunity", "classify_record", "verify_source", "dedupe_records", "upsert_organization", "upsert_contact", "update_pipeline", "create_task", "prepare_external_crm_update", "push_external_crm_update"],
  executive_coordinator: ["create_task", "create_notification", "generate_report"],
};
