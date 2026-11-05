/**
 * Provider HTTP layer: timeouts, bounded retries, and typed failures.
 * Runtime-agnostic (global fetch only) so it runs in Node, GitHub Actions or a Worker.
 * Never logs request headers or bodies (they carry API keys).
 */

export type ProviderFailure =
  | "timeout"
  | "rate_limited"
  | "quota_exhausted" // provider says the allowance is used up (e.g. Firecrawl 402)
  | "unauthorized"
  | "bad_request"
  | "server_error"
  | "network_error"
  | "invalid_response";

export class ProviderError extends Error {
  readonly provider: string;
  readonly failure: ProviderFailure;
  readonly status: number | null;
  constructor(provider: string, failure: ProviderFailure, status: number | null) {
    super(`${provider}: ${failure}${status ? ` (HTTP ${status})` : ""}`);
    this.provider = provider;
    this.failure = failure;
    this.status = status;
    this.name = "ProviderError";
  }
  /** Worth retrying within the same run. */
  get retryable() {
    return this.failure === "timeout" || this.failure === "rate_limited" || this.failure === "server_error" || this.failure === "network_error";
  }
  /**
   * Could the provider have charged for this attempt? Neither Exa nor Firecrawl documents
   * billing for timeouts or 5xx, so those count as possibly billed. A 200 with an
   * unparseable body was certainly processed. 4xx refusals (400/401/402/403/429) were not.
   */
  get possiblyBilled() {
    return this.failure === "timeout" || this.failure === "server_error" || this.failure === "network_error" || this.failure === "invalid_response";
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  provider: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Retries after the first attempt. Kept small: every attempt may cost credits. */
  maxRetries?: number;
  /**
   * Failures that may be retried. Paid calls pass ["rate_limited"] only: a retry after a
   * timeout or 5xx could be billed twice, because the first attempt may have been processed.
   */
  retryOn?: ProviderFailure[];
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

function classify(status: number): ProviderFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: HttpOptions): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = Math.min(Math.max(opts.maxRetries ?? 1, 0), 3);
  const canRetry = (e: ProviderError) => e.retryable && (!opts.retryOn || opts.retryOn.includes(e.failure));
  let last: ProviderError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        last = new ProviderError(opts.provider, classify(res.status), res.status);
        if (!canRetry(last)) throw last;
        continue;
      }
      try {
        return await res.json();
      } catch {
        throw new ProviderError(opts.provider, "invalid_response", res.status);
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        if (!canRetry(err)) throw err;
        last = err;
      } else {
        last = new ProviderError(opts.provider, ctrl.signal.aborted ? "timeout" : "network_error", null);
        if (!canRetry(last)) throw last;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new ProviderError(opts.provider, "network_error", null);
}

/** Plain GET for robots.txt. Returns null on any failure (caller decides policy). */
export async function getText(url: string, fetchImpl: FetchLike = globalThis.fetch as FetchLike, timeoutMs = 8000): Promise<{ status: number; text: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "GET", signal: ctrl.signal, headers: { "user-agent": "PIES-research/1.0" } });
    return { status: res.status, text: res.ok ? (await res.text()).slice(0, 100_000) : "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
