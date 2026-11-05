import { hostOf } from "../research/url.ts";

/**
 * Who published a page. Fetching a page proves it exists, not that it is authoritative.
 *
 * official     the host is on the owner's allowlist (confirmed official), or is an
 *              institutional domain (.gov, .edu, .ac.<cc>, .int, ...). The second is a
 *              heuristic: confidence "Likely", and the owner can still reject it.
 * third_party  fetched, but published by someone else (aggregators, blogs, news, any .com/.org
 *              not on the allowlist). Useful for discovery; never "verified".
 * unverified   not fetched, non-2xx, or the page carried instruction-like text.
 */
export type SourceClass = "official" | "third_party" | "unverified";

export interface SourceAssessment {
  cls: SourceClass;
  basis: "owner_allowlist" | "institutional_domain" | "known_aggregator" | "other_publisher" | "not_fetched" | "http_error" | "injection_signals";
  confidence: "Certain" | "Likely";
}

/** Aggregators seen in PIES research; extendable by config. Never official for the opportunity itself. */
export const KNOWN_AGGREGATORS = [
  "scholarshipsforafricans.com",
  "opportunitydesk.org",
  "opportunitiesforafricans.com",
  "scholars4dev.com",
  "afterschoolafrica.com",
  "mastersportal.com",
  "bachelorsportal.com",
  "indeed.com",
  "linkedin.com",
  "glassdoor.com",
  "medium.com",
  "wikipedia.org",
];

const INSTITUTIONAL = [/\.gov$/, /\.gov\.[a-z]{2}$/, /\.edu$/, /\.edu\.[a-z]{2}$/, /\.ac\.[a-z]{2}$/, /\.int$/, /\.mil$/, /\.gouv\.[a-z]{2}$/, /\.go\.[a-z]{2}$/];

const matchesDomain = (host: string, domain: string) => {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
};

export function classifySource(
  url: string,
  fetch: { fetched: boolean; statusCode: number | null; injection: boolean },
  lists: { officialDomains?: string[]; aggregators?: string[] } = {},
): SourceAssessment {
  if (!fetch.fetched) return { cls: "unverified", basis: "not_fetched", confidence: "Certain" };
  if (fetch.statusCode !== null && (fetch.statusCode < 200 || fetch.statusCode >= 300)) return { cls: "unverified", basis: "http_error", confidence: "Certain" };
  if (fetch.injection) return { cls: "unverified", basis: "injection_signals", confidence: "Likely" };
  const host = hostOf(url);
  if ([...KNOWN_AGGREGATORS, ...(lists.aggregators ?? [])].some((d) => matchesDomain(host, d))) return { cls: "third_party", basis: "known_aggregator", confidence: "Certain" };
  if ((lists.officialDomains ?? []).some((d) => matchesDomain(host, d))) return { cls: "official", basis: "owner_allowlist", confidence: "Certain" };
  if (INSTITUTIONAL.some((r) => r.test(host))) return { cls: "official", basis: "institutional_domain", confidence: "Likely" };
  return { cls: "third_party", basis: "other_publisher", confidence: "Likely" };
}

/** Database source_type for each class (opportunity_sources check constraint). */
export function sourceTypeFor(cls: SourceClass): "official" | "aggregator" | "search_result" {
  return cls === "official" ? "official" : cls === "third_party" ? "aggregator" : "search_result";
}
