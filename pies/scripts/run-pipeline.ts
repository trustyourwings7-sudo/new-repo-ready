// PIES research runner: the n8n replacement. Runs anywhere Node 22 runs (GitHub Actions, a laptop, a VM).
// Usage: node scripts/run-pipeline.ts
// Exit codes: 0 ran (outcome productive | low_yield | empty), 2 configuration error,
//             3 blocked by a local safety gate (nothing was called), 4 blocked or failed during the run,
//             5 connection check failed (PIES_CONNECTION_CHECK=1 with live off).
//
// Env (all server-side; never commit values):
//   PIES_PIPELINE_CONFIG_JSON | PIES_PIPELINE_CONFIG   private config (profile + queries) as JSON or a file path
//   PIES_AUTOMATION_DATABASE_URL, PIES_AUTOMATION_INTEGRATION_ID, PIES_OWNER_USER_ID
//   PIES_LIVE_RESEARCH=1, PIES_PRICES_CONFIRMED_ON=YYYY-MM-DD, EXA_API_KEY, FIRECRAWL_API_KEY
//   PIES_PROVIDER_BASE_URL_OVERRIDE (tests only; localhost URLs only)
//   PIES_REPORT_PATH  optional file for the full report (keep it git-ignored; never upload from a public repo)
//
// Output is aggregate metrics only: on a public repository, Actions logs are public.
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { z } from "zod";
import { ExaSearch } from "../src/lib/research/exa.ts";
import { FirecrawlExtract } from "../src/lib/research/firecrawl.ts";
import { liveModeProblems, MeteredResearch } from "../src/lib/research/metered.ts";
import { RobotsPolicy } from "../src/lib/research/robots.ts";
import { OPPORTUNITY_CATEGORIES, runPipeline } from "../src/lib/pipeline/run.ts";
import { dbSink } from "../src/lib/pipeline/sink.ts";

const configSchema = z.object({
  profile: z.object({
    name: z.string().min(1).max(100),
    nationality: z.string().min(2).max(60),
    age: z.number().int().min(14).max(100),
    education: z.enum(["secondary", "bachelor", "master", "doctorate"]),
    experienceKeywords: z.array(z.string().max(60)).max(20),
    rejectApplicationFees: z.boolean(),
    proofPoints: z.array(z.string().max(200)).max(4),
  }),
  queries: z
    .array(
      z.object({
        project: z.string().regex(/^[a-z0-9-]{2,48}$/),
        category: z.enum(OPPORTUNITY_CATEGORIES),
        query: z.string().min(3).max(500),
        numResults: z.number().int().min(1).max(10),
        strategicFit: z.enum(["primary", "secondary"]),
      }),
    )
    .min(1)
    .max(10),
  // Non-secret identifiers and the owner's price-check date may live in the config secret,
  // so the owner manages fewer GitHub secrets. Environment variables, when set, win.
  ownerUserId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  integrationId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  pricesConfirmedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  caps: z.object({ searches: z.number().int().min(1).max(10), extractions: z.number().int().min(0).max(15) }).default({ searches: 3, extractions: 10 }),
  excludeHosts: z.array(z.string()).max(50).default([]),
  officialDomains: z.array(z.string().regex(/^[a-z0-9.-]{3,253}$/)).max(200).default([]),
  aggregators: z.array(z.string().regex(/^[a-z0-9.-]{3,253}$/)).max(200).default([]),
});

function fail(code: number, msg: string): never {
  console.error(msg);
  process.exit(code);
}

