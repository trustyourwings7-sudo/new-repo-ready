import { z } from "zod";
import { postJson, ProviderError, type HttpOptions } from "./http.ts";

/** Discovery adapter: Exa /search. Replaceable: the pipeline depends only on `SearchProvider`. */

export interface SearchHit {
  url: string;
  title: string;
  publishedAt: string | null;
  snippet: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Cost the provider reported, if any (USD). */
  reportedUsd: number | null;
  /** Results the provider returned but PIES discarded (no valid http(s) URL). */
  dropped?: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, numResults: number): Promise<SearchOutcome>;
}

// Tolerant of field variations; strict about what matters. A result without a valid URL is
// dropped (and counted), not fatal. Cost may be {total: n} or a bare number; anything
// else (negative, NaN, string) is treated as "not reported" so list price is charged.
const exaResult = z.object({
  url: z.string(),
  title: z.string().nullish(),
  publishedDate: z.string().nullish(),
  text: z.string().nullish(),
});
const exaResponse = z.object({
  results: z.array(z.unknown()),
  costDollars: z.unknown().optional(),
});

export function reportedExaCost(cost: unknown): number | null {
  const n = typeof cost === "number" ? cost : typeof cost === "object" && cost !== null ? (cost as { total?: unknown }).total : undefined;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

export const EXA_MAX_RESULTS = 10;

export class ExaSearch implements SearchProvider {
  readonly name = "exa";
  private readonly apiKey: string;
  private readonly http: Omit<HttpOptions, "provider">;
  private readonly baseUrl: string;
  constructor(apiKey: string, http: Omit<HttpOptions, "provider"> = {}, baseUrl = "https://api.exa.ai") {
    if (!apiKey) throw new Error("Exa API key missing");
    this.apiKey = apiKey;
    this.http = http;
    this.baseUrl = baseUrl;
  }

  async search(query: string, numResults: number): Promise<SearchOutcome> {
    const q = query.trim().slice(0, 500);
    if (!q) throw new ProviderError(this.name, "bad_request", null);
    const n = Math.min(Math.max(Math.trunc(numResults), 1), EXA_MAX_RESULTS);
    const raw = await postJson(
      `${this.baseUrl}/search`,
      { "x-api-key": this.apiKey },
      { query: q, type: "auto", numResults: n, contents: { text: { maxCharacters: 1500 } } },
      // Paid endpoint: retry only 429 (never processed). A retry after a timeout/5xx could bill twice.
      { ...this.http, provider: this.name, retryOn: ["rate_limited"] },
    );
    const parsed = exaResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError(this.name, "invalid_response", 200);
    const hits: SearchHit[] = [];
    let dropped = 0;
    for (const item of parsed.data.results.slice(0, n)) {
      const r = exaResult.safeParse(item);
      if (!r.success || !/^https?:\/\//i.test(r.data.url)) {
        dropped++;
        continue;
      }
      hits.push({
        url: r.data.url,
        title: (r.data.title ?? "").trim().slice(0, 500),
        publishedAt: r.data.publishedDate ?? null,
        snippet: (r.data.text ?? "").slice(0, 1500),
      });
    }
    return { hits, reportedUsd: reportedExaCost(parsed.data.costDollars), dropped };
  }
}
