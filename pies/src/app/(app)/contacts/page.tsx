import { Badge, Card, Empty, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { deleteContact, deleteOrganization, saveContact, saveOrganization } from "./actions";

const ORG_TYPES = ["", "university", "college", "funder", "government", "ngo", "employer", "accelerator", "business", "school", "clinic", "travel", "hospitality", "other"];
const input = "w-full rounded border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-base placeholder:text-mist-400 sm:text-sm";
const btn = "rounded bg-signal-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-signal-400";

interface Org { id: string; name: string; website: string | null; country: string | null; org_type: string | null; source_url: string | null; description: string | null }
interface Contact { id: string; full_name: string; role_title: string | null; organization_id: string | null; source_url: string; public_email: string | null; email_source_url: string | null; profile_url: string | null; notes: string | null }

function escapeLike(q: string) {
  return q.replace(/[\\%_,()]/g, (c) => `\\${c}`);
}
function host(u: string | null) {
  if (!u) return null;
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

function Field({ label, name, defaultValue, placeholder, required, type = "text" }: { label: string; name: string; defaultValue?: string | null; placeholder?: string; required?: boolean; type?: string }) {
  return (
    <label className="block text-xs text-mist-400">
      {label}{required ? " *" : ""}
      <input name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} maxLength={500} className={`mt-0.5 ${input}`} />
    </label>
  );
}

function OrgForm({ org }: { org?: Org }) {
  return (
    <form action={saveOrganization} className="grid gap-2 sm:grid-cols-2">
      {org ? <input type="hidden" name="id" value={org.id} /> : null}
      <Field label="Name" name="name" defaultValue={org?.name} required />
      <Field label="Website" name="website" defaultValue={org?.website} placeholder="https://…" />
      <Field label="Country" name="country" defaultValue={org?.country} />
      <label className="block text-xs text-mist-400">
        Type
        <select name="org_type" defaultValue={org?.org_type ?? ""} className={`mt-0.5 ${input}`}>
          {ORG_TYPES.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
        </select>
      </label>
      <Field label="Source page" name="source_url" defaultValue={org?.source_url} placeholder="https://… where you found it" />
      <Field label="Notes" name="description" defaultValue={org?.description} />
      <div><button className={btn}>{org ? "Save changes" : "Add organization"}</button></div>
    </form>
  );
}

function ContactForm({ contact, orgs }: { contact?: Contact; orgs: Org[] }) {
  return (
    <form action={saveContact} className="grid gap-2 sm:grid-cols-2">
      {contact ? <input type="hidden" name="id" value={contact.id} /> : null}
      <Field label="Full name" name="full_name" defaultValue={contact?.full_name} required />
      <Field label="Role / title" name="role_title" defaultValue={contact?.role_title} />
      <label className="block text-xs text-mist-400">
        Organization
        <select name="organization_id" defaultValue={contact?.organization_id ?? ""} className={`mt-0.5 ${input}`}>
          <option value="">— none —</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <Field label="Source page (where this person is listed)" name="source_url" defaultValue={contact?.source_url} placeholder="https://…" required />
      <Field label="Public email" name="public_email" type="email" defaultValue={contact?.public_email} />
      <Field label="Page where the email is published" name="email_source_url" defaultValue={contact?.email_source_url} placeholder="required if an email is given" />
      <Field label="Profile URL" name="profile_url" defaultValue={contact?.profile_url} />
      <Field label="Notes" name="notes" defaultValue={contact?.notes} />
      <div><button className={btn}>{contact ? "Save changes" : "Add contact"}</button></div>
    </form>
  );
}

function DeleteForm({ action, id, what }: { action: (fd: FormData) => Promise<void>; id: string; what: string }) {
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-1 text-mist-400"><input type="checkbox" name="confirm" value="yes" /> confirm</label>
      <button className="rounded border border-bad-400/60 px-2 py-1 text-bad-400 hover:bg-bad-400/10">Delete {what}</button>
    </form>
  );
}

/** Organizations & Contacts: view, search, add, edit and delete. Public, sourced business contacts only. */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const ok = typeof sp.ok === "string" ? sp.ok.slice(0, 200) : null;
  const err = typeof sp.error === "string" ? sp.error.slice(0, 300) : null;
  const session = await getSession();
  if (session.kind !== "signed_in") return <Empty>Not connected.</Empty>;
  const sb = session.supabase;

  let orgQ = sb.from("organizations").select("id,name,website,country,org_type,source_url,description").order("name").limit(200);
  let conQ = sb.from("contacts").select("id,full_name,role_title,organization_id,source_url,public_email,email_source_url,profile_url,notes").order("full_name").limit(500);
  if (q) {
    orgQ = orgQ.or(`name.ilike.%${escapeLike(q)}%,country.ilike.%${escapeLike(q)}%`);
    conQ = conQ.or(`full_name.ilike.%${escapeLike(q)}%,role_title.ilike.%${escapeLike(q)}%`);
  }
  const [allOrgsRes, orgsRes, consRes] = await Promise.all([sb.from("organizations").select("id,name,website,country,org_type,source_url,description").order("name").limit(200), orgQ, conQ]);
  const failed = Boolean(allOrgsRes.error || orgsRes.error || consRes.error);
  const allOrgs = (allOrgsRes.data ?? []) as Org[];
  const orgs = (orgsRes.data ?? []) as Org[];
  const contacts = (consRes.data ?? []) as Contact[];
  const orgName = new Map(allOrgs.map((o) => [o.id, o.name]));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">E · Organizations &amp; Contacts</h1>
          <p className="text-sm text-mist-400">Publicly listed people and organizations, each with the page it came from. Nothing here is ever emailed automatically.</p>
        </div>
        <form role="search" className="flex gap-2">
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Search names, roles, countries…" className={`sm:w-64 ${input}`} />
          <button className={btn}>Search</button>
        </form>
      </header>
      {ok ? <Notice>{ok}</Notice> : null}
      {err ? <Notice tone="bad">{err}</Notice> : null}
      {failed ? <Notice tone="bad">Some records could not load.</Notice> : null}

      <Card id="add" title="Add">
        <details>
          <summary className="cursor-pointer text-sm">Add an organization</summary>
          <div className="mt-2"><OrgForm /></div>
        </details>
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">Add a contact</summary>
          <div className="mt-2"><ContactForm orgs={allOrgs} /></div>
        </details>
      </Card>

      <Card id="orgs" title={`Organizations (${orgs.length}${q ? " matching" : ""})`}>
        {orgs.length === 0 ? (
          <Empty>{q ? `No organization matches “${q}”.` : "No organizations saved yet. Add one above; research adds them only when a page lists them with a source."}</Empty>
        ) : (
          <ul className="divide-y divide-ink-800">
            {orgs.map((o) => {
              const people = contacts.filter((c) => c.organization_id === o.id);
              return (
                <li key={o.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {o.website ? <a href={o.website} target="_blank" rel="noopener noreferrer nofollow" className="font-medium underline decoration-ink-700 underline-offset-2">{o.name}</a> : <span className="font-medium">{o.name}</span>}
                    {o.org_type ? <Badge kind="neutral">{o.org_type}</Badge> : null}
                    {o.country ? <Badge kind="neutral">{o.country}</Badge> : null}
                    {o.source_url ? <span className="text-xs text-mist-400">source: {host(o.source_url)}</span> : <Badge kind="missing">no source</Badge>}
                  </div>
                  {people.length ? <p className="mt-0.5 text-xs text-mist-400">{people.map((p) => p.full_name).join(", ")}</p> : null}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-mist-400">Edit or delete</summary>
                    <div className="mt-2"><OrgForm org={o} /><DeleteForm action={deleteOrganization} id={o.id} what="organization" /></div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card id="contacts" title={`Contacts (${contacts.length}${q ? " matching" : ""})`}>
        {contacts.length === 0 ? (
          <Empty>{q ? `No contact matches “${q}”.` : "No contacts saved yet. Add one above with the page where the person is publicly listed."}</Empty>
        ) : (
          <ul className="divide-y divide-ink-800">
            {contacts.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{c.full_name}</span>
                  {c.role_title ? <span className="text-mist-300">· {c.role_title}</span> : null}
                  {c.organization_id ? <Badge kind="neutral">{orgName.get(c.organization_id) ?? "organization"}</Badge> : null}
                </div>
                <p className="mt-0.5 break-words text-xs text-mist-400">
                  {c.public_email ? <>{c.public_email} (published on {host(c.email_source_url)}) · </> : null}
                  source: <a className="underline" href={c.source_url} target="_blank" rel="noopener noreferrer nofollow">{host(c.source_url)}</a>
                  {c.profile_url ? <> · <a className="underline" href={c.profile_url} target="_blank" rel="noopener noreferrer nofollow">profile</a></> : null}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-mist-400">Edit or delete</summary>
                  <div className="mt-2"><ContactForm contact={c} orgs={allOrgs} /><DeleteForm action={deleteContact} id={c.id} what="contact" /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
