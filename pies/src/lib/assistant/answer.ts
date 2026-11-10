import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetSummarySchema, totals } from "@/lib/budget/governor";
import { explainStop } from "./explain";
import { type Intent } from "./intent";
import { appRunTitle, getRunMetrics, getSteps, hasActionsToken, listRuns, type WorkflowRun } from "./github";

import type { Tone } from "./explain";
export type { Tone };

export interface ReplyItem {
  title: string;
  detail?: string;
  href?: string;
  tone?: Tone;
}

export interface Reply {
  text: string;
  tone?: Tone;
  items?: ReplyItem[];
  /** A button the owner must press. Research never starts from typing alone. */
  confirm?: { label: string; query: string | null; category: string; estimate: string };
  /** Answers to several commands sent in one message, shown one after another. */
  sections?: Reply[];
  /** Live status of an app-started research run. */
  track?: { requestId: string };
  suggestions?: string[];
}

export const MANUAL_DAILY_LIMIT = 3;
const OPEN = ["new", "reviewing", "qualified", "pursuing"];
const SUGGEST = ["Show my deadlines", "Find scholarships in Canada", "Research now", "Explain why today's research failed", "Check PIES health", "Show my budget"];

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const daysLeft = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const todayUtc = () => new Date().toISOString().slice(0, 10);
function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function helpReply(prefix?: string): Reply {
  return {
    text:
      (prefix ? `${prefix}\n\n` : "") +
      "I understand these commands (plain words are fine). I answer from your stored PIES data; I am not a general chatbot.",
    items: [
      { title: "Find scholarships in Canada", detail: "Live research for anything you name. Asks you to confirm first; uses 1 search + up to 4 pages." },
      { title: "Research now", detail: "Runs today's configured queries immediately (confirm first)." },
      { title: "Show my deadlines / Show my tasks", detail: "Upcoming deadlines and open follow-ups." },
      { title: "Show opportunities about Canada", detail: "Search what research already saved." },
      { title: "Explain why today's research failed", detail: "Diagnoses the latest runs: causes and fixes." },
      { title: "Check PIES health / Show my budget / Research status", detail: "System checks, spending and live run progress." },
      { title: "Show contacts at <organization>", detail: "Organizations and public contacts on file." },
    ],
    suggestions: SUGGEST,
  };
}

async function monthUsage(sb: SupabaseClient) {
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [usage, providers, summary] = await Promise.all([
    sb.from("usage_records").select("provider,status,estimated_usd,actual_usd").eq("period_month", month),
    sb.from("provider_configs").select("provider,enabled,pricing_verified,monthly_cap_usd"),
    sb.rpc("budget_summary", {}),
  ]);
  const spent = new Map<string, number>();
  for (const u of usage.data ?? []) {
    if (u.status === "released") continue;
    const v = Number(u.actual_usd ?? u.estimated_usd ?? 0);
    spent.set(u.provider, (spent.get(u.provider) ?? 0) + v);
  }
  const parsed = budgetSummarySchema.safeParse(summary.data);
  return {
    providers: (providers.data ?? []).map((p) => ({ ...p, cap: p.monthly_cap_usd === null ? null : Number(p.monthly_cap_usd), spent: spent.get(p.provider) ?? 0 })),
    summary: parsed.success ? parsed.data : null,
    error: Boolean(usage.error || providers.error || summary.error || !parsed.success),
  };
}

