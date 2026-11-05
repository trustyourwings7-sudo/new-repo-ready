import { describe, expect, it, vi } from "vitest";
import { ExaSearch, reportedExaCost } from "../src/lib/research/exa.ts";
import { FirecrawlExtract, looksLikePdf } from "../src/lib/research/firecrawl.ts";
import { postJson, ProviderError, type FetchLike } from "../src/lib/research/http.ts";
import { liveModeProblems, MeteredResearch, RunCapReached, UnexpectedCost } from "../src/lib/research/metered.ts";
import { exaSearchListUsd, FIRECRAWL_RESERVE_CREDITS, firecrawlListUsd, PRICES, withSafety } from "../src/lib/research/pricing.ts";
import { isAllowedByRobots, RobotsPolicy } from "../src/lib/research/robots.ts";
import { dedupeKey, normalizeUrl, siteOf } from "../src/lib/research/url.ts";
import { memorySink } from "../src/lib/pipeline/sink.ts";
import { BudgetDeniedError, ChargedFailure, withBudget } from "../src/lib/budget/governor.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("provider HTTP layer", () => {
  it("retries a 429 once, then succeeds", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(postJson("https://x", {}, {}, { provider: "t", fetchImpl: f, sleep: noSleep })).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry 402 (allowance exhausted) or 401", async () => {
    for (const status of [402, 401]) {
      const f = vi.fn<FetchLike>().mockResolvedValue(json(status, {}));
      const err = (await postJson("https://x", {}, {}, { provider: "t", fetchImpl: f, sleep: noSleep, maxRetries: 3 }).catch((e: ProviderError) => e)) as ProviderError;
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.failure).toBe(status === 402 ? "quota_exhausted" : "unauthorized");
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("caps retries at 3 and reports the last failure", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(503, {}));
    const err = (await postJson("https://x", {}, {}, { provider: "t", fetchImpl: f, sleep: noSleep, maxRetries: 99 }).catch((e: ProviderError) => e)) as ProviderError;
    expect(err.failure).toBe("server_error");
    expect(f).toHaveBeenCalledTimes(4);
  });
  it("times out", async () => {
    const f: FetchLike = (_u, init) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))));
    const err = (await postJson("https://x", {}, {}, { provider: "t", fetchImpl: f, sleep: noSleep, maxRetries: 0, timeoutMs: 10 }).catch((e: ProviderError) => e)) as ProviderError;
    expect(err.failure).toBe("timeout");
  });
  it("rejects a non-JSON body as invalid_response", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(new Response("<html>", { status: 200 }));
    const err = (await postJson("https://x", {}, {}, { provider: "t", fetchImpl: f, sleep: noSleep }).catch((e: ProviderError) => e)) as ProviderError;
    expect(err.failure).toBe("invalid_response");
  });
});

describe("Exa adapter", () => {
  it("sends the key as a header, caps results at 10, and parses hits and cost", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(
      json(200, { results: [{ url: "https://uni.example.org/s", title: " Scholarship ", publishedDate: "2026-10-01", text: "body" }], costDollars: { total: 0.005 } }),
    );
    const out = await new ExaSearch("k-123", { fetchImpl: f }).search("scholarships", 50);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.exa.ai/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k-123");
    expect(JSON.parse(String(init.body)).numResults).toBe(10);
    expect(out).toEqual({ hits: [{ url: "https://uni.example.org/s", title: "Scholarship", publishedAt: "2026-10-01", snippet: "body" }], reportedUsd: 0.005, dropped: 0 });
  });
  it("rejects a response that is not the documented shape (results not an array)", async () => {
    for (const body of [{ results: "x" }, {}, { results: null }]) {
      const f = vi.fn<FetchLike>().mockResolvedValue(json(200, body));
      await expect(new ExaSearch("k", { fetchImpl: f }).search("q", 1)).rejects.toMatchObject({ failure: "invalid_response" });
    }
  });
  it("refuses to construct without a key", () => {
    expect(() => new ExaSearch("")).toThrow();
  });
});

