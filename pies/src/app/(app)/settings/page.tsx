import { Badge, Card, Empty, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { configurationWarnings, integrationStatus } from "@/lib/env";
import { ACTIONS, type ActionId } from "@/lib/permissions/catalog";
import { initializeProfile } from "./actions";

const INTEGRATIONS: { key: keyof ReturnType<typeof integrationStatus>; label: string; note: string }[] = [
  { key: "supabase", label: "Supabase (database + auth)", note: "Required." },
  { key: "accessAllowlist", label: "Sign-in allowlist", note: "Required. Empty allowlist admits nobody." },
  { key: "anthropic", label: "Anthropic API", note: "Optional. Also needs verified pricing in the Budget module." },
  { key: "gemini", label: "Google Gemini API", note: "Optional. Check free-tier data-use terms before sending profile data." },
  { key: "braveSearch", label: "Brave Search API", note: "Optional. Pricing must be verified before use." },
  { key: "gmailOAuth", label: "Gmail OAuth client", note: "Phase 3. Drafts only by policy." },
  { key: "automationApi", label: "Automation API (n8n boundary)", note: "HMAC secret + integration id + pies_automation database URL." },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profileResult = (await searchParams).profile;
  const status = integrationStatus();
  const session = await getSession();
  let audit: { id: string; created_at: string; actor_type: string; actor_id: string; action: string; decision: string; result: string }[] | null = null;
  if (session.kind === "signed_in") {
    const { data } = await session.supabase
      .from("audit_logs")
      .select("id,created_at,actor_type,actor_id,action,decision,result")
      .order("created_at", { ascending: false })
      .limit(20);
    audit = data ?? [];
  }
  const byLevel = [1, 2, 3, 4].map((lvl) => ({
    lvl,
    actions: (Object.keys(ACTIONS) as ActionId[]).filter((a) => ACTIONS[a].level === lvl),
  }));

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">L · Settings &amp; Security</h1>
        <p className="text-sm text-mist-400">Configuration is read from server environment variables. Secret values are never displayed.</p>
      </header>

      {configurationWarnings().map((w) => (
        <Notice key={w} tone="bad">{w}</Notice>
      ))}

      <Card id="integrations" title="Integrations">
        <ul className="divide-y divide-ink-800 text-sm">
          {INTEGRATIONS.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{i.label} <span className="text-xs text-mist-400">— {i.note}</span></span>
              <Badge kind={status[i.key] === "configured" ? "verified" : "missing"}>{status[i.key] === "configured" ? "configured (untested)" : "not configured"}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-mist-400">“Configured” means a value is present. It does not mean the integration has been tested.</p>
      </Card>

      <Card id="profile-init" title="Profile initialization">
        <p className="mb-2 text-sm text-mist-300">
          Loads the starting profile context (Kigali; high school graduate; basketball; ISCO operations; Ramani Travel sales and marketing; JAMOF founder;
          CRM, SEO, GEO and AI automation interests) and six starting projects: career, education & funding, JAMOF, Shemmaa, AI consulting, lead generation. Each fact is stored as <em>user asserted</em> and can be edited. Nothing else is added. Running it twice does nothing.
        </p>
        {profileResult === "ok" ? <p className="mb-2 text-sm text-ok-400">Profile context loaded.</p> : null}
        {profileResult === "error" ? <p className="mb-2 text-sm text-bad-400">Could not load the profile context.</p> : null}
        {session.kind === "signed_in" ? (
          <form action={initializeProfile}>
            <button className="rounded border border-ink-600 px-3 py-1.5 text-sm hover:bg-ink-800">Load initialization context</button>
          </form>
        ) : (
          <Empty>Sign in to use this.</Empty>
        )}
      </Card>

      <Card id="permissions" title="Permission levels">
        <div className="grid gap-3 md:grid-cols-2">
          {byLevel.map(({ lvl, actions }) => (
            <div key={lvl} className="rounded border border-ink-800 p-3">
              <h3 className="mb-1 text-sm font-medium">
                Level {lvl} · {["Automatic research", "Automatic internal execution", "Restricted external preparation", "Prohibited by default"][lvl - 1]}
              </h3>
              <ul className="space-y-0.5 text-xs text-mist-300">
                {actions.map((a) => {
                  const spec = ACTIONS[a];
                  const mode = "level4Mode" in spec ? spec.level4Mode : undefined;
                  return (
                    <li key={a}>
                      <code>{a}</code> — {spec.description}
                      {mode === "human_only" ? <> <Badge kind="missing">human only</Badge></> : mode === "approval" ? <> <Badge kind="estimate">single-use approval</Badge></> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card id="audit" title="Audit log" aside="latest 20 · append-only">
        {audit === null ? <Empty>Not connected.</Empty> : audit.length === 0 ? <Empty>No audit entries yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-mist-400"><tr><th className="py-1 font-normal">When (UTC)</th><th className="font-normal">Actor</th><th className="font-normal">Action</th><th className="font-normal">Decision</th><th className="font-normal">Result</th></tr></thead>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id} className="border-t border-ink-800"><td className="py-1 font-mono">{r.created_at.slice(0, 16).replace("T", " ")}</td><td>{r.actor_type}:{r.actor_id.slice(0, 24)}</td><td>{r.action}</td><td>{r.decision}</td><td>{r.result}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
