import { randomUUID } from "node:crypto";
import { BudgetDeniedError } from "../budget/governor.ts";
import { ProviderError } from "../research/http.ts";
import { MeteredResearch, RunCapReached } from "../research/metered.ts";
import type { RobotsPolicy } from "../research/robots.ts";
import { contentHash, dedupeKey, normalizeUrl, siteOf } from "../research/url.ts";
import { draftableContact, extractContacts, type PublicContact } from "./contacts.ts";
import { buildDraft, safeTitle } from "./outreach.ts";
import { prioritize, qualify, type Qualification, type VerifiedProfile } from "./qualify.ts";
import type { PipelineSink } from "./sink.ts";
import { extractFacts, verificationStatus, type PageFacts, type VerificationStatus } from "./verify.ts";

/**
 * Discover -> Extract -> Verify -> Qualify -> Prioritize -> Contacts -> Draft -> Report.
 * Deterministic except the two provider calls, which are metered. Partial failure is
 * normal: every candidate is processed independently and the run still reports.
 */

export const OPPORTUNITY_CATEGORIES = ["employment", "education", "scholarship", "grant", "funding", "accelerator", "partnership", "consulting", "commercial", "other"] as const;

export interface QuerySpec {
  project: string; // project slug, e.g. "education-funding"
  category: (typeof OPPORTUNITY_CATEGORIES)[number];
  query: string;
  numResults: number;
  strategicFit: "primary" | "secondary";
}

export interface PipelineConfig {
  runKey: string;
  today: string; // YYYY-MM-DD
  trigger: "schedule" | "manual";
  profile: VerifiedProfile;
  queries: QuerySpec[];
  /** Skip hosts that are known aggregators or blocked by owner policy. */
  excludeHosts?: string[];
}

export interface CandidateResult {
  url: string;
  title: string;
  spec: QuerySpec;
  status: "persisted" | "rejected" | "skipped" | "failed";
  reason?: string;
  verification?: VerificationStatus;
  facts?: PageFacts;
  q?: Qualification;
  contacts?: PublicContact[];
  draft?: ReturnType<typeof buildDraft>;
}

export interface PipelineReport {
  runKey: string;
  metrics: {
    queries: number;
    hits: number;
    duplicates: number;
    extracted: number;
    verified: number;
    persisted: number;
    rejected: number;
    skipped: number;
    failed: number;
    drafts: number;
    reservedUsd: number;
    committedUsd: number;
  };
  stoppedEarly: string | null;
  candidates: CandidateResult[];
  markdown: string;
}