describe("Firecrawl adapter", () => {
  it("scrapes one page as markdown with a bearer key", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(200, { success: true, data: { markdown: "# Hi", metadata: { title: "T", sourceURL: "https://a.org/p", statusCode: 200, creditsUsed: 1 } } }));
    const page = await new FirecrawlExtract("fc-key", { fetchImpl: f }).extract("https://a.org/p");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer fc-key");
    expect(JSON.parse(String(init.body))).toMatchObject({ url: "https://a.org/p", formats: ["markdown"], onlyMainContent: true });
    expect(page).toMatchObject({ title: "T", markdown: "# Hi", statusCode: 200, reportedCredits: 1 });
  });
  it("treats success:false as invalid and refuses non-http URLs", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(200, { success: false }));
    await expect(new FirecrawlExtract("k", { fetchImpl: f }).extract("https://a.org")).rejects.toMatchObject({ failure: "invalid_response" });
    await expect(new FirecrawlExtract("k", { fetchImpl: f }).extract("file:///etc/passwd")).rejects.toMatchObject({ failure: "bad_request" });
  });
});

describe("URL normalization and dedupe", () => {
  it("strips tracking, fragments, www and trailing slashes; rejects credentials and non-http", () => {
    expect(normalizeUrl("https://WWW.Uni.org/apply/?utm_source=x&b=2&a=1#top")).toBe("https://uni.org/apply?a=1&b=2");
    expect(normalizeUrl("https://user:pw@uni.org/")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("produces keys the database accepts", () => {
    expect(dedupeKey("https://uni.org/apply")).toMatch(/^[A-Za-z0-9._:/-]{8,200}$/);
    expect(siteOf("https://admissions.ox.ac.uk/x")).toBe("ox.ac.uk");
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/open\n\nUser-agent: pies-research\nDisallow: /no-pies";
  it("uses our own group when present, longest match otherwise", () => {
    expect(isAllowedByRobots(robots, "/no-pies/x")).toBe(false);
    expect(isAllowedByRobots(robots, "/private/x")).toBe(true); // our group has no /private rule
    expect(isAllowedByRobots("User-agent: *\nDisallow: /private\nAllow: /private/open", "/private/open/a")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /private", "/private/a")).toBe(false);
  });
  it("fails closed on 5xx/network errors and open on 404", async () => {
    const f5 = vi.fn<FetchLike>().mockResolvedValue(new Response("", { status: 503 }));
    expect(await new RobotsPolicy(f5).allowed("https://a.org/x")).toBe(false);
    const f4 = vi.fn<FetchLike>().mockResolvedValue(new Response("", { status: 404 }));
    expect(await new RobotsPolicy(f4).allowed("https://b.org/x")).toBe(true);
    const fe = vi.fn<FetchLike>().mockRejectedValue(new Error("dns"));
    expect(await new RobotsPolicy(fe).allowed("https://c.org/x")).toBe(false);
  });
});

describe("pricing (published billing semantics)", () => {
  it("prices an Exa search as request + one content page per result, capped at 10", () => {
    expect(exaSearchListUsd(0)).toBe(0.007);
    expect(exaSearchListUsd(10)).toBe(0.017);
    expect(() => exaSearchListUsd(11)).toThrow();
    expect(withSafety(exaSearchListUsd(10))).toBeGreaterThan(exaSearchListUsd(10));
  });
  it("reserves a Firecrawl margin above the 1-credit base", () => {
    expect(FIRECRAWL_RESERVE_CREDITS).toBeGreaterThan(1);
    expect(firecrawlListUsd(1)).toBeCloseTo(PRICES.firecrawlCredit.usdPerUnit, 6);
  });
  it("makes the governor, not luck, the thing that stops a month of default runs", () => {
    const perRun = 3 * withSafety(exaSearchListUsd(10)) + 10 * withSafety(firecrawlListUsd(FIRECRAWL_RESERVE_CREDITS));
    expect(30 * perRun).toBeGreaterThan(2);
  });
});

describe("metered research (governor + caps)", () => {
  const providers = () => {
    const search = { name: "exa", search: vi.fn(async (_q: string, _n: number) => ({ hits: [] as { url: string; title: string; publishedAt: string | null; snippet: string }[], reportedUsd: 0.007 as number | null, dropped: 0 })) };
    const extract = { name: "firecrawl", extract: vi.fn(async (url: string) => ({ url, title: "", markdown: "x", statusCode: 200, reportedCredits: 1 as number | null })) };
    return { search, extract };
  };
  const ctx = (sink: ReturnType<typeof memorySink>, caps = { searches: 2, extractions: 2 }) => ({ rpc: sink.rpc, userId: "u", runKey: "2026-11-05:t", caps, pacingMs: { exa: 0, firecrawl: 0 } });

  it("never calls a provider when paid operations are disabled", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: false });
    const p = providers();
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await expect(m.searchOnce("q", 3)).rejects.toBeInstanceOf(BudgetDeniedError);
    expect(p.search.search).not.toHaveBeenCalled();
    expect(m.stats.denied).toEqual(["search:paid_operations_disabled"]);
  });
  it("does not repeat a paid call with the same idempotency key (same run, same query)", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await m.searchOnce("same", 3);
    await expect(m.searchOnce("same", 3)).rejects.toMatchObject({ reason: "duplicate_operation" });
    expect(p.search.search).toHaveBeenCalledTimes(1);
  });
  it("stops at the budget and at per-run caps", async () => {
    const sink = memorySink({ budgetUsd: 0.01, paidEnabled: true });
    const p = providers();
    const m = new MeteredResearch(p.search, p.extract, ctx(sink, { searches: 5, extractions: 1 }));
    await m.searchOnce("a", 1);
    await expect(m.searchOnce("b", 1)).rejects.toMatchObject({ reason: "category_limit_exceeded" });
    expect(sink.spentUsd()).toBeLessThanOrEqual(0.01);
    const m2 = new MeteredResearch(p.search, p.extract, ctx(memorySink({ budgetUsd: 2, paidEnabled: true }), { searches: 1, extractions: 0 }));
    await expect(m2.extractOnce("https://a.org")).rejects.toBeInstanceOf(RunCapReached);
  });
  it("reserves the worst case (10 results with text) and commits Exa's reported cost", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    p.search.search.mockResolvedValueOnce({ hits: [], reportedUsd: 0.012, dropped: 0 });
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await m.searchOnce("q", 10);
    expect(m.stats.reservedUsd).toBe(withSafety(0.017));
    expect(sink.spentUsd()).toBe(0.012);
  });
  it("commits list price for what came back when Exa reports no (or a nonsensical) cost", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    const hit = { url: "https://a.org", title: "", publishedAt: null, snippet: "" };
    p.search.search.mockResolvedValueOnce({ hits: [hit, hit, hit], reportedUsd: null, dropped: 1 });
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await m.searchOnce("q", 10);
    expect(sink.spentUsd()).toBe(exaSearchListUsd(4)); // 3 kept + 1 dropped were still returned and billed
  });
  it("charges a possibly-billed failure (5xx/timeout) at the reservation's list price instead of releasing it", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    p.search.search.mockRejectedValueOnce(new ProviderError("exa", "server_error", 500));
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await expect(m.searchOnce("x", 10)).rejects.toBeInstanceOf(ProviderError);
    expect(sink.spentUsd()).toBe(exaSearchListUsd(10));
    expect(m.stats.chargedFailures).toBe(1);
  });
  it("releases a definite refusal (401/402/429) without charging", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    p.extract.extract.mockRejectedValueOnce(new ProviderError("firecrawl", "quota_exhausted", 402));
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await expect(m.extractOnce("https://a.org")).rejects.toMatchObject({ failure: "quota_exhausted" });
    expect(sink.spentUsd()).toBe(0);
  });
  it("commits an unexpectedly high reported cost (it was spent) and then stops", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    p.extract.extract.mockResolvedValueOnce({ url: "https://a.org", title: "", markdown: "x", statusCode: 200, reportedCredits: 40 });
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await expect(m.extractOnce("https://a.org")).rejects.toBeInstanceOf(UnexpectedCost);
    expect(sink.spentUsd()).toBe(firecrawlListUsd(40));
    expect(m.stats.overruns).toBe(1);
  });
  it("charges 0 credits when Firecrawl returns no document and reports nothing", async () => {
    const sink = memorySink({ budgetUsd: 2, paidEnabled: true });
    const p = providers();
    p.extract.extract.mockResolvedValueOnce({ url: "https://a.org", title: "", markdown: "", statusCode: 200, reportedCredits: null });
    const m = new MeteredResearch(p.search, p.extract, ctx(sink));
    await m.extractOnce("https://a.org");
    expect(sink.spentUsd()).toBe(0);
  });
});

