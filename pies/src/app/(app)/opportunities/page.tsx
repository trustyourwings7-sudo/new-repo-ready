import Link from "next/link";
import { Badge, Card, Empty, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { loadProjects } from "@/lib/dashboard";

const CATEGORIES = ["employment", "education", "scholarship", "grant", "funding", "accelerator", "partnership", "consulting", "commercial", "other"];
const STATUSES = ["open", "all", "archived"] as const;
const OPEN = ["new", "reviewing", "qualified", "pursuing"];

interface Source { url: string; source_type: string; verification_status: string; evidence_excerpt: string | null; retrieved_at: string }
interface Row {
  id: string;
  title: string;
  category: string;
  deadline: string | null;
  status: string;
  eligibility_status: string;
  qualification_score: number | null;
  source_url: string;
  recommended_action: string | null;
  missing_information: string[] | null;
  project_id: string | null;
  created_at: string;
  opportunity_sources: Source[];
}

function fmt(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function host(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid url";
  }
}
function daysLeft(iso: string) {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}
function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Read-only list of every stored opportunity with its sources and deadline evidence. */
export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const category = typeof sp.category === "string" && CATEGORIES.includes(sp.category) ? sp.category : "";
  const show = (STATUSES as readonly string[]).includes(String(sp.show)) ? String(sp.show) : "open";
  const projectSlug = typeof sp.project === "string" ? sp.project : "";

  const session = await getSession();
  const live = session.kind === "signed_in";
  const projects = live ? await loadProjects(session.supabase) : [];
  const projectId = projects.find((p) => p.slug === projectSlug)?.id;
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  let rows: Row[] = [];
  let failed = false;
  if (live) {
    let query = session.supabase
      .from("opportunities")
      .select("id,title,category,deadline,status,eligibility_status,qualification_score,source_url,recommended_action,missing_information,project_id,created_at,opportunity_sources(url,source_type,verification_status,evidence_excerpt,retrieved_at)")
      .order("deadline", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (show === "open") query = query.in("status", OPEN);
    if (show === "archived") query = query.eq("status", "archived");
    if (q) query = query.ilike("title", `%${escapeLike(q)}%`);
    if (category) query = query.eq("category", category);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) failed = true;
    else rows = (data ?? []) as unknown as Row[];
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">B · Opportunity Intelligence</h1>
          <p className="text-sm text-mist-400">Every stored opportunity, nearest deadline first. Read-only: nothing is applied for or sent from here.</p>
        </div>
        <form className="flex flex-wrap gap-2" role="search" aria-label="Filter opportunities">
          <label className="sr-only" htmlFor="q">Search titles</label>
          <input id="q" name="q" defaultValue={q} maxLength={100} placeholder="Search titles…" className="w-full rounded border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm placeholder:text-mist-400 sm:w-48" />
          <label className="sr-only" htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={category} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="sr-only" htmlFor="project">Project</label>
          <select id="project" name="project" defaultValue={projectSlug} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="show">Status</label>
          <select id="show" name="show" defaultValue={show} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm">
            <option value="open">Open</option>
            <option value="all">All</option>
            <option value="archived">Archived</option>
          </select>
          <button className="rounded bg-signal-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-signal-400">Filter</button>
        </form>
      </header>

      {failed ? <Notice tone="bad">Could not load opportunities.</Notice> : null}

      <Card id="list" title={`${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}`} aside={show}>
        {!live ? (
          <Empty>Not connected. Configure Supabase to see real data.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No opportunities match. Daily research adds new ones each morning (07:17 Kigali).</Empty>
        ) : (
          <ul className="divide-y divide-ink-800">
            {rows.map((o) => {
              const official = o.opportunity_sources.find((s) => s.source_type === "official");
              const verified = o.opportunity_sources.some((s) => s.verification_status === "verified");
              const d = fmt(o.deadline);
              const left = o.deadline ? daysLeft(o.deadline) : null;
              return (
                <li key={o.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <a href={o.source_url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-words font-medium underline decoration-ink-700 underline-offset-2 hover:decoration-mist-300">
                      {o.title}
                    </a>
                    <span className="shrink-0 text-sm">
                      {d ? (
                        <span className={left !== null && left <= 14 ? "text-warn-400" : ""}>
                          Deadline {d}{left !== null ? ` · ${left < 0 ? "passed" : `${left} days`}` : ""}
                        </span>
                      ) : (
                        <Badge kind="missing">deadline not found</Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs">
                    <Badge kind="neutral">{o.category}</Badge>
                    <Badge kind="neutral">{o.status}</Badge>
                    {verified ? <Badge kind="verified">verified on official site</Badge> : official ? <Badge kind="estimate">official source, unverified</Badge> : <Badge kind="missing">third-party source</Badge>}
                    {o.eligibility_status !== "unknown" ? <Badge kind={o.eligibility_status === "ineligible" ? "missing" : "recommendation"}>{o.eligibility_status}</Badge> : null}
                    {o.qualification_score !== null ? <Badge kind="recommendation">score {o.qualification_score}</Badge> : null}
                    {o.project_id && projectName.get(o.project_id) ? <Badge kind="neutral">{projectName.get(o.project_id)}</Badge> : null}
                    <span className="text-mist-400">{host(o.source_url)} · found {fmt(o.created_at)}</span>
                  </div>
                  {o.recommended_action ? <p className="text-sm text-mist-300">{o.recommended_action}</p> : null}
                  {o.missing_information && o.missing_information.length ? (
                    <p className="text-xs text-mist-400">Missing: {o.missing_information.join(", ")}</p>
                  ) : null}
                  {o.opportunity_sources.length ? (
                    <details className="text-xs text-mist-400">
                      <summary className="cursor-pointer">Sources and evidence ({o.opportunity_sources.length})</summary>
                      <ul className="mt-1 space-y-1">
                        {o.opportunity_sources.map((s) => (
                          <li key={s.url} className="break-words">
                            <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{host(s.url)}</a> · {s.source_type} · {s.verification_status} · retrieved {fmt(s.retrieved_at)}
                            {s.evidence_excerpt ? <div className="mt-0.5 whitespace-pre-line text-mist-300">“{s.evidence_excerpt.slice(0, 400)}”</div> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-mist-400">
        Want a deadline you can trust? Open the official link and confirm it there. <Link className="underline" href="/tasks">Tasks</Link> lists upcoming deadlines.
      </p>
    </>
  );
}
