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
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, numResults: number): Promise<SearchOutcome>;
}

const exaResponse = z.object({
  results: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().nullish(),
      publishedDate: z.string().nullish(),
      text: z.string().nullish(),
    }),
  ),
  costDollars: z.object({ total: z.number().nonnegative() }).partial().nullish(),
});

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
      { ...this.http, provider: this.name },
    );
    const parsed = exaResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError(this.name, "invalid_response", 200);
    return {
      hits: parsed.data.results.slice(0, n).map((r) => ({
        url: r.url,
        title: (r.title ?? "").trim().slice(0, 500),
        publishedAt: r.publishedDate ?? null,
        snippet: (r.text ?? "").slice(0, 1500),
      })),
      reportedUsd: parsed.data.costDollars?.total ?? null,
    };
  }
}
