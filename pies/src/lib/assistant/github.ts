import "server-only";

/**
 * Minimal GitHub Actions client for "Research Now". Uses a fine-grained token limited to this
 * repository's Actions (GITHUB_ACTIONS_TOKEN, server-side only). Without the token, reads fall back
 * to the public API (the repository is public) and starting research is reported as unavailable.
 */
export const REPO = "trustyourwings7-sudo/new-repo-ready";
export const WORKFLOW = "pies-research.yml";
export const DEFAULT_BRANCH = "claude/inspiring-pasteur-hpkrv2";
const API = "https://api.github.com";

export function hasActionsToken(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS_TOKEN);
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  return fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pies-app",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
}

export interface WorkflowRun {
  id: number;
  title: string;
  event: string;
  status: string; // queued | in_progress | completed | ...
  conclusion: string | null; // success | failure | cancelled | ...
  createdAt: string;
  updatedAt: string;
  url: string;
}

function toRun(r: Record<string, unknown>): WorkflowRun {
  return {
    id: Number(r.id),
    title: String(r.display_title ?? ""),
    event: String(r.event ?? ""),
    status: String(r.status ?? ""),
    conclusion: (r.conclusion as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    url: String(r.html_url ?? ""),
  };
}

export async function listRuns(perPage = 20): Promise<WorkflowRun[]> {
  const res = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=${perPage}`);
  if (!res.ok) throw new Error(`github_${res.status}`);
  const body = (await res.json()) as { workflow_runs?: Record<string, unknown>[] };
  return (body.workflow_runs ?? []).map(toRun);
}

export async function getRun(id: number): Promise<WorkflowRun> {
  const res = await gh(`/repos/${REPO}/actions/runs/${id}`);
  if (!res.ok) throw new Error(`github_${res.status}`);
  return toRun((await res.json()) as Record<string, unknown>);
}

export interface JobStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export async function getSteps(runId: number): Promise<JobStep[]> {
  const res = await gh(`/repos/${REPO}/actions/runs/${runId}/jobs`);
  if (!res.ok) return [];
  const body = (await res.json()) as { jobs?: { steps?: { name: string; status: string; conclusion: string | null }[] }[] };
  return (body.jobs?.[0]?.steps ?? []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion }));
}

/** The runner prints exactly one JSON metrics line; logs never contain secrets or record details. */
export async function getRunMetrics(runId: number): Promise<Record<string, unknown> | null> {
  const jobs = await gh(`/repos/${REPO}/actions/runs/${runId}/jobs`);
  if (!jobs.ok) return null;
  const id = ((await jobs.json()) as { jobs?: { id: number }[] }).jobs?.[0]?.id;
  if (!id) return null;
  const res = await gh(`/repos/${REPO}/actions/jobs/${id}/logs`, { redirect: "follow" });
  if (!res.ok) return null;
  const text = await res.text();
  const line = text.split("\n").reverse().find((l) => l.includes('{"ok":'));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf('{"ok":'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const appRunTitle = (requestId: string) => `PIES research app-${requestId}`;

/** Starts the research workflow. Returns nothing; find the run by its title with findAppRun. */
export async function dispatchResearch(input: { requestId: string; query: string | null; category: string }): Promise<void> {
  if (!hasActionsToken()) throw new Error("no_token");
  const res = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: DEFAULT_BRANCH,
      inputs: { live: "yes", query: input.query ?? "", category: input.category, request_id: input.requestId },
    }),
  });
  if (res.status !== 204 && res.status !== 200) throw new Error(`dispatch_${res.status}`);
}

export async function findAppRun(requestId: string): Promise<WorkflowRun | null> {
  const runs = await listRuns(20);
  return runs.find((r) => r.title === appRunTitle(requestId)) ?? null;
}