export async function runPipeline(
  config: PipelineConfig,
  deps: { meter: MeteredResearch; sink: PipelineSink; robots: RobotsPolicy; agent?: string; nonce?: string },
): Promise<PipelineReport> {
  const agent = deps.agent ?? "discovery";
  const { sink, meter } = deps;
  let seq = 0;
  // Request ids must be unique per INVOCATION: the database replays the stored response for a
  // reused id, so a same-day retry would otherwise get the previous (closed) run back.
  // Budget idempotency keys (in MeteredResearch) stay day-stable so retries never re-spend.
  const nonce = deps.nonce ?? randomUUID().slice(0, 8);
  const rid = (op: string) => `${config.runKey}:${nonce}:${op}:${++seq}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 128);
  const exec = async (op: string, payload: Record<string, unknown>) => {
    const r = await sink.execute(rid(op), agent, op, payload);
    if (r.ok !== true) throw new Error(`${op} refused: ${String(r.error ?? "unknown")}`);
    return r;
  };

  const start = await exec("run.start", { workflow: "pies-research", trigger: config.trigger, max_tasks: 50 });
  const runId = String(start.run_id);
  const candidates: CandidateResult[] = [];
  const seen = new Set<string>();
  const exclude = new Set((config.excludeHosts ?? []).map((h) => h.toLowerCase()));
  let hits = 0;
  let duplicates = 0;
  let stoppedEarly: string | null = null;
  const stop = (err: unknown): boolean => {
    if (err instanceof BudgetDeniedError) stoppedEarly = `budget: ${err.reason}`;
    else if (err instanceof RunCapReached) stoppedEarly = err.message;
    else if (err instanceof ProviderError && (err.failure === "quota_exhausted" || err.failure === "unauthorized")) stoppedEarly = err.message;
    return stoppedEarly !== null;
  };

  // 1. Discover
  const queue: { url: string; title: string; snippet: string; spec: QuerySpec }[] = [];
  for (const spec of config.queries) {
    if (stoppedEarly) break;
    try {
      const out = await meter.searchOnce(spec.query, spec.numResults);
      for (const h of out.hits) {
        hits++;
        const n = normalizeUrl(h.url);
        if (!n || exclude.has(new URL(n).hostname)) continue;
        if (seen.has(n)) {
          duplicates++;
          continue;
        }
        seen.add(n);
        queue.push({ url: n, title: h.title, snippet: h.snippet, spec });
      }
    } catch (err) {
      if (!stop(err)) candidates.push({ url: "", title: spec.query, spec, status: "failed", reason: errText(err) });
    }
  }

  // 2-7. Extract, verify, qualify, contacts, draft, persist
  for (const c of queue) {
    if (stoppedEarly) {
      candidates.push({ url: c.url, title: c.title, spec: c.spec, status: "skipped", reason: "run stopped early" });
      continue;
    }
    if (!(await deps.robots.allowed(c.url))) {
      candidates.push({ url: c.url, title: c.title, spec: c.spec, status: "skipped", reason: "robots.txt disallows or unreachable" });
      continue;
    }
    let page;
    try {
      page = await meter.extractOnce(c.url);
    } catch (err) {
      if (!stop(err)) candidates.push({ url: c.url, title: c.title, spec: c.spec, status: "failed", reason: errText(err) });
      else candidates.push({ url: c.url, title: c.title, spec: c.spec, status: "skipped", reason: stoppedEarly ?? "stopped" });
      continue;
    }
    const text = page.markdown || c.snippet;
    const facts = extractFacts(text, config.today);
    const verification = verificationStatus(Boolean(page.markdown), page.statusCode, facts);
    const contacts = extractContacts(text, c.url);
    // A page with instruction-like text can plant an address on its own domain: never draft to it.
    const contact = facts.injectionSignals.length ? null : draftableContact(contacts);
    const q = qualify(facts, text, config.profile, { today: config.today, strategicFit: c.spec.strategicFit, hasPublicContact: Boolean(contact) });
    const title = safeTitle(page.title || c.title, facts.injectionSignals.length > 0);
    const row: CandidateResult = { url: c.url, title, spec: c.spec, status: "rejected", verification, facts, q, contacts };
    candidates.push(row);
    if (q.eligibility === "ineligible") {
      row.reason = q.gateFailures.join("; ");
      continue;
    }
    try {
      const opp = await exec("opportunity.upsert", {
        run_id: runId,
        project: c.spec.project,
        title,
        category: c.spec.category,
        description: c.snippet.slice(0, 1000) || null,
        deadline: facts.deadline ? `${facts.deadline.value}T23:59:59Z` : null,
        financial_value: facts.amount?.value.value ?? null,
        currency: facts.amount?.value.currency ?? null,
        source_url: c.url,
        dedupe_key: dedupeKey(c.url),
      });
      const evidence = [
        `verification: ${verification}`,
        facts.deadline ? `deadline (${facts.deadline.confidence}): "${facts.deadline.quote}"` : "deadline: not found",
        facts.maxAge ? `age (${facts.maxAge.confidence}): "${facts.maxAge.quote}"` : null,
        facts.applicationFee ? `fee: "${facts.applicationFee.quote}"` : null,
        facts.injectionSignals.length ? `WARNING instruction-like text on page: ${facts.injectionSignals.length} pattern(s)` : null,
      ].filter(Boolean).join("\n");
      await exec("source.add", {
        run_id: runId,
        opportunity_id: opp.opportunity_id,
        url: c.url,
        source_type: page.markdown ? "official" : "search_result",
        evidence_excerpt: evidence.slice(0, 5000),
        content_hash: contentHash(text),
      });
      row.draft = buildDraft({ title, suspicious: facts.injectionSignals.length > 0, organization: siteOf(c.url), deadline: facts.deadline?.value ?? null, contact, profile: config.profile });
      const due = facts.deadline ? new Date(Date.parse(`${facts.deadline.value}T00:00:00Z`) - 7 * 86_400_000).toISOString() : null;
      await exec("task.create", {
        run_id: runId,
        project: c.spec.project,
        title: `Review: ${title} (score ${q.total} [rules v1], ${q.eligibility})`.slice(0, 500),
        description: taskBody(row).slice(0, 4000),
        due_at: due,
        priority: q.total >= 70 ? 1 : q.total >= 50 ? 2 : 3,
      });
      row.status = "persisted";
    } catch (err) {
      row.status = "failed";
      row.reason = errText(err);
    }
  }

  const ranked = prioritize(candidates.filter((c) => c.q && c.status === "persisted").map((c) => ({ item: c, q: c.q! })));
  const m = {
    queries: config.queries.length,
    hits,
    duplicates,
    extracted: candidates.filter((c) => c.facts).length,
    verified: candidates.filter((c) => c.verification === "verified").length,
    persisted: candidates.filter((c) => c.status === "persisted").length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
    skipped: candidates.filter((c) => c.status === "skipped").length,
    failed: candidates.filter((c) => c.status === "failed").length,
    drafts: candidates.filter((c) => c.draft).length,
    reservedUsd: round6(meter.stats.reservedUsd),
    committedUsd: round6(meter.stats.committedUsd),
  };
  const markdown = renderReport(config, m, ranked.map((r) => r.item), candidates, stoppedEarly);
  try {
    await exec("task.create", { run_id: runId, title: `PIES research report ${config.today}: ${m.persisted} new, ${m.rejected} rejected`, description: markdown.slice(0, 4000), priority: 2 });
  } catch {
    /* the report is still returned to the caller */
  }
  const failedRun = m.persisted === 0 && (m.failed > 0 || stoppedEarly !== null);
  await exec("run.finish", { run_id: runId, status: failedRun ? "failed" : "succeeded", ...(failedRun ? { error: (stoppedEarly ?? "all candidates failed").slice(0, 500) } : {}) });
  return { runKey: config.runKey, metrics: m, stoppedEarly, candidates, markdown };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : "unknown error";
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function taskBody(c: CandidateResult): string {
  const q = c.q!;
  const lines = [
    `Source: ${c.url}`,
    `Verification: ${c.verification}`,
    `Score ${q.total}/100 [rules v1]: eligibility ${q.parts.eligibility}/25, experience ${q.parts.experience}/20, value ${q.parts.value}/20, strategic ${q.parts.strategic}/15, access ${q.parts.access}/10, timing ${q.parts.timing}/10`,
    `Eligibility: ${q.eligibility} (owner confirms; automation never marks eligible)`,
    q.missing.length ? `Missing: ${q.missing.join(", ")}` : null,
    c.facts?.deadline ? `Deadline ${c.facts.deadline.value}: "${c.facts.deadline.quote}"` : "Deadline: not found on page",
    c.contacts?.length ? `Public contacts on page: ${c.contacts.map((x) => `${x.value}${x.sameDomain ? "" : " (other domain, not used)"}`).join(", ")}` : "Public contacts: none on page",
    c.draft ? `\nDRAFT (not sent; PIES cannot send)\nTo: ${c.draft.to ?? "(no verified address)"}\nSubject: ${c.draft.subject}\n\n${c.draft.body}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function renderReport(config: PipelineConfig, m: PipelineReport["metrics"], ranked: CandidateResult[], all: CandidateResult[], stopped: string | null): string {
  const out = [
    `# PIES research report ${config.today}`,
    "",
    `Queries ${m.queries} · hits ${m.hits} · duplicates ${m.duplicates} · extracted ${m.extracted} · verified ${m.verified} · saved ${m.persisted} · rejected ${m.rejected} · skipped ${m.skipped} · failed ${m.failed} · drafts ${m.drafts}`,
    `Spend: reserved $${m.reservedUsd.toFixed(4)}, committed $${m.committedUsd.toFixed(4)} (search category)`,
    stopped ? `Stopped early: ${stopped}` : null,
    "",
    "## Priority list",
    ...(ranked.length ? ranked.map((c, i) => `${i + 1}. ${c.title} — ${c.q!.total}/100, ${c.q!.eligibility}, deadline ${c.facts?.deadline?.value ?? "unknown"} (${c.url})`) : ["(none)"]),
    "",
    "## Rejected",
    ...(all.filter((c) => c.status === "rejected").map((c) => `- ${c.title}: ${c.reason ?? ""}`) || []),
    "",
    "## Failed or skipped",
    ...all.filter((c) => c.status === "failed" || c.status === "skipped").map((c) => `- ${c.url || c.title}: ${c.reason ?? ""}`),
  ];
  return out.filter((l) => l !== null).join("\n");
}
