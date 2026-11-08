import Link from "next/link";
import { Badge, Card, Empty, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function daysLeft(iso: string) {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

interface Activity { id: string; kind: string; title: string; description: string | null; priority: number | null; due_at: string | null; completed_at: string | null; created_by: string | null }
interface Deadline { id: string; title: string; category: string; deadline: string; source_url: string }
interface Notification { id: string; severity: string; title: string; body: string | null; read_at: string | null; created_at: string }
interface Project { id: string; name: string; kind: string; status: string; description: string | null }
interface Run { id: string; agent: string; status: string; trigger: string | null; items_processed: number | null; cost_usd: number | null; error: string | null; started_at: string | null; created_at: string }

/** Read-only: open tasks, every upcoming deadline, notifications, projects and recent research runs. */
export default async function TasksPage() {
  const session = await getSession();
  if (session.kind !== "signed_in") {
    return (
      <>
        <h1 className="text-lg font-semibold">I · Tasks &amp; Activities</h1>
        <Empty>Not connected. Configure Supabase to see real data.</Empty>
      </>
    );
  }
  const sb = session.supabase;
  const [acts, dls, notes, projs, runs] = await Promise.all([
    sb.from("activities").select("id,kind,title,description,priority,due_at,completed_at,created_by").is("completed_at", null).order("due_at", { ascending: true, nullsFirst: false }).limit(100),
    sb.from("opportunities").select("id,title,category,deadline,source_url").gte("deadline", new Date().toISOString()).in("status", ["new", "reviewing", "qualified", "pursuing"]).order("deadline", { ascending: true }).limit(50),
    sb.from("notifications").select("id,severity,title,body,read_at,created_at").order("created_at", { ascending: false }).limit(20),
    sb.from("projects").select("id,name,kind,status,description").order("name"),
    sb.from("agent_runs").select("id,agent,status,trigger,items_processed,cost_usd,error,started_at,created_at").order("created_at", { ascending: false }).limit(10),
  ]);
  const failed = [acts, dls, notes, projs, runs].some((r) => r.error);
  const activities = (acts.data ?? []) as Activity[];
  const deadlines = (dls.data ?? []) as Deadline[];
  const notifications = (notes.data ?? []) as Notification[];
  const projects = (projs.data ?? []) as Project[];
  const recentRuns = (runs.data ?? []) as Run[];

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">I · Tasks &amp; Activities</h1>
        <p className="text-sm text-mist-400">Open tasks, every upcoming deadline, notifications, projects and research runs. Read-only.</p>
      </header>
      {failed ? <Notice tone="bad">Some sections could not load.</Notice> : null}

      <Card id="deadlines" title="Upcoming deadlines" aside={<Link className="underline" href="/opportunities">All opportunities</Link>}>
        {deadlines.length === 0 ? (
          <Empty>No open opportunity has a known future deadline yet. Check each official page; research marks a deadline only when it can quote it.</Empty>
        ) : (
          <ul className="divide-y divide-ink-800 text-sm">
            {deadlines.map((d) => {
              const left = daysLeft(d.deadline);
              return (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <a href={d.source_url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-words underline decoration-ink-700 underline-offset-2">{d.title}</a>
                  <span className={`shrink-0 font-mono text-xs ${left <= 14 ? "text-warn-400" : "text-mist-300"}`}>{fmt(d.deadline)} · {left} days</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card id="tasks" title="Open tasks">
        {activities.length === 0 ? (
          <Empty>No open tasks stored. Follow-ups appear here when they are created.</Empty>
        ) : (
          <ul className="divide-y divide-ink-800 text-sm">
            {activities.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{a.title}</span>
                  <span className="shrink-0 text-xs text-mist-400">{a.due_at ? `due ${fmt(a.due_at)}` : "no due date"}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1"><Badge kind="neutral">{a.kind}</Badge>{a.created_by ? <Badge kind="neutral">by {a.created_by}</Badge> : null}</div>
                {a.description ? <p className="mt-1 text-xs text-mist-300">{a.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="runs" title="Recent research runs">
        {recentRuns.length === 0 ? (
          <Empty>No runs recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-mist-400"><tr><th className="py-1 font-normal">Started (UTC)</th><th className="font-normal">Trigger</th><th className="font-normal">Result</th><th className="font-normal">Items</th><th className="font-normal">Note</th></tr></thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-t border-ink-800 align-top">
                    <td className="py-1.5 font-mono text-xs">{(r.started_at ?? r.created_at).slice(0, 16).replace("T", " ")}</td>
                    <td className="text-xs">{r.trigger ?? "—"}</td>
                    <td><Badge kind={r.status === "succeeded" ? "verified" : r.status === "failed" ? "missing" : "neutral"}>{r.status === "cancelled" ? "skipped" : r.status}</Badge></td>
                    <td className="font-mono text-xs">{r.items_processed ?? 0}</td>
                    <td className="text-xs text-mist-400">{r.error ? r.error.slice(0, 80) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="notifications" title="Notifications">
        {notifications.length === 0 ? (
          <Empty>No notifications.</Empty>
        ) : (
          <ul className="divide-y divide-ink-800 text-sm">
            {notifications.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words">{n.title}</span>
                  <span className="shrink-0 text-xs text-mist-400">{fmt(n.created_at)}</span>
                </div>
                <Badge kind={n.severity === "critical" || n.severity === "error" ? "missing" : n.severity === "warning" ? "estimate" : "neutral"}>{n.severity}</Badge>
                {n.body ? <p className="mt-1 text-xs text-mist-300">{n.body.slice(0, 300)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="projects" title="Projects">
        {projects.length === 0 ? (
          <Empty>No projects yet. Settings → Load initialization context creates the starting projects.</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id} className="rounded border border-ink-800 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-1"><span className="font-medium">{p.name}</span><Badge kind="neutral">{p.kind}</Badge>{p.status !== "active" ? <Badge kind="neutral">{p.status}</Badge> : null}</div>
                {p.description ? <p className="mt-1 text-xs text-mist-400">{p.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