async function deadlines(sb: SupabaseClient): Promise<Reply> {
  const [opps, tasks] = await Promise.all([
    sb.from("opportunities").select("title,deadline,source_url,category").gte("deadline", new Date().toISOString()).in("status", OPEN).order("deadline").limit(20),
    sb.from("activities").select("title,due_at").is("completed_at", null).not("due_at", "is", null).order("due_at").limit(10),
  ]);
  if (opps.error || tasks.error) return { text: "I could not load deadlines from the database.", tone: "bad" };
  const items: ReplyItem[] = (opps.data ?? []).map((o) => {
    const d = daysLeft(o.deadline as string);
    return { title: o.title, detail: `${fmt(o.deadline)} · ${d} days · ${o.category}`, href: o.source_url, tone: d <= 14 ? "warn" : "info" };
  });
  const due = (tasks.data ?? []).map((t) => ({ title: `Task: ${t.title}`, detail: `due ${fmt(t.due_at)}`, tone: "info" as Tone }));
  if (!items.length && !due.length) {
    return { text: "No stored opportunity has a known future deadline, and no task has a due date. Research marks a deadline only when it can quote it from the page.", tone: "info", suggestions: ["Find scholarships in Canada", "Show opportunities"] };
  }
  return {
    text: `${items.length} upcoming deadline${items.length === 1 ? "" : "s"}${due.length ? ` and ${due.length} task due date${due.length === 1 ? "" : "s"}` : ""}. Confirm every date on the official page before acting.`,
    items: [...items, ...due],
  };
}

async function tasks(sb: SupabaseClient): Promise<Reply> {
  const { data, error } = await sb.from("activities").select("title,due_at,kind").is("completed_at", null).order("due_at", { ascending: true, nullsFirst: false }).limit(20);
  if (error) return { text: "I could not load tasks.", tone: "bad" };
  if (!data?.length) return { text: "No open tasks.", tone: "info" };
  return { text: `${data.length} open task${data.length === 1 ? "" : "s"} (nearest due first).`, items: data.map((t) => ({ title: t.title, detail: t.due_at ? `due ${fmt(t.due_at)}` : "no due date" })) };
}

async function opportunities(sb: SupabaseClient, search: string | null): Promise<Reply> {
  let q = sb.from("opportunities").select("title,deadline,source_url,category,status,last_verified_at").in("status", OPEN).order("created_at", { ascending: false }).limit(15);
  if (search) {
    const words = search.split(/\s+/).filter((w) => w.length > 2 && !/^(in|for|and|the|with|from)$/i.test(w)).slice(0, 4);
    for (const w of words) q = q.or(`title.ilike.%${escapeLike(w).replace(/[,()]/g, " ")}%,description.ilike.%${escapeLike(w).replace(/[,()]/g, " ")}%`);
  }
  const { data, error } = await q;
  if (error) return { text: "I could not search stored opportunities.", tone: "bad" };
  if (!data?.length) {
    return {
      text: search ? `Nothing saved matches "${search}" yet.` : "No open opportunities are saved yet.",
      tone: "info",
      ...(search ? { confirm: { label: `Research "${search}" now`, query: search, category: "scholarship", estimate: "about $0.05" } } : {}),
    };
  }
  return {
    text: `${data.length} saved opportunit${data.length === 1 ? "y" : "ies"}${search ? ` matching "${search}"` : ""}.`,
    items: data.map((o) => ({
      title: o.title,
      detail: `${o.category} · ${o.deadline ? `deadline ${fmt(o.deadline)}` : "deadline not found"} · ${o.last_verified_at ? "verified on official site" : "unverified"}`,
      href: o.source_url,
      tone: o.last_verified_at ? "ok" : "info",
    })),
  };
}

async function contacts(sb: SupabaseClient, search: string | null): Promise<Reply> {
  let orgs = sb.from("organizations").select("id,name,website,country").order("name").limit(20);
  if (search) orgs = orgs.ilike("name", `%${escapeLike(search)}%`);
  const o = await orgs;
  if (o.error) return { text: "I could not load organizations.", tone: "bad" };
  const ids = (o.data ?? []).map((x) => x.id);
  const c = ids.length ? await sb.from("contacts").select("full_name,role_title,organization_id,source_url").in("organization_id", ids).limit(50) : { data: [], error: null };
  if (!o.data?.length) return { text: search ? `No organization on file matches "${search}".` : "No organizations on file yet. Research adds organizations only with a source.", tone: "info" };
  const byOrg = new Map<string, number>();
  for (const x of c.data ?? []) byOrg.set(x.organization_id, (byOrg.get(x.organization_id) ?? 0) + 1);
  return {
    text: `${o.data.length} organization${o.data.length === 1 ? "" : "s"}. Open Organizations & Contacts to manage them.`,
    items: o.data.map((x) => ({ title: x.name, detail: `${x.country ?? "country unknown"} · ${byOrg.get(x.id) ?? 0} contact(s)`, href: x.website ?? undefined })),
  };
}

