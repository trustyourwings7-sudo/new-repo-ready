/**
 * Deterministic fact extraction from page text. Every fact carries the exact
 * sentence it came from. Nothing is inferred: absent facts stay null.
 */

export type Confidence = "Certain" | "Likely" | "Guessing";

export interface Evidenced<T> {
  value: T;
  quote: string;
  confidence: Confidence;
}

export interface PageFacts {
  deadline: Evidenced<string> | null; // ISO date (YYYY-MM-DD)
  maxAge: Evidenced<number> | null;
  applicationFee: Evidenced<"required" | "none" | "waivable"> | null;
  degreeRequired: Evidenced<"bachelor" | "master" | "doctorate"> | null;
  nationality: Evidenced<"open_international" | "restricted"> | null;
  /** Countries named in a nationality restriction sentence. */
  restrictedTo: string[];
  fullyFunded: Evidenced<boolean> | null;
  amount: Evidenced<{ value: number; currency: string }> | null;
  applicationLink: boolean;
  injectionSignals: string[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function sentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    // Do not split after an abbreviated month ("15 Nov. 2026").
    .split(/(?<!\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.)(?<=[.!?])\s+|\n+/i)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 3 && s.length < 600);
}

function monthIndex(m: string): number {
  return MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Unambiguous date formats only. "03/04/2026" is skipped (day/month order unknown). */
export function parseDates(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\.?,?\\s+(20\\d{2})\\b`, "gi"))) {
    const v = iso(Number(m[3]), monthIndex(m[2]!), Number(m[1]));
    if (v) out.push(v);
  }
  for (const m of s.matchAll(new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "gi"))) {
    const v = iso(Number(m[3]), monthIndex(m[1]!), Number(m[2]));
    if (v) out.push(v);
  }
  for (const m of s.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const v = iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (v) out.push(v);
  }
  // Dotted day.month.year (European official sites: "15.01.2027"). Slashes stay ambiguous.
  for (const m of s.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g)) {
    const v = iso(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (v) out.push(v);
  }
  return out;
}

/**
 * Dates written without a year ("15 January", "January 15th"). The year is inferred as the next
 * occurrence on or after today, so callers must mark these as a guess, never as verified.
 */
export function parseYearlessDates(s: string, today: string): string[] {
  const out: string[] = [];
  const y0 = Number(today.slice(0, 4));
  const add = (mon: string, day: string) => {
    for (const y of [y0, y0 + 1]) {
      const v = iso(y, monthIndex(mon), Number(day));
      if (v && v >= today) return void out.push(v);
    }
  };
  // Skip dates that already carry a year (handled by parseDates).
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b\\.?(?![.,]?\\s+20\\d{2})`, "gi"))) add(m[2]!, m[1]!);
  for (const m of s.matchAll(new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?![.,]?\\s+20\\d{2})(?!\\d)`, "gi"))) add(m[1]!, m[2]!);
  return out;
}

const DEADLINE_WORDS =
  /\b(deadlines?|closing date|closes?|closed on|apply by|apply before|applications? (?:close|due|must be (?:received|submitted))|submission (?:date|deadline)|due (?:date|by)|no later than|not later than|last (?:day|date)|until|nominations? (?:due|close|deadline)|submit(?:ted)? (?:by|before)|accepted (?:until|through)|application period|call (?:closes|open until))\b/i;

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /\b(system|developer) prompt\b/i,
  /you are (now )?(an? )?(ai|assistant|chatgpt|claude)\b/i,
  /\b(send|forward|email) (this|the following|your) .{0,40}\bto\b/i,
  /<\/?(system|assistant|untrusted_content)[^>]*>/i,
  /\bdisregard (the|your) (rules|instructions)\b/i,
];

export function injectionSignals(text: string): string[] {
  return INJECTION.filter((r) => r.test(text)).map((r) => r.source.slice(0, 60));
}

export function extractFacts(text: string, today: string): PageFacts {
  const ss = sentences(text);
  const facts: PageFacts = {
    deadline: null,
    maxAge: null,
    applicationFee: null,
    degreeRequired: null,
    nationality: null,
    restrictedTo: [],
    fullyFunded: null,
    amount: null,
    applicationLink: /\b(apply (now|online|here)|application (form|portal))\b/i.test(text),
    injectionSignals: injectionSignals(text),
  };

  // Deadline: the earliest not-past date in a sentence that names a deadline. A label with no
  // date ("Application deadline" in a table) is read together with the next line. Dates with a
  // year are "Likely"; a year we had to infer is "Guessing" and is never counted as verified.
  let best: { date: string; quote: string; guessed: boolean } | null = null;
  const consider = (d: string, quote: string, guessed: boolean) => {
    if (d < today) return;
    if (!best || (best.guessed && !guessed) || (best.guessed === guessed && d < best.date)) best = { date: d, quote, guessed };
  };
  ss.forEach((s, i) => {
    if (!DEADLINE_WORDS.test(s)) return;
    let text = s;
    if (!parseDates(s).length && !parseYearlessDates(s, today).length && s.length < 80 && ss[i + 1]) text = `${s} ${ss[i + 1]}`;
    for (const d of parseDates(text)) consider(d, text, false);
    for (const d of parseYearlessDates(text, today)) consider(d, text, true);
  });
  const found = best as { date: string; quote: string; guessed: boolean } | null;
  if (found) facts.deadline = { value: found.date, quote: found.quote, confidence: found.guessed ? "Guessing" : "Likely" };

  for (const s of ss) {
    const age =
      s.match(/\b(?:under|below|younger than|not (?:older|more) than|no older than|maximum age(?: of)?|up to(?: the age of)?)\s+(?:the age of\s+)?(\d{2})\b/i) ??
      s.match(/\baged?\s+(?:between\s+)?\d{2}\s*(?:-|–|to|and)\s*(\d{2})\b/i) ??
      s.match(/\b(\d{2})\s+years?\s+(?:old\s+)?or\s+(?:younger|less|under)\b/i);
    if (age && !facts.maxAge && /\bage|aged|years?\b/i.test(s)) {
      // "under 35" means max 34; "not older than 35", "aged 18-35", "35 or younger" mean max 35.
      const n = Number(age[1]);
      const exclusive = /\b(under|below|younger than)\b/i.test(age[0]);
      facts.maxAge = { value: exclusive ? n - 1 : n, quote: s, confidence: "Likely" };
    }
    if (!facts.applicationFee && /\bapplication fee\b/i.test(s)) {
      const v = /\b(no|free of|without( an)?|zero)\b.{0,20}application fee|application fee\b.{0,20}\b(waived|none|free|not required)/i.test(s)
        ? "none"
        : /\bwaiv(er|able|ed)\b/i.test(s)
          ? "waivable"
          : "required";
      facts.applicationFee = { value: v, quote: s, confidence: "Likely" };
    }
    if (!facts.degreeRequired && /\b(must|required|requirement|need|hold|holders? of|completed)\b/i.test(s)) {
      const d = /\b(ph\.?d|doctora(l|te))\b/i.test(s) ? "doctorate" : /\bmaster'?s\b/i.test(s) ? "master" : /\bbachelor'?s|undergraduate degree\b/i.test(s) ? "bachelor" : null;
      if (d && /\bdegree|holders?|graduate\b/i.test(s)) facts.degreeRequired = { value: d, quote: s, confidence: "Likely" };
    }
    if (!facts.nationality) {
      if (/\b(open to|available to|welcome)\b.{0,30}\b(all|international|any) (nationalit|countr|students|applicants)/i.test(s)) {
        facts.nationality = { value: "open_international", quote: s, confidence: "Likely" };
      } else if (/\b(only|exclusively|must be)\b.{0,40}\b(citizens?|nationals?|residents?)\b/i.test(s)) {
        facts.nationality = { value: "restricted", quote: s, confidence: "Likely" };
        facts.restrictedTo = [...s.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/g)].map((m) => m[1]!).filter((w) => !/^(Only|Applicants|Citizens|Nationals|Residents|Must|The|This|Open|Exclusively)$/.test(w));
      }
    }
    if (!facts.fullyFunded && /\b(fully[- ]funded|full (tuition|scholarship)|covers? (all|full) (tuition|costs))\b/i.test(s)) {
      facts.fullyFunded = { value: true, quote: s, confidence: "Likely" };
    }
    if (!facts.amount) {
      const m = s.match(/(?:(USD|EUR|GBP|CAD|RWF)\s?|([$€£]))\s?(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?/);
      if (m && /\b(award|stipend|grant|salary|funding|scholarship|prize|worth|up to)\b/i.test(s)) {
        const cur = m[1] ?? ({ $: "USD", "€": "EUR", "£": "GBP" } as Record<string, string>)[m[2]!] ?? "USD";
        facts.amount = { value: { value: Number(m[3]!.replace(/[,\s]/g, "")), currency: cur }, quote: s, confidence: m[1] ? "Likely" : "Guessing" };
      }
    }
  }
  return facts;
}

export type VerificationStatus = "verified" | "partially_verified" | "unverified";

/**
 * verified            OFFICIAL source (see source.ts) and a dated deadline (with its year) is quoted from it.
 * partially_verified  official source, but no deadline found on it.
 * unverified          third-party, not fetched, non-2xx, or instruction-like text on the page.
 * A fetched page is evidence that the page exists, not that its claims are authoritative.
 */
export function verificationStatus(source: { cls: "official" | "third_party" | "unverified" }, facts: PageFacts): VerificationStatus {
  if (source.cls !== "official" || facts.injectionSignals.length) return "unverified";
  // A deadline whose year was inferred is a lead to check, not a verified fact.
  return facts.deadline && facts.deadline.confidence !== "Guessing" ? "verified" : "partially_verified";
}
