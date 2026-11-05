// PIES research runner: the n8n replacement. Runs anywhere Node 22 runs (GitHub Actions, a laptop, a VM).
// Usage: node scripts/run-pipeline.ts
// Exit codes: 0 ran (outcome productive | low_yield | empty), 2 configuration error,
//             3 blocked by a local safety gate (nothing was called), 4 blocked or failed during the run.
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

const problems = liveModeProblems(env);
for (const k of ["PIES_AUTOMATION_DATABASE_URL", "PIES_AUTOMATION_INTEGRATION_ID", "PIES_OWNER_USER_ID"]) if (!env[k]) problems.push(`${k} is missing`);
if (env.PIES_AUTOMATION_DATABASE_URL && !/^postgres(ql)?:\/\/pies_automation[.:@]/.test(env.PIES_AUTOMATION_DATABASE_URL)) {
  problems.push("PIES_AUTOMATION_DATABASE_URL must connect as the pies_automation role");
}
const override = env.PIES_PROVIDER_BASE_URL_OVERRIDE;
if (override && !/^http:\/\/127\.0\.0\.1:\d+$/.test(override)) problems.push("PIES_PROVIDER_BASE_URL_OVERRIDE must be http://127.0.0.1:<port>");
if (problems.length) fail(3, `blocked (no provider or database call made):\n- ${problems.join("\n- ")}`);

const today = new Date().toISOString().slice(0, 10);
const sql = postgres(env.PIES_AUTOMATION_DATABASE_URL!, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  connection: { application_name: "pies-research-runner", statement_timeout: 15000 },
});
const sink = dbSink(sql as never, env.PIES_AUTOMATION_INTEGRATION_ID!);
const http = { maxRetries: 1, timeoutMs: 30_000 };
const exa = new ExaSearch(env.EXA_API_KEY!, http, override ? `${override}/exa` : undefined);
const firecrawl = new FirecrawlExtract(env.FIRECRAWL_API_KEY!, http, override ? `${override}/firecrawl` : undefined);
const fast = Boolean(override);
const meter = new MeteredResearch(exa, firecrawl, {
  rpc: sink.rpc,
  userId: env.PIES_OWNER_USER_ID!,
  runKey: `${today}:pies-research`,
  caps: cfg.caps,
  ...(fast ? { pacingMs: { exa: 0, firecrawl: 0 } } : {}),
});

try {
  const report = await runPipeline(
    { runKey: `${today}:pies-research`, today, trigger: env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "manual", profile: cfg.profile, queries: cfg.queries, excludeHosts: cfg.excludeHosts, officialDomains: cfg.officialDomains, aggregators: cfg.aggregators },
    { meter, sink, robots: new RobotsPolicy() },
  );
  if (env.PIES_REPORT_PATH) writeFileSync(env.PIES_REPORT_PATH, report.markdown);
  console.log(JSON.stringify({ ok: true, outcome: report.outcome, metrics: report.metrics, stoppedEarly: report.stoppedEarly ? report.stoppedEarly.split(":")[0] : null }));
  await sink.close();
  // blocked = nothing was extracted (budget, gate, auth, quota). empty/low_yield are reported, not failures.
  process.exit(report.outcome === "blocked" ? 4 : 0);
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" }));
  await sink.close().catch(() => {});
  process.exit(4);
}