async function budget(sb: SupabaseClient): Promise<Reply> {
  const u = await monthUsage(sb);
  if (u.error || !u.summary) return { text: "I could not load budget data.", tone: "bad" };
  const t = totals(u.summary);
  const research = u.providers.filter((p) => p.provider === "exa" || p.provider === "firecrawl");
  return {
    text: `This month: ${money(t.committed)} spent, ${money(t.pending)} reserved, ${money(t.remaining)} left of the $10.00 hard cap. Paid research is ${u.summary.paid_operations_enabled ? "ON" : "OFF (paused)"}.`,
    tone: u.summary.paid_operations_enabled ? "ok" : "warn",
    items: research.map((p) => ({
      title: p.provider === "exa" ? "Exa (search)" : "Firecrawl (page reading)",
      detail: `${money(p.spent)} of ${p.cap === null ? "no cap" : money(p.cap)} this month · ${p.enabled ? "enabled" : "disabled"}${p.pricing_verified ? "" : " · pricing unverified"}`,
      tone: p.cap !== null && p.spent >= p.cap * 0.9 ? "warn" : "info",
    })),
  };
}

async function appRunsToday(): Promise<WorkflowRun[]> {
  const runs = await listRuns(30);
  const today = todayUtc();
  // The daily timer's run ("app-sched-…") is the scheduled run, not one of the owner's manual runs.
  return runs.filter((r) => r.title.startsWith("PIES research app-") && !r.title.startsWith("PIES research app-sched-") && r.createdAt.startsWith(today));
}

/** Pre-flight for live research: refuses with a reason instead of starting anything doomed. */
export async function researchPreflight(sb: SupabaseClient): Promise<{ ok: true; usedToday: number } | { ok: false; reason: string }> {
  if (!hasActionsToken()) return { ok: false, reason: "Research Now is not connected yet: the app has no GitHub Actions token. Daily scheduled research is unaffected." };
  const u = await monthUsage(sb);
  if (u.error || !u.summary) return { ok: false, reason: "I could not read the budget, so I will not start paid research." };
  if (!u.summary.paid_operations_enabled) return { ok: false, reason: "Paid research is switched OFF (paused). Nothing will be started." };
  for (const p of u.providers.filter((x) => x.provider === "exa" || x.provider === "firecrawl")) {
    if (!p.enabled || !p.pricing_verified) return { ok: false, reason: `${p.provider} is disabled or its pricing is unverified.` };
    if (p.cap !== null && p.spent + 0.05 > p.cap) return { ok: false, reason: `${p.provider} has reached its monthly cap (${money(p.spent)} of ${money(p.cap)}). Research resumes next month.` };
  }
  let used: number;
  try {
    used = (await appRunsToday()).length;
  } catch {
    return { ok: false, reason: "GitHub did not answer, so I cannot check today's limit. Try again in a minute." };
  }
  if (used >= MANUAL_DAILY_LIMIT) return { ok: false, reason: `You already started ${used} research runs today (limit ${MANUAL_DAILY_LIMIT}/day, which protects the $1.95 monthly research cap). Daily research still runs on schedule.` };
  return { ok: true, usedToday: used };
}

async function researchOffer(sb: SupabaseClient, query: string | null, category: string): Promise<Reply> {
  const pre = await researchPreflight(sb);
  if (!pre.ok) return { text: pre.reason, tone: "warn" };
  const estimate = query ? "about $0.05 (1 search + up to 4 official pages)" : "about $0.06 (3 searches + 4 official pages)";
  return {
    text: query
      ? `I can research "${query}" (${category}) now. It runs in GitHub Actions, takes about 1-3 minutes, and saves results for your review only. Nothing is sent or applied for.`
      : "I can run today's configured research queries now. Results are saved for your review only.",
    confirm: { label: query ? `Research "${query}" now` : "Run research now", query, category, estimate: `${estimate}; ${MANUAL_DAILY_LIMIT - pre.usedToday} of ${MANUAL_DAILY_LIMIT} manual runs left today` },
  };
}

