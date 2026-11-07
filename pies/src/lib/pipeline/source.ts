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
  basis: "owner_allowlist" | "institutional_domain" | "known_official" | "university_domain" | "known_aggregator" | "other_publisher" | "not_fetched" | "http_error" | "injection_signals";
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
  // Seen in the first live run (2026-11-07): all three results were list/aggregator sites.
  "qualifyafrica.com",
  "opportunitylab.net",
  "scholarshipportal.com",
  "scholarshipdb.net",
  "worldscholarshipforum.com",
  "scholarshipregion.com",
  "opportunitiescorners.com",
  "youthop.com",
  // Second live run (2026-11-07): republished a government programme.
  "mastere.tn",
];

/**
 * Official funders and universities on ordinary domains (.nl, .ca, .com ...), which the
 * institutional-TLD rule cannot see. Second live run: maastrichtuniversity.nl and utoronto.ca
 * were treated as third-party. Extend as new official publishers are confirmed.
 */
export const KNOWN_OFFICIAL = [
  "maastrichtuniversity.nl",
  "utoronto.ca",
  "mcgill.ca",
  "ubc.ca",
  "uregina.ca",
  "lakeheadu.ca",
  "educanada.ca",
  "canada.ca",
  "studyinhungary.hu",
  "daad.de",
  "studyinholland.nl",
  "nuffic.nl",
  "campusfrance.org",
  "vliruos.be",
  "ares-ac.be",
  "unipd.it",
  "mastercardfdn.org",
  "chevening.org",
  "berea.edu",
];

/** University-style hostnames, e.g. "uni-hamburg.de", "universiteitleiden.nl", "kcl-university.org". */
const UNIVERSITY_HOST = /(^|\.)(university|universiteit|universitat|universitaet|universita|universidad|universite|hochschule|politecnico|polytechnique)[a-z-]*\.|(^|\.)(uni|univ)-[a-z]/i;
/** Hostnames that look like a university but are aggregators ("universityscholarshipsnow.com"). */
const AGGREGATOR_HOST_WORDS = /scholar|opportunit|grant|bursar|fund|job|career|news|blog|portal|abroad|apply/i;

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
  if (KNOWN_OFFICIAL.some((d) => matchesDomain(host, d))) return { cls: "official", basis: "known_official", confidence: "Likely" };
  if (UNIVERSITY_HOST.test(host) && !AGGREGATOR_HOST_WORDS.test(host)) return { cls: "official", basis: "university_domain", confidence: "Likely" };
  return { cls: "third_party", basis: "other_publisher", confidence: "Likely" };
}

/** Database source_type for each class (opportunity_sources check constraint). */
export function sourceTypeFor(cls: SourceClass): "official" | "aggregator" | "search_result" {
  return cls === "official" ? "official" : cls === "third_party" ? "aggregator" : "search_result";
}

/**
 * A page that lists many opportunities (an aggregator round-up) is a LEAD, not an opportunity:
 * its single "deadline" belongs to one item on the list, and its publisher is not the funder.
 * First live run (2026-11-07): "Scholarships for Rwandans 2027: 451 open" was saved as one
 * opportunity with one item's closing date. Leads are reported, never saved or drafted to.
 */
export function isListingPage(title: string, text: string, sourceCls: SourceClass = "third_party"): boolean {
  if (/\b\d{2,}\s*\+?\s*(open|scholarships?|grants?|opportunities|programmes?|programs?|fellowships?|jobs|internships)\b/i.test(title)) return true;
  if (/\b(top|best)\s+\d+\b|\blist of\b|\b(currently|now)\s+open\b|\bopen\s+now\b|\bround-?up\b/i.test(title)) return true;
  // Body signal only for non-official pages: an official programme page often states many dates
  // (second live run: the University of Toronto Pearson page was wrongly treated as a list).
  if (sourceCls === "official") return false;
  return (text.match(/\b(deadline|closes|closing date|apply by)\b/gi) ?? []).length >= 6;
}

/**
 * "Page not found" pages often return HTTP 200 (second live run: msmt.gov.cz served
 * "Stránka nenalezena" and it was saved as an opportunity). Checked on the title and the
 * first lines of text, in the languages PIES searches.
 */
export function isErrorPage(title: string, text: string): boolean {
  const re = /\b(404|page not found|not found|page introuvable|seite nicht gefunden|pagina non trovata|página no encontrada|pagina niet gevonden|stránka nenalezena|strona nie znaleziona|access denied|forbidden)\b/i;
  return re.test(title) || re.test(text.slice(0, 300));
}
