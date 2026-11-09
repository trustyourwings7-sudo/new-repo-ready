import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, Notice } from "@/components/ui";
import { AGENTS } from "@/lib/agents/registry";
import { getSession } from "@/lib/auth";
import { moduleBySlug } from "@/lib/modules";

type Row = { key: string; title: string; detail?: string; href?: string; badge?: string };
type Section = { title: string; rows: Row[]; empty: string; error?: boolean };

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;
const join = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(" · ");
const FUNDING = ["education", "scholarship", "grant", "funding", "accelerator"];

/** Read-only views of each module's real records. Editing for these modules is not built yet. */
export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const mod = moduleBySlug(slug);
  if (!mod || mod.slug === "" || mod.status === "available") notFound();
  const session = await getSession();
  if (session.kind !== "signed_in") return <Empty>Not connected.</Empty>;
  const sb = session.supabase;
  const sections: Section[] = [];

  if (slug === "career") {
    const { data, error } = await sb.from("applications").select("id,status,next_step,next_step_due,notes,submitted_at").order("updated_at", { ascending: false }).limit(50);
    sections.push({ title: "Applications", error: Boolean(error), empty: "No applications recorded. PIES never applies for you; record applications you submit yourself here once editing is built.", rows: (data ?? []).map((a) => ({ key: a.id, title: a.next_step ?? "Application", detail: join(fmt(a.submitted_at) && `submitted ${fmt(a.submitted_at)}`, a.next_step_due && `next step due ${fmt(a.next_step_due)}`, a.notes), badge: a.status })) });
  } else if (slug === "funding") {
    const { data, error } = await sb.from("opportunities").select("id,title,category,deadline,status,source_url,last_verified_at").in("category", FUNDING).neq("status", "archived").order("deadline", { ascending: true, nullsFirst: false }).limit(100);
    sections.push({ title: "Scholarships, grants and funding", error: Boolean(error), empty: "No funding opportunities saved yet. Ask PIES: “Find scholarships in Canada”.", rows: (data ?? []).map((o) => ({ key: o.id, title: o.title, href: o.source_url, detail: join(o.category, o.deadline ? `deadline ${fmt(o.deadline)}` : "deadline not found", o.last_verified_at ? "verified" : "unverified"), badge: o.status })) });
  } else if (slug === "outreach") {
    const [o, a] = await Promise.all([
      sb.from("outreach").select("id,subject,status,channel,purpose,follow_up_due,created_at").order("created_at", { ascending: false }).limit(50),
      sb.from("approval_requests").select("id,summary,status,action,expires_at").order("created_at", { ascending: false }).limit(50),
    ]);
    sections.push({ title: "Drafts and outreach", error: Boolean(o.error), empty: "No saved drafts. Research drafts appear in the private run report only; nothing is ever sent automatically.", rows: (o.data ?? []).map((x) => ({ key: x.id, title: x.subject ?? "(no subject)", detail: join(x.channel, x.purpose, x.follow_up_due && `follow up ${fmt(x.follow_up_due)}`), badge: x.status })) });
    sections.push({ title: "Approval requests", error: Boolean(a.error), empty: "No approval requests.", rows: (a.data ?? []).map((x) => ({ key: x.id, title: x.summary, detail: join(x.action, x.expires_at && `expires ${fmt(x.expires_at)}`), badge: x.status })) });
  } else if (slug === "revenue") {
    const { data, error } = await sb.from("client_pipeline").select("id,segment,stage,next_action,next_action_due,fit_score").order("updated_at", { ascending: false }).limit(50);
    sections.push({ title: "Prospects", error: Boolean(error), empty: "No prospects yet. Commercial lead research is not built; this is an empty dataset, not an error.", rows: (data ?? []).map((p) => ({ key: p.id, title: p.segment ?? "Prospect", detail: join(p.next_action, p.next_action_due && `due ${fmt(p.next_action_due)}`, p.fit_score !== null && `fit ${p.fit_score}`), badge: p.stage })) });
  } else if (slug === "agents") {
    const { data, error } = await sb.from("agent_runs").select("id,agent,trigger,status,items_processed,cost_usd,error,started_at").order("started_at", { ascending: false }).limit(30);
    sections.push({ title: "Recent runs", error: Boolean(error), empty: "No runs recorded.", rows: (data ?? []).map((r) => ({ key: r.id, title: `${(r.started_at ?? "").slice(0, 16).replace("T", " ")} UTC · ${r.agent}`, detail: join(r.trigger, `${r.items_processed ?? 0} items`, r.error && r.error.slice(0, 120)), badge: r.status === "cancelled" ? "skipped" : r.status })) });
    sections.push({ title: "Agents", empty: "", rows: AGENTS.map((a) => ({ key: a.id, title: `${a.number} ${a.name}`, detail: a.purpose, badge: a.id === "discovery" ? "active: daily research" : `planned (phase ${a.phase})` })) });
  } else if (slug === "profile") {
    const [p, e, s] = await Promise.all([
      sb.from("user_profiles").select("full_name,headline,summary,location_city,location_country,education_level,target_countries,interests").limit(1),
      sb.from("profile_entries").select("id,kind,title,organization,start_date,end_date,verification_status,source").order("start_date", { ascending: false, nullsFirst: false }).limit(100),
      sb.from("skills").select("id,name,category,proficiency,verification_status,source").order("name").limit(100),
    ]);
    const prof = p.data?.[0];
    sections.push({ title: "Profile", error: Boolean(p.error), empty: "No profile saved.", rows: prof ? [{ key: "p", title: prof.full_name ?? "—", detail: join(prof.headline, prof.location_city, prof.location_country, prof.education_level && `education: ${prof.education_level}`, prof.target_countries?.length && `targets: ${(prof.target_countries as string[]).join(", ")}`) }] : [] });
    sections.push({ title: "Experience and education", error: Boolean(e.error), empty: "No entries.", rows: (e.data ?? []).map((x) => ({ key: x.id, title: x.title, detail: join(x.kind, x.organization, x.start_date && `${x.start_date}${x.end_date ? ` – ${x.end_date}` : ""}`, x.source && `source: ${x.source}`), badge: x.verification_status })) });
    sections.push({ title: "Skills", error: Boolean(s.error), empty: "No skills.", rows: (s.data ?? []).map((x) => ({ key: x.id, title: x.name, detail: join(x.category, x.proficiency, x.source && `source: ${x.source}`), badge: x.verification_status })) });
  }

  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">{mod.letter} · {mod.name}</h1>
        <p className="text-sm text-mist-400">{mod.summary}</p>
      </header>
      <Notice tone="info">
        <strong>Read-only view.</strong> These are your real stored records{total === 0 ? " (there are none yet)" : ""}. Adding and editing here is not built yet; use <Link className="underline" href="/ask">Ask PIES</Link> for research and <Link className="underline" href="/contacts">Organizations &amp; Contacts</Link> to manage contacts.
      </Notice>
      {sections.map((s) => (
        <Card key={s.title} id={s.title.toLowerCase().replace(/\W+/g, "-")} title={`${s.title} (${s.rows.length})`}>
          {s.error ? (
            <Notice tone="bad">Could not load.</Notice>
          ) : s.rows.length === 0 ? (
            <Empty>{s.empty}</Empty>
          ) : (
            <ul className="divide-y divide-ink-800">
              {s.rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0 break-words">
                    {r.href ? <a href={r.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium underline decoration-ink-700 underline-offset-2">{r.title}</a> : <span className="font-medium">{r.title}</span>}
                    {r.detail ? <div className="text-xs text-mist-400">{r.detail}</div> : null}
                  </div>
                  {r.badge ? <Badge kind="neutral">{r.badge}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </>
  );
}