async function health(sb: SupabaseClient): Promise<Reply> {
  const items: ReplyItem[] = [];
  // The first call on a cold server includes connection setup; time a second, warm call.
  await sb.from("projects").select("id", { head: true, count: "exact" });
  const t0 = performance.now();
  const ping = await sb.from("projects").select("id", { head: true, count: "exact" });
  const dbMs = Math.round(performance.now() - t0);
  items.push({ title: "Database", detail: ping.error ? "not reachable" : `reachable · ${dbMs} ms from server region ${process.env.VERCEL_REGION ?? "local"}`, tone: ping.error ? "bad" : dbMs > 300 ? "warn" : "ok" });

  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const s = (await r.json()) as { disable_signup?: boolean };
    items.push({ title: "Sign-ups", detail: s.disable_signup ? "disabled (only the owner account exists)" : "OPEN: anyone can create an account. Turn off in Supabase Auth settings.", tone: s.disable_signup ? "ok" : "bad" });
  } catch {
    items.push({ title: "Sign-ups", detail: "could not check", tone: "warn" });
  }

  const u = await monthUsage(sb);
  if (u.summary) {
    const t = totals(u.summary);
    items.push({ title: "Paid research switch", detail: u.summary.paid_operations_enabled ? "ON" : "OFF (paused)", tone: u.summary.paid_operations_enabled ? "ok" : "warn" });
    items.push({ title: "Budget", detail: `${money(t.committed)} spent of $10.00 this month`, tone: t.remaining < 1 ? "warn" : "ok" });
    for (const p of u.providers.filter((x) => x.provider === "exa" || x.provider === "firecrawl")) {
      const okP = p.enabled && p.pricing_verified && (p.cap === null || p.spent < p.cap);
      items.push({ title: `Provider ${p.provider}`, detail: `${p.enabled ? "enabled" : "disabled"}, ${p.pricing_verified ? "pricing verified" : "pricing unverified"}, ${money(p.spent)} of ${p.cap === null ? "no cap" : money(p.cap)}`, tone: okP ? "ok" : "warn" });
    }
  } else items.push({ title: "Budget", detail: "could not load", tone: "bad" });

  const last = await sb.from("agent_runs").select("status,trigger,started_at,error").eq("status", "succeeded").order("started_at", { ascending: false }).limit(1);
  const lastOk = last.data?.[0];
  const ageH = lastOk?.started_at ? Math.round((Date.now() - Date.parse(lastOk.started_at)) / 3_600_000) : null;
  items.push({ title: "Last successful research", detail: lastOk ? `${fmt(lastOk.started_at)} (${ageH} h ago, ${lastOk.trigger})` : "none recorded", tone: ageH !== null && ageH <= 36 ? "ok" : "warn" });

  try {
    const runs = await listRuns(10);
    const sched = runs.find((r) => r.event === "schedule" || r.title.includes("app-sched-"));
    items.push({ title: "Scheduled workflow (GitHub)", detail: sched ? `last ${sched.status === "completed" ? sched.conclusion : sched.status} at ${sched.createdAt.slice(0, 16).replace("T", " ")} UTC` : "no scheduled run found", href: sched?.url, tone: sched?.conclusion === "failure" ? "bad" : "ok" });
  } catch {
    items.push({ title: "Scheduled workflow (GitHub)", detail: "GitHub did not answer", tone: "warn" });
  }
  items.push({ title: "Research Now", detail: hasActionsToken() ? "connected" : "not connected (needs a GitHub Actions token on Vercel)", tone: hasActionsToken() ? "ok" : "warn" });
  const bad = items.filter((i) => i.tone === "bad").length;
  const warn = items.filter((i) => i.tone === "warn").length;
  return { text: bad ? `${bad} problem${bad === 1 ? "" : "s"} and ${warn} warning${warn === 1 ? "" : "s"}.` : warn ? `Working, with ${warn} warning${warn === 1 ? "" : "s"}.` : "All checks passed.", tone: bad ? "bad" : warn ? "warn" : "ok", items };
}

