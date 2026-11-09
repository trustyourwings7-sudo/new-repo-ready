import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetSummarySchema, type BudgetSummary } from "@/lib/budget/governor";

/** Each section loads independently so one failure never blanks the dashboard. */
export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch {
    // Do not leak database error text into the UI.
    return { ok: false, error: "Could not load this section." };
  }
}

async function count(sb: SupabaseClient, table: string, apply?: (q: any) => any): Promise<number> {
  let q = sb.from(table).select("id", { count: "exact", head: true });
  if (apply) q = apply(q);
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

export interface OpportunityRow {
  id: string;
  title: string;
  category: string;
  deadline: string | null;
  qualification_score: number | null;
  eligibility_status: string;
  status: string;
  source_url: string;
  last_verified_at: string | null;
  recommended_action: string | null;
  missing_information: string[];
}

const FUNDING = ["education", "scholarship", "grant", "funding", "accelerator"];
const OPEN_STATUSES = ["new", "reviewing", "qualified", "pursuing"];

function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ProjectRow { id: string; slug: string; name: string; kind: string }

export async function loadProjects(sb: SupabaseClient): Promise<ProjectRow[]> {
  const { data, error } = await sb.from("projects").select("id,slug,name,kind").eq("status", "active").order("name");
  if (error) return [];
  return (data ?? []) as ProjectRow[];
}

export async function loadDashboard(sb: SupabaseClient, opts: { q?: string; category?: string; projectId?: string }) {
  const nowIso = new Date().toISOString();
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const q = opts.q?.trim().slice(0, 100) || undefined;
  const category = opts.category && /^[a-z_]{1,32}$/.test(opts.category) ? opts.category : undefined;
  const projectId = opts.projectId && /^[0-9a-f-]{36}$/i.test(opts.projectId) ? opts.projectId : undefined;

  const filter = (query: any) => {
    let out = query;
    if (q) out = out.ilike("title", `%${escapeLike(q)}%`);
    if (category) out = out.eq("category", category);
    if (projectId) out = out.eq("project_id", projectId);
    return out;
  };
  const byProject = (query: any) => (projectId ? query.eq("project_id", projectId) : query);

  const [overview, priority, career, funding, commercial, outreach, deadlines, agents, research, budget] = await Promise.all([
    section(async () => {
      const [total, open, verified, ineligible] = await Promise.all([
        count(sb, "opportunities", byProject),
        count(sb, "opportunities", (x) => byProject(x.in("status", OPEN_STATUSES))),
        count(sb, "opportunities", (x) => byProject(x.not("last_verified_at", "is", null))),
        count(sb, "opportunities", (x) => byProject(x.eq("eligibility_status", "ineligible"))),
      ]);
      return { total, open, verified, ineligible };
    }),
    section(async () => {
      const { data, error } = await filter(
        sb
          .from("opportunities")
          .select("id,title,category,deadline,qualification_score,eligibility_status,status,source_url,last_verified_at,recommended_action,missing_information")
          .in("status", OPEN_STATUSES)
          .neq("eligibility_status", "ineligible")
          .not("qualification_score", "is", null)
          .order("qualification_score", { ascending: false })
          .limit(8),
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as OpportunityRow[];
    }),
    section(async () => {
      const [preparing, submitted, interviews, offers] = await Promise.all([
        count(sb, "applications", (x) => x.in("status", ["preparing", "ready_for_review"])),
        count(sb, "applications", (x) => x.eq("status", "submitted")),
        count(sb, "applications", (x) => x.eq("status", "interview")),
        count(sb, "applications", (x) => x.in("status", ["offer", "accepted"])),
      ]);
      return { preparing, submitted, interviews, offers };
    }),
    section(async () => {
      const [open, applied, won] = await Promise.all([
        count(sb, "opportunities", (x) => x.in("category", FUNDING).in("status", OPEN_STATUSES)),
        count(sb, "opportunities", (x) => x.in("category", FUNDING).eq("status", "applied")),
        count(sb, "opportunities", (x) => x.in("category", FUNDING).eq("status", "won")),
      ]);
      return { open, applied, won };
    }),
    section(async () => {
      const [prospects, qualified, won] = await Promise.all([
        count(sb, "client_pipeline", (x) => byProject(x.in("stage", ["prospect", "researching"]))),
        count(sb, "client_pipeline", (x) => byProject(x.in("stage", ["qualified", "contacted", "meeting", "proposal", "negotiation"]))),
        count(sb, "client_pipeline", (x) => byProject(x.eq("stage", "won"))),
      ]);
      return { prospects, qualified, won };
    }),
    section(async () => {
      const [drafts, awaitingApproval, sent, followUpsDue] = await Promise.all([
        count(sb, "outreach", (x) => x.in("status", ["draft_internal", "gmail_draft_created"])),
        count(sb, "approval_requests", (x) => x.eq("status", "pending")),
        count(sb, "outreach", (x) => x.eq("status", "sent")),
        count(sb, "outreach", (x) => x.lte("follow_up_due", in30).in("status", ["sent", "gmail_draft_created"])),
      ]);
      return { drafts, awaitingApproval, sent, followUpsDue };
    }),
    section(async () => {
      const { data, error } = await filter(
        sb
          .from("opportunities")
          .select("id,title,category,deadline,source_url")
          .gte("deadline", nowIso)
          .lte("deadline", in30)
          .in("status", OPEN_STATUSES)
          .order("deadline", { ascending: true })
          .limit(10),
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as Pick<OpportunityRow, "id" | "title" | "category" | "deadline" | "source_url">[];
    }),
    section(async () => {
      const { data, error } = await sb
        .from("agent_runs")
        .select("agent,status,created_at,finished_at,error")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      const latest = new Map<string, { status: string; created_at: string }>();
      for (const r of data ?? []) if (!latest.has(r.agent)) latest.set(r.agent, r);
      return latest;
    }),
    section(async () => {
      const { data, error } = await sb
        .from("opportunity_sources")
        .select("id,url,source_type,verification_status,retrieved_at")
        .order("retrieved_at", { ascending: false })
        .limit(6);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
    section(async (): Promise<BudgetSummary> => {
      const { data, error } = await sb.rpc("budget_summary", {});
      if (error) throw new Error(error.message);
      return budgetSummarySchema.parse(data);
    }),
  ]);

  return { overview, priority, career, funding, commercial, outreach, deadlines, agents, research, budget };
}
