import { z } from "zod";
import { postJson, ProviderError, type HttpOptions } from "./http.ts";

/** Extraction adapter: Firecrawl /v2/scrape, one page at a time (no crawl, no agent). */

export interface ExtractedPage {
  url: string;
  title: string;
  markdown: string;
  statusCode: number | null;
  /** Credits the provider reported, if any. */
  reportedCredits: number | null;
}

export interface ExtractProvider {
  readonly name: string;
  extract(url: string): Promise<ExtractedPage>;
}

const scrapeResponse = z.object({
  success: z.boolean(),
  data: z
    .object({
      markdown: z.string().nullish(),
      metadata: z
        .object({
          title: z.string().nullish(),
          sourceURL: z.string().nullish(),
          url: z.string().nullish(),
          statusCode: z.number().nullish(),
          creditsUsed: z.number().nullish(),
        })
        .partial()
        .nullish(),
    })
    .nullish(),
});

export const MAX_PAGE_CHARS = 60_000;

export class FirecrawlExtract implements ExtractProvider {
  readonly name = "firecrawl";
  private readonly apiKey: string;
  private readonly http: Omit<HttpOptions, "provider">;
  private readonly baseUrl: string;
  constructor(apiKey: string, http: Omit<HttpOptions, "provider"> = {}, baseUrl = "https://api.firecrawl.dev") {
    if (!apiKey) throw new Error("Firecrawl API key missing");
    this.apiKey = apiKey;
    this.http = http;
    this.baseUrl = baseUrl;
  }

  async extract(url: string): Promise<ExtractedPage> {
    if (!/^https?:\/\//i.test(url)) throw new ProviderError(this.name, "bad_request", null);
    const raw = await postJson(
      `${this.baseUrl}/v2/scrape`,
      { authorization: `Bearer ${this.apiKey}` },
      { url, formats: ["markdown"], onlyMainContent: true, timeout: 30000 },
      { ...this.http, provider: this.name, timeoutMs: 45_000 },
    );
    const parsed = scrapeResponse.safeParse(raw);
    if (!parsed.success || !parsed.data.success || !parsed.data.data) throw new ProviderError(this.name, "invalid_response", 200);
    const d = parsed.data.data;
    return {
      url: d.metadata?.sourceURL ?? d.metadata?.url ?? url,
      title: (d.metadata?.title ?? "").trim().slice(0, 500),
      markdown: (d.markdown ?? "").slice(0, MAX_PAGE_CHARS),
      statusCode: d.metadata?.statusCode ?? null,
      reportedCredits: d.metadata?.creditsUsed ?? null,
    };
  }
}