async function diagnose(sb: SupabaseClient): Promise<Reply> {
  const [runsRes, ghRuns] = await Promise.all([
    sb.from("agent_runs").select("status,trigger,error,items_processed,cost_usd,started_at,finished_at").order("started_at", { ascending: false }).limit(10),
    listRuns(15).catch(() => null),
  ]);
  const runs = runsRes.data ?? [];
  const items: ReplyItem[] = [];
  const today = todayUtc();
  const todays = runs.filter((r) => (r.started_at ?? "").startsWith(today));
  const didResearchToday = todays.some((r) => r.status === "succeeded");

  // 1. Schedule: did GitHub start today's run at all?
  if (ghRuns) {
    const schedToday = ghRuns.filter((r) => (r.event === "schedule" || r.title.includes("app-sched-")) && r.createdAt.startsWith(today));
    const hourUtc = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
    if (!schedToday.length && hourUtc > 5.5) {
      items.push({ title: "GitHub has not started today's scheduled run yet", detail: `Planned: the PIES daily timer (Vercel, about 05:17 UTC) plus GitHub's backup tries at 05:17, 06:47 and 09:17 UTC. GitHub often skips its tries; if the timer also failed, check health. Fix now: say "Research now".`, tone: hourUtc > 10 ? "warn" : "info" });
    }
    const failed = ghRuns.find((r) => r.status === "completed" && r.conclusion === "failure");
    if (failed && failed.createdAt.startsWith(today)) {
      const m = await getRunMetrics(failed.id).catch(() => null);
      const steps = await getSteps(failed.id).catch(() => []);
      const badStep = steps.find((s) => s.conclusion === "failure");
      const reason = m && typeof m.stoppedEarly === "string" ? m.stoppedEarly : m && typeof m.error === "string" ? m.error : null;
      const ex = reason ? explainStop(reason) : null;
      items.push({
        title: `GitHub run failed at ${failed.createdAt.slice(11, 16)} UTC${badStep ? ` (step: ${badStep.name})` : ""}`,
        detail: ex ? `${ex.cause} Fix: ${ex.fix}` : badStep && badStep.name !== "Research run (metrics only)" ? "The runner never started (setup or dependency install failed). Fix: open the run log; usually a temporary GitHub problem, so run again." : reason ? `Runner said: ${reason}. Open the log for details.` : "The runner stopped with an error before printing metrics, often a database connection or secret problem. Open the log.",
        href: failed.url,
        tone: "bad",
      });
    }
  } else items.push({ title: "GitHub did not answer", detail: "Could not read workflow runs. Try again in a minute.", tone: "warn" });

  // 2. Database record of each recent run.
  for (const r of runs.slice(0, 4)) {
    const ex = r.error ? explainStop(r.error) : null;
    const label = r.status === "cancelled" ? "skipped" : r.status;
    items.push({
      title: `${(r.started_at ?? "").slice(0, 16).replace("T", " ")} UTC · ${r.trigger} run ${label}`,
      detail: ex ? `${ex.cause} Fix: ${ex.fix}` : r.error ? `Stopped: ${r.error.slice(0, 160)}` : `${r.items_processed ?? 0} pages processed${r.status === "succeeded" && (r.items_processed ?? 0) <= 1 ? " (very little was processed: queries may be too narrow, or pages blocked)" : ""}.`,
      tone: ex?.tone ?? (r.status === "failed" ? "bad" : "info"),
    });
  }

  // 3. Latest run's own metrics (outcome, saved, verified) from its log line.
  const latestRun = ghRuns?.find((r) => r.status === "completed" && r.conclusion !== "cancelled");
  if (latestRun) {
    const m = await getRunMetrics(latestRun.id).catch(() => null);
    const mm = (m?.metrics ?? null) as Record<string, number> | null;
    if (m && mm) {
      const outcome = String(m.outcome);
      const tone: Tone = outcome === "productive" ? "ok" : outcome === "low_yield" || outcome === "empty" ? "warn" : outcome === "blocked" ? "bad" : "info";
      const why =
        outcome === "low_yield"
          ? " Low yield: pages were read but few had an official deadline or matched your profile. Fix: try more specific searches (country + level + 'deadline 2027')."
          : outcome === "empty"
            ? " Empty: the searches returned nothing new (everything was already saved or excluded)."
            : "";
      items.push({ title: `Latest run result: ${outcome}`, detail: `${mm.queries ?? 0} searches, ${mm.extracted ?? 0} pages read, ${mm.persisted ?? 0} saved, ${mm.verified ?? 0} verified, ${mm.rejected ?? 0} rejected, ${mm.failed ?? 0} failed, cost $${Number(mm.committedUsd ?? 0).toFixed(4)}.${why}`, href: latestRun.url, tone });
    }
  }

  const problems = items.filter((i) => i.tone === "bad").length;
  const text = didResearchToday
    ? problems
      ? `Research did run today, but I found ${problems} problem${problems === 1 ? "" : "s"}.`
      : "Research ran today. Nothing failed; details below."
    : problems
      ? `Today's research has not succeeded. ${problems} problem${problems === 1 ? "" : "s"} found; causes and fixes below.`
      : "Today's research has not run yet. Nothing has failed; details below.";
  return { text, tone: problems ? "bad" : didResearchToday ? "ok" : "warn", items, suggestions: didResearchToday ? ["Show opportunities"] : ["Research now", "Check PIES health"] };
}