describe("adapter edge cases (auth, schema variations, quota, cost fields)", () => {
  it("paid adapters never retry a timeout or 5xx (a retry could bill twice), only 429", async () => {
    const f5 = vi.fn<FetchLike>().mockResolvedValue(json(503, {}));
    await expect(new ExaSearch("k", { fetchImpl: f5, sleep: noSleep, maxRetries: 3 }).search("q", 1)).rejects.toMatchObject({ failure: "server_error" });
    expect(f5).toHaveBeenCalledTimes(1);
    const f429 = vi.fn<FetchLike>().mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(200, { success: true, data: { markdown: "m" } }));
    await expect(new FirecrawlExtract("k", { fetchImpl: f429, sleep: noSleep, maxRetries: 1 }).extract("https://a.org")).resolves.toMatchObject({ markdown: "m" });
    expect(f429).toHaveBeenCalledTimes(2);
  });
  it("maps 401 and 403 to unauthorized and 402 to quota_exhausted", async () => {
    for (const [status, failure] of [[401, "unauthorized"], [403, "unauthorized"], [402, "quota_exhausted"]] as const) {
      const f = vi.fn<FetchLike>().mockResolvedValue(json(status, { error: "x" }));
      await expect(new ExaSearch("k", { fetchImpl: f, sleep: noSleep }).search("q", 1)).rejects.toMatchObject({ failure });
    }
  });
  it("accepts Exa cost as {total} or a bare number, ignores nonsensical values, drops results without URLs", async () => {
    expect(reportedExaCost({ total: 0.01 })).toBe(0.01);
    expect(reportedExaCost(0.02)).toBe(0.02);
    expect(reportedExaCost({ total: -1 })).toBeNull();
    expect(reportedExaCost("0.01")).toBeNull();
    expect(reportedExaCost(undefined)).toBeNull();
    const f = vi.fn<FetchLike>().mockResolvedValue(json(200, { results: [{ url: "https://ok.org" }, { title: "no url" }, { url: "ftp://x" }], costDollars: 0.009 }));
    const out = await new ExaSearch("k", { fetchImpl: f }).search("q", 10);
    expect(out.hits.map((h) => h.url)).toEqual(["https://ok.org"]);
    expect(out.dropped).toBe(2);
    expect(out.reportedUsd).toBe(0.009);
  });
  it("reads Firecrawl credits from metadata or top level, disables PDF parsing, and refuses PDFs before any call", async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(200, { success: true, creditsUsed: 1, data: { markdown: "m", metadata: {} } }));
    const page = await new FirecrawlExtract("k", { fetchImpl: f }).extract("https://a.org/p");
    expect(page.reportedCredits).toBe(1);
    expect(JSON.parse(String(f.mock.calls[0]![1].body)).parsers).toEqual([]);
    const g = vi.fn<FetchLike>();
    await expect(new FirecrawlExtract("k", { fetchImpl: g }).extract("https://a.org/brochure.PDF")).rejects.toMatchObject({ failure: "bad_request" });
    expect(g).not.toHaveBeenCalled();
    expect(looksLikePdf("https://a.org/x.pdf?dl=1")).toBe(true);
  });
});

