/**
 * Module registry. Status is honest: nothing is shown as working unless it is.
 *  - "available":     usable now
 *  - "schema_ready":  database tables + security exist; UI/automation in a later phase
 *  - "planned":       not started
 */
export type ModuleStatus = "available" | "schema_ready" | "planned";

export interface ModuleDef {
  slug: string;
  letter: string;
  name: string;
  status: ModuleStatus;
  phase: number;
  summary: string;
  tables: string[];
}

export const MODULES: readonly ModuleDef[] = [
  { slug: "", letter: "A", name: "Command Dashboard", status: "available", phase: 1, summary: "Overview of pipelines, deadlines, agents and spend.", tables: [] },
  { slug: "opportunities", letter: "B", name: "Opportunity Intelligence", status: "available", phase: 2, summary: "Every stored opportunity with sources, deadlines and verification.", tables: ["opportunities", "opportunity_sources"] },
  { slug: "career", letter: "C", name: "Employment & Career", status: "schema_ready", phase: 5, summary: "Role matching, applications, interviews and skills gaps.", tables: ["applications", "skills"] },
  { slug: "funding", letter: "D", name: "Education & Funding", status: "schema_ready", phase: 2, summary: "Programs, scholarships, grants and accelerators.", tables: ["opportunities"] },
  { slug: "contacts", letter: "E", name: "Organizations & Contacts", status: "schema_ready", phase: 3, summary: "Publicly listed decision-makers with source URLs.", tables: ["organizations", "contacts"] },
  { slug: "outreach", letter: "F", name: "Outreach & Communications", status: "schema_ready", phase: 3, summary: "Personalized drafts and Gmail drafts. Nothing is sent without approval.", tables: ["outreach", "approval_requests"] },
  { slug: "revenue", letter: "G", name: "Revenue & Commercial Pipeline", status: "schema_ready", phase: 4, summary: "Prospects in schools, clinics, travel and hospitality.", tables: ["client_pipeline"] },
  { slug: "agents", letter: "H", name: "Agent Management", status: "schema_ready", phase: 2, summary: "Agent runs, tasks, limits and failures.", tables: ["agent_runs", "agent_tasks"] },
  { slug: "tasks", letter: "I", name: "Tasks & Activities", status: "available", phase: 5, summary: "Open tasks, upcoming deadlines, research runs and projects.", tables: ["activities", "notifications"] },
  { slug: "profile", letter: "J", name: "Personal Profile & Skills", status: "schema_ready", phase: 5, summary: "Source-tracked profile facts. Agents may only cite what is here.", tables: ["user_profiles", "profile_entries", "skills", "documents"] },
  { slug: "budget", letter: "K", name: "Budget & Usage", status: "available", phase: 1, summary: "Hard $10/month governor, per-provider limits and usage.", tables: ["budgets", "usage_records", "provider_configs"] },
  { slug: "settings", letter: "L", name: "Settings & Security", status: "available", phase: 1, summary: "Integration status, permission levels and audit log.", tables: ["user_preferences", "audit_logs", "automation_integrations", "automation_requests", "projects"] },
];

export function moduleBySlug(slug: string): ModuleDef | undefined {
  return MODULES.find((m) => m.slug === slug);
}