async function status(sb: SupabaseClient): Promise<Reply> {
  let runs: WorkflowRun[];
  try {
    runs = await listRuns(5);
  } catch {
    return { text: "GitHub did not answer.", tone: "warn" };
  }
  const active = runs.find((r) => r.status !== "completed");
  if (active) {
    const m = active.title.match(/app-([a-z0-9-]+)$/);
    return { text: `Research is ${active.status.replace("_", " ")} (started ${active.createdAt.slice(11, 16)} UTC).`, tone: "info", ...(m ? { track: { requestId: m[1]! } } : {}), items: [{ title: active.title, href: active.url }] };
  }
  const last = runs[0];
  const db = await sb.from("agent_runs").select("status,trigger,items_processed,started_at,error").order("started_at", { ascending: false }).limit(1);
  const r = db.data?.[0];
  return {
    text: "No research is running right now.",
    items: [
      ...(last ? [{ title: `Last GitHub run: ${last.conclusion ?? last.status} (${last.event})`, detail: `${last.createdAt.slice(0, 16).replace("T", " ")} UTC`, href: last.url }] : []),
      ...(r ? [{ title: `Last recorded run: ${r.status === "cancelled" ? "skipped" : r.status} (${r.trigger})`, detail: `${(r.started_at ?? "").slice(0, 16).replace("T", " ")} UTC · ${r.items_processed ?? 0} items${r.error ? ` · ${r.error.slice(0, 80)}` : ""}` }] : []),
    ],
  };
}

export async function answer(sb: SupabaseClient, intent: Intent): Promise<Reply> {
  try {
    switch (intent.kind) {
      case "help":
        return helpReply();
      case "deadlines":
        return await deadlines(sb);
      case "tasks":
        return await tasks(sb);
      case "budget":
        return await budget(sb);
      case "health":
        return await health(sb);
      case "diagnose":
        return await diagnose(sb);
      case "status":
        return await status(sb);
      case "opportunities":
        return await opportunities(sb, intent.search);
      case "contacts":
        return await contacts(sb, intent.search);
      case "research":
        return await researchOffer(sb, intent.query, intent.category);
    }
  } catch {
    return { text: "Something went wrong while answering. Nothing was started or changed.", tone: "bad" };
  }
}

export { appRunTitle, explainStop };