describe("governor: charged failures", () => {
  it("commits the charged amount and rethrows the original error", async () => {
    const calls: string[] = [];
    const rpc = {
      rpc: async (fn: string) => {
        calls.push(fn);
        return fn === "reserve_budget" ? { data: { allowed: true, reason: "reserved", usage_id: "00000000-0000-4000-8000-000000000001" }, error: null } : { data: { ok: true }, error: null };
      },
    };
    const original = new Error("timeout");
    await expect(withBudget(rpc, { category: "search", provider: "exa", operation: "s", estimatedUsd: 0.02, idempotencyKey: "k-12345678" }, async () => { throw new ChargedFailure(0.017, original); })).rejects.toBe(original);
    expect(calls).toEqual(["reserve_budget", "commit_usage"]);
  });
});

describe("live-mode gate", () => {
  const base = { PIES_LIVE_RESEARCH: "1", PIES_PRICES_CONFIRMED_ON: "2026-11-01", EXA_API_KEY: "a", FIRECRAWL_API_KEY: "b" };
  it("passes only with switch, fresh price confirmation and both keys", () => {
    expect(liveModeProblems(base, new Date("2026-11-05T00:00:00Z"))).toEqual([]);
    expect(liveModeProblems({ ...base, PIES_LIVE_RESEARCH: undefined }, new Date("2026-11-05"))).toHaveLength(1);
    expect(liveModeProblems({ ...base, PIES_PRICES_CONFIRMED_ON: "2026-09-01" }, new Date("2026-11-05"))).toHaveLength(1);
    expect(liveModeProblems({}, new Date("2026-11-05"))).toHaveLength(4);
  });
});

