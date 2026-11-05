import { Badge, Card, Empty, Notice, Stat, money } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { HARD_MONTHLY_CAP_USD } from "@/lib/budget/constants";
import { budgetSummarySchema, totals } from "@/lib/budget/governor";

export default async function BudgetPage() {
  const session = await getSession();
  let summary = null;
  let providers: { provider: string; category: string; enabled: boolean; pricing_verified: boolean; pricing_source_url: string | null; monthly_cap_usd: number | null }[] = [];
  let loadError = false;

  if (session.kind === "signed_in") {
    const [s, p] = await Promise.all([
      session.supabase.rpc("budget_summary", {}),
      session.supabase.from("provider_configs").select("provider,category,enabled,pricing_verified,pricing_source_url,monthly_cap_usd").order("provider"),
    ]);
    const parsed = budgetSummarySchema.safeParse(s.data);
    if (s.error || !parsed.success || p.error) loadError = true;
    else {
      summary = parsed.data;
      providers = p.data ?? [];
    }
  }

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold">K · Budget &amp; Usage</h1>
        <p className="text-sm text-mist-400">
          Hard incremental cap: {money(HARD_MONTHLY_CAP_USD)} per calendar month (UTC). Enforced in the database; existing subscriptions are tracked separately and not counted.
        </p>
      </header>

      {loadError ? <Notice tone="bad">Could not load budget data.</Notice> : null}

      <Card id="governor" title="Governor status">
        {summary ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Period" value={summary.period_month.slice(0, 7)} />
              <Stat label="Spent" value={money(totals(summary).committed)} />
              <Stat label="Reserved" value={money(totals(summary).pending)} />
              <Stat label="Remaining" value={money(totals(summary).remaining)} />
            </dl>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-mist-400"><tr><th className="py-1 font-normal">Category</th><th className="font-normal">Limit</th><th className="font-normal">Spent</th><th className="font-normal">Reserved</th></tr></thead>
                <tbody>
                  {summary.categories.map((c) => (
                    <tr key={c.category} className="border-t border-ink-800"><td className="py-1.5">{c.category}</td><td className="font-mono">{money(c.limit_usd)}</td><td className="font-mono">{money(c.committed_usd)}</td><td className="font-mono">{money(c.pending_usd)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm">
              Paid operations kill switch:{" "}
              {summary.paid_operations_enabled ? <Badge kind="estimate">enabled</Badge> : <Badge kind="verified">disabled (default)</Badge>}
            </p>
          </>
        ) : (
          <Empty>Not connected. Configure Supabase to see usage.</Empty>
        )}
      </Card>

      <Card id="providers" title="Paid providers">
        {providers.length === 0 ? (
          <Empty>
            No paid providers configured. Every paid call is refused until a provider is enabled <em>and</em> its pricing is verified against a cited pricing page.
            Free and deterministic operations continue to work.
          </Empty>
        ) : (
          <ul className="divide-y divide-ink-800 text-sm">
            {providers.map((p) => (
              <li key={p.provider} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{p.provider} <span className="text-xs text-mist-400">({p.category})</span></span>
                <span className="flex gap-1">
                  <Badge kind={p.enabled ? "estimate" : "neutral"}>{p.enabled ? "enabled" : "disabled"}</Badge>
                  <Badge kind={p.pricing_verified ? "verified" : "missing"}>{p.pricing_verified ? "pricing verified" : "pricing unverified"}</Badge>
                  {p.monthly_cap_usd !== null ? <Badge kind="neutral">cap {money(Number(p.monthly_cap_usd))}</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="rules" title="Rules enforced">
        <ul className="list-disc space-y-1 pl-5 text-sm text-mist-300">
          <li>Every paid call must reserve budget first (<code>reserve_budget</code>); reservations are serialized per user, so concurrent calls cannot overspend.</li>
          <li>Limits checked: monthly total (≤ {money(HARD_MONTHLY_CAP_USD)}), category (AI $5, search $2, infra $3 by default), optional per-provider cap.</li>
          <li>Category limits cannot be raised so their sum exceeds the hard cap.</li>
          <li>Idempotency keys prevent the same operation from being reserved or billed twice.</li>
          <li>No automatic credit purchases or plan upgrades exist anywhere in the code; those actions are human-only.</li>
          <li>Counters reset by month key; no records are deleted.</li>
        </ul>
      </Card>
    </>
  );
}
