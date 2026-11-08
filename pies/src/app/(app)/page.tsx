import Link from "next/link";
import { Badge, Card, Empty, Stat, money } from "@/components/ui";
import { AGENTS } from "@/lib/agents/registry";
import { getSession } from "@/lib/auth";
import { totals } from "@/lib/budget/governor";
import { loadDashboard, loadProjects, type ProjectRow, type Section } from "@/lib/dashboard";

const CATEGORIES = ["employment", "education", "scholarship", "grant", "funding", "accelerator", "partnership", "consulting", "commercial", "other"];

function Failed() {
  return <Empty>Could not load this section. Check the database connection.</Empty>;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid url";
  }
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const session = await getSession();
  const live = session.kind === "signed_in";
  const project = typeof sp.project === "string" ? sp.project : undefined;
  const projects: ProjectRow[] = live ? await loadProjects(session.supabase) : [];
  const projectId = projects.find((p) => p.slug === project)?.id;
  const d = live ? await loadDashboard(session.supabase, { q, category, projectId }) : null;

  const disconnected = <Empty>Not connected. Configure Supabase to see real data.</Empty>;
  function render<T>(s: Section<T> | undefined, fn: (data: T) => React.ReactNode) {
    if (!s) return disconnected;
    return s.ok ? fn(s.data) : <Failed />;
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Command Dashboard</h1>
          <p className="text-sm text-mist-400">Only stored records are shown. Nothing here is sample data.</p>
        </div>
        <form className="flex flex-wrap gap-2" role="search" aria-label="Filter opportunities">
          <label className="sr-only" htmlFor="q">Search opportunities</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Search titles…"
            className="w-48 rounded border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm placeholder:text-mist-400"
          />
          <label className="sr-only" htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={category ?? ""} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="project">Project</label>
          <select id="project" name="project" defaultValue={project ?? ""} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <button className="rounded bg-signal-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-signal-400">Filter</button>
        </form>
      </header>

      <div className="flex flex-wrap gap-2 text-xs text-mist-400" aria-label="Legend">
        <Badge kind="verified">Verified fact</Badge>
        <Badge kind="estimate">AI estimate</Badge>
        <Badge kind="recommendation">Recommendation</Badge>
        <Badge kind="missing">Missing information</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card id="overview" title="A · Opportunity overview">
          {render(d?.overview, (o) => (
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Total" value={o.total} />
              <Stat label="Open" value={o.open} />
              <Stat label="Source verified" value={o.verified} />
              <Stat label="Ineligible" value={o.ineligible} />
            </dl>
          ))}
        </Card>

        <Card id="budget" title="J · Monthly expenditure" aside={<Link className="underline" href="/budget">Details</Link>}>
          {render(d?.budget, (b) => {
            const t = totals(b);
            return (
              <>
                <dl className="grid grid-cols-3 gap-3">
                  <Stat label="Spent" value={money(t.committed)} />
                  <Stat label="Reserved" value={money(t.pending)} />
                  <Stat label="Left of cap" value={money(t.remaining)} hint={`Hard cap ${money(b.hard_cap_usd)}`} />
                </dl>
                <p className="mt-3 text-xs text-mist-400">
                  Paid operations: <strong className={b.paid_operations_enabled ? "text-warn-400" : "text-ok-400"}>{b.paid_operations_enabled ? "enabled" : "disabled"}</strong>
                </p>
              </>
            );
          })}
        </Card>

        <Card id="agents" title="H · Agent status" aside={<Link className="underline" href="/agents">All</Link>}>
          <ul className="space-y-1 text-sm">
            {AGENTS.map((a) => {
              const run = d?.agents.ok ? d.agents.data.get(a.id) : undefined;
              return (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-mist-300"><span className="font-mono text-[11px] text-mist-400">{a.number}</span> {a.name}</span>
                  <span className="shrink-0 text-xs text-mist-400">{run ? `${run.status} · ${fmtDate(run.created_at)}` : `not running · phase ${a.phase}`}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card id="priority" title="B · High-priority opportunities" aside="score-ranked, eligible or unknown eligibility">
        {render(d?.priority, (rows) =>
          rows.length === 0 ? (
            <Empty>No scored opportunities yet. Daily research saves new finds unscored until their facts are verified; see all of them under Opportunity Intelligence.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-mist-400">
                  <tr><th className="py-1 pr-3 font-normal">Title</th><th className="pr-3 font-normal">Score</th><th className="pr-3 font-normal">Eligibility</th><th className="pr-3 font-normal">Deadline</th><th className="font-normal">Next action</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-ink-800 align-top">
                      <td className="py-2 pr-3">
                        <a className="hover:underline" href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">{r.title}</a>
                        <div className="text-xs text-mist-400">{r.category} · {hostOf(r.source_url)} {r.last_verified_at ? <Badge kind="verified">verified {fmtDate(r.last_verified_at)}</Badge> : <Badge kind="missing">source unverified</Badge>}</div>
                      </td>
                      <td className="pr-3 font-mono"><Badge kind="estimate">{r.qualification_score}</Badge></td>
                      <td className="pr-3 text-xs">{r.eligibility_status}{r.missing_information.length > 0 ? <div><Badge kind="missing">{r.missing_information.length} missing</Badge></div> : null}</td>
                      <td className="pr-3 text-xs">{fmtDate(r.deadline)}</td>
                      <td className="text-xs">{r.recommended_action ? <Badge kind="recommendation">{r.recommended_action}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card id="career" title="C · Career pipeline">
          {render(d?.career, (c) => (
            <dl className="grid grid-cols-2 gap-3"><Stat label="Preparing" value={c.preparing} /><Stat label="Submitted" value={c.submitted} /><Stat label="Interviews" value={c.interviews} /><Stat label="Offers" value={c.offers} /></dl>
          ))}
        </Card>
        <Card id="funding" title="D · Funding pipeline">
          {render(d?.funding, (f) => (
            <dl className="grid grid-cols-2 gap-3"><Stat label="Open" value={f.open} /><Stat label="Applied" value={f.applied} /><Stat label="Won" value={f.won} /></dl>
          ))}
        </Card>
        <Card id="commercial" title="E · Commercial pipeline">
          {render(d?.commercial, (c) => (
            <dl className="grid grid-cols-2 gap-3"><Stat label="Prospects" value={c.prospects} /><Stat label="Active" value={c.qualified} /><Stat label="Won" value={c.won} /></dl>
          ))}
        </Card>
        <Card id="outreach" title="F · Outreach activity">
          {render(d?.outreach, (o) => (
            <dl className="grid grid-cols-2 gap-3"><Stat label="Drafts" value={o.drafts} /><Stat label="Awaiting approval" value={o.awaitingApproval} /><Stat label="Sent" value={o.sent} /><Stat label="Follow-ups ≤30d" value={o.followUpsDue} /></dl>
          ))}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="deadlines" title="G · Upcoming deadlines" aside="next 30 days">
          {render(d?.deadlines, (rows) =>
            rows.length === 0 ? <Empty>No deadlines in the next 30 days.</Empty> : (
              <ul className="divide-y divide-ink-800 text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 py-1.5">
                    <a className="truncate hover:underline" href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">{r.title}</a>
                    <span className="shrink-0 font-mono text-xs text-mist-300">{fmtDate(r.deadline)}</span>
                  </li>
                ))}
              </ul>
            ),
          )}
        </Card>
        <Card id="research" title="I · Recent research" aside="latest retrieved sources">
          {render(d?.research, (rows) =>
            rows.length === 0 ? <Empty>No sources retrieved yet.</Empty> : (
              <ul className="divide-y divide-ink-800 text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 py-1.5">
                    <a className="truncate hover:underline" href={r.url} target="_blank" rel="noopener noreferrer nofollow">{hostOf(r.url)}</a>
                    <span className="shrink-0 text-xs">
                      <Badge kind={r.verification_status === "verified" ? "verified" : r.verification_status === "unverified" ? "neutral" : "missing"}>{r.verification_status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ),
          )}
        </Card>
      </div>
    </>
  );
}