describe("runner modules load in plain Node (strip-only TypeScript, as in GitHub Actions)", () => {
  // Vitest and Next transpile fully, so syntax Node cannot strip (parameter properties, enums)
  // would pass every other test and still break the scheduled runner. Caught once on 2026-11-05.
  it.each(["src/lib/pipeline/run.ts", "src/lib/pipeline/sink.ts", "src/lib/research/metered.ts", "src/lib/budget/governor.ts"])("%s", async (file) => {
    const { execFileSync } = await import("node:child_process");
    expect(() => execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", `await import("./${file}")`], { cwd: process.cwd(), stdio: "pipe" })).not.toThrow();
  });
});

describe("budget ceilings stay fixed", () => {
  it("keeps $10 total and $2 for research, and books every research call to the search category", async () => {
    const { DEFAULT_CATEGORY_LIMITS_USD, HARD_MONTHLY_CAP_USD } = await import("../src/lib/budget/constants.ts");
    expect(HARD_MONTHLY_CAP_USD).toBe(10);
    expect(DEFAULT_CATEGORY_LIMITS_USD.search).toBe(2);
    const seen: unknown[] = [];
    const rpc = { rpc: async (fn: string, a: Record<string, unknown>) => (fn === "reserve_budget" && seen.push(a.p_category), { data: { allowed: false, reason: "paid_operations_disabled" }, error: null }) };
    const m = new MeteredResearch({ name: "exa", search: vi.fn() }, { name: "firecrawl", extract: vi.fn() }, { rpc, userId: "u", runKey: "2026-11-05:t", caps: { searches: 1, extractions: 1 }, pacingMs: { exa: 0, firecrawl: 0 } });
    await m.searchOnce("q", 1).catch(() => {});
    await m.extractOnce("https://a.org").catch(() => {});
    expect(seen).toEqual(["search", "search"]);
  });
});