const env = process.env;
const rawConfig = env.PIES_PIPELINE_CONFIG_JSON ?? (env.PIES_PIPELINE_CONFIG ? readFileSync(env.PIES_PIPELINE_CONFIG, "utf8") : null);
if (!rawConfig) fail(2, "config missing: set PIES_PIPELINE_CONFIG_JSON or PIES_PIPELINE_CONFIG");
const parsed = configSchema.safeParse(JSON.parse(rawConfig));
if (!parsed.success) fail(2, `config invalid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
const cfg = parsed.data;

const ownerUserId = env.PIES_OWNER_USER_ID || cfg.ownerUserId || "";
const integrationId = env.PIES_AUTOMATION_INTEGRATION_ID || cfg.integrationId || "";
const problems = liveModeProblems({ ...env, PIES_PRICES_CONFIRMED_ON: env.PIES_PRICES_CONFIRMED_ON || cfg.pricesConfirmedOn });
if (!env.PIES_AUTOMATION_DATABASE_URL) problems.push("PIES_AUTOMATION_DATABASE_URL is missing");
if (!integrationId) problems.push("integration id is missing (PIES_AUTOMATION_INTEGRATION_ID or config.integrationId)");
if (!ownerUserId) problems.push("owner user id is missing (PIES_OWNER_USER_ID or config.ownerUserId)");
if (env.PIES_AUTOMATION_DATABASE_URL && !/^postgres(ql)?:\/\/pies_automation[.:@]/.test(env.PIES_AUTOMATION_DATABASE_URL)) {
  problems.push("PIES_AUTOMATION_DATABASE_URL must connect as the pies_automation role");
}
const override = env.PIES_PROVIDER_BASE_URL_OVERRIDE;
if (override && !/^http:\/\/127\.0\.0\.1:\d+$/.test(override)) problems.push("PIES_PROVIDER_BASE_URL_OVERRIDE must be http://127.0.0.1:<port>");
// Connection check (live off): proves the secrets and the restricted login WITHOUT calling any
// provider or writing anything. Read-only: session identity, two must-fail reads, and one
// governor call that returns "paid_operations_disabled" while paid operations are off.
if (env.PIES_CONNECTION_CHECK === "1" && env.PIES_LIVE_RESEARCH !== "1") {
  const missing = [
    !env.PIES_AUTOMATION_DATABASE_URL && "PIES_AUTOMATION_DATABASE_URL",
    !integrationId && "integrationId",
    !ownerUserId && "ownerUserId",
  ].filter(Boolean);
  if (missing.length) fail(3, `connection check blocked: missing ${missing.join(", ")}`);
  if (!/^postgres(ql)?:\/\/pies_automation[.:@]/.test(env.PIES_AUTOMATION_DATABASE_URL!)) fail(3, "connection check blocked: URL must use the pies_automation role");
  const db = postgres(env.PIES_AUTOMATION_DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 10, connection: { application_name: "pies-connection-check" } });
  const denied = async (q: () => Promise<unknown>) => {
    try {
      await q();
      return "ALLOWED";
    } catch (e) {
      return (e as { code?: string }).code === "42501" ? "denied" : `error:${(e as { code?: string }).code ?? "unknown"}`;
    }
  };
  try {
    const [who] = await db<{ s: string; c: string }[]>`select session_user::text as s, current_user::text as c`;
    const tableRead = await denied(() => db`select 1 from public.opportunities limit 1`);
    const budgetSummary = await denied(() => db`select public.budget_summary(null)`);
    const [g] = await db<{ r: { allowed?: boolean; reason?: string; usage_id?: string } }[]>`select public.reserve_budget('search', 'exa', 'connection_check', 0.000001, ${`check:${Date.now()}`}, null, ${ownerUserId}::uuid) as r`;
    // If paid operations happen to be on, undo the probe reservation at once.
    if (g?.r?.allowed && g.r.usage_id) await db`select public.release_usage(${g.r.usage_id}::uuid, ${ownerUserId}::uuid)`;
    const result = {
      ok: who?.s === "pies_automation" && tableRead === "denied" && budgetSummary === "denied" && (g?.r?.reason === "paid_operations_disabled" || g?.r?.allowed === true),
      mode: "connection_check",
      sessionUser: who?.s ?? null,
      tableRead,
      budgetSummary,
      governor: g?.r?.reason ?? null,
    };
    console.log(JSON.stringify(result));
    await db.end();
    process.exit(result.ok ? 0 : 5);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, mode: "connection_check", error: (e as { code?: string }).code ?? (e instanceof Error ? e.message.slice(0, 120) : "unknown") }));
    await db.end().catch(() => {});
    process.exit(5);
  }
}

if (problems.length) fail(3, `blocked (no provider or database call made):\n- ${problems.join("\n- ")}`);

const today = new Date().toISOString().slice(0, 10);
const trigger: "schedule" | "manual" = env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "manual";
// Budget idempotency is per day AND per trigger: at most one paid scheduled run and one paid manual
// run per day; retries within a slot never re-spend. (A same-day manual test no longer blocks the
// scheduled run.)
const runKey = `${today}:${trigger}`;
// Workflow-level hard limits (owner condition: 3 searches, 4 pages a day). The lower of these and
// the config secret's caps applies, so the secret cannot raise them.
const envCap = (v: string | undefined, max: number) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : max;
};
const caps = {
  searches: envCap(env.PIES_MAX_SEARCHES, cfg.caps.searches),
  extractions: envCap(env.PIES_MAX_EXTRACTIONS, cfg.caps.extractions),
};
const sql = postgres(env.PIES_AUTOMATION_DATABASE_URL!, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  connection: { application_name: "pies-research-runner", statement_timeout: 15000 },
});
const sink = dbSink(sql as never, integrationId);
const http = { maxRetries: 1, timeoutMs: 30_000 };
const exa = new ExaSearch(env.EXA_API_KEY!, http, override ? `${override}/exa` : undefined);
const firecrawl = new FirecrawlExtract(env.FIRECRAWL_API_KEY!, http, override ? `${override}/firecrawl` : undefined);
const fast = Boolean(override);
const meter = new MeteredResearch(exa, firecrawl, {
  rpc: sink.rpc,
  userId: ownerUserId,
  runKey,
  caps,
  ...(fast ? { pacingMs: { exa: 0, firecrawl: 0 } } : {}),
});

try {
  const report = await runPipeline(
    { runKey, today, trigger, profile: cfg.profile, queries: cfg.queries, excludeHosts: cfg.excludeHosts, officialDomains: cfg.officialDomains, aggregators: cfg.aggregators },
    { meter, sink, robots: new RobotsPolicy() },
  );
  if (env.PIES_REPORT_PATH) writeFileSync(env.PIES_REPORT_PATH, report.markdown);
  // Paused = the owner's database switch is off. That is a deliberate state, not a failure:
  // exit 0 so a paused schedule does not raise a red run or a failure email every day.
  const paused = report.outcome === "blocked" && (report.stoppedEarly ?? "").includes("paid_operations_disabled");
  // Already done = a later daily attempt after today's research succeeded (several cron times guard
  // against GitHub skipping a scheduled slot). Also exit 0: nothing is wrong and nothing was spent.
  const alreadyDone = report.outcome === "blocked" && (report.stoppedEarly ?? "").includes("duplicate_operation");
  console.log(JSON.stringify({ ok: true, trigger, caps, outcome: paused ? "paused" : alreadyDone ? "already_done" : report.outcome, metrics: report.metrics, stoppedEarly: report.stoppedEarly ? report.stoppedEarly.split(":")[0] : null }));
  await sink.close();
  // blocked = nothing was extracted (budget, gate, auth, quota). empty/low_yield are reported, not failures.
  process.exit(report.outcome === "blocked" && !paused && !alreadyDone ? 4 : 0);
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" }));
  await sink.close().catch(() => {});
  process.exit(4);
}
