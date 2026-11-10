/**
 * Deterministic command understanding for the PIES command chat. No AI model and no network:
 * plain-language phrases map to a fixed set of safe intents. Anything not understood gets help.
 */

export const RESEARCH_CATEGORIES = ["scholarship", "grant", "funding", "education", "employment", "accelerator", "partnership", "consulting", "commercial", "other"] as const;
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

export type Intent =
  | { kind: "help" }
  | { kind: "deadlines" }
  | { kind: "tasks" }
  | { kind: "budget" }
  | { kind: "health" }
  | { kind: "diagnose" }
  | { kind: "status" }
  | { kind: "opportunities"; search: string | null }
  /** Live research. `query` null = the configured daily queries. Always needs a confirm click. */
  | { kind: "research"; query: string | null; category: ResearchCategory }
  | { kind: "contacts"; search: string | null };

const CATEGORY_WORDS: [RegExp, ResearchCategory][] = [
  [/\bscholarships?\b|\bbursar(y|ies)\b|\bfellowships?\b/i, "scholarship"],
  [/\bgrants?\b/i, "grant"],
  [/\bsponsorships?\b|\bfunding\b|\bfunds?\b/i, "funding"],
  [/\bjobs?\b|\bemployment\b|\binternships?\b|\bvacanc(y|ies)\b|\broles?\b/i, "employment"],
  [/\baccelerators?\b|\bincubators?\b/i, "accelerator"],
  [/\bpartners?(hips?)?\b/i, "partnership"],
  [/\bconsult(ing|ancy)\b/i, "consulting"],
  [/\b(master'?s|bachelor'?s|degree|admission|programmes?|programs?|courses?|universit(y|ies))\b/i, "education"],
];

export function categoryOf(text: string): ResearchCategory {
  for (const [re, c] of CATEGORY_WORDS) if (re.test(text)) return c;
  return "scholarship";
}

/** The runner accepts 3-120 letters, digits, spaces and basic punctuation. Mirror it exactly. */
export const SAFE_QUERY = /^[\p{L}\p{N} ,.'&()/-]{3,120}$/u;

export function cleanQuery(raw: string): string | null {
  const q = raw
    .replace(/[^\p{L}\p{N} ,.'&()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return SAFE_QUERY.test(q) ? q : null;
}

const STOP = /^(me|my|for me|some|any|new|all|the|a|an|please)\s+/i;

function stripLead(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 4; i++) out = out.replace(STOP, "");
  return out.replace(/[?.!]+$/, "").trim();
}

export function parseIntent(input: string): Intent {
  const t = input.trim().replace(/\s+/g, " ");
  const l = t.toLowerCase();
  if (!l || /^(help|\?|what can you do|commands|menu|hi|hello|hey)\b/.test(l)) return { kind: "help" };

  if (/\b(diagnos\w*|why\b.*\b(fail\w*|empty|nothing|no results|didn'?t|did not)|what went wrong|explain\b.*\b(fail\w*|research|run))/.test(l)) return { kind: "diagnose" };
  if (/\b(health|is pies (ok|working)|check pies|system check|self[- ]?test)\b/.test(l)) return { kind: "health" };
  if (/\b(run|research|search)\b.*\bstatus\b|\bstatus of\b.*\b(run|research)\b|^status$|\bis (the )?research (running|done|finished)\b/.test(l)) return { kind: "status" };
  if (/\b(budget|spend|spent|spending|cost|costs|money|usage|credits?)\b/.test(l)) return { kind: "budget" };
  if (/\b(deadlines?|due dates?|what'?s due|closing soon)\b/.test(l)) return { kind: "deadlines" };
  if (/\b(tasks?|to-?dos?|follow[- ]?ups?)\b/.test(l)) return { kind: "tasks" };

  const contacts = t.match(/^(?:show|list|find|search)?\s*(?:my\s+)?(?:contacts?|organi[sz]ations?|people)\b(?:\s+(?:at|for|in|named|matching|from)\s+(.+))?$/i);
  if (contacts) return { kind: "contacts", search: contacts[1] ? stripLead(contacts[1]) || null : null };

  // "research now" / "run research" with nothing else = the configured daily queries.
  if (/^(research now|run research( now)?|start research|research|run (the )?daily research)\b[\s.!]*$/.test(l)) {
    return { kind: "research", query: null, category: "scholarship" };
  }

  // "find / search / look for / research X" = live research for X (confirmed by a click).
  const find = t.match(/^(?:please\s+)?(?:find|search(?:\s+for)?|look\s+for|research|discover|get)\s+(.+)$/i);
  if (find) {
    const subject = stripLead(find[1]!);
    if (/^(my )?(opportunit(y|ies)|saved|stored|results)$/i.test(subject)) return { kind: "opportunities", search: null };
    const query = cleanQuery(subject);
    if (query) return { kind: "research", query, category: categoryOf(query) };
  }

  const show = t.match(/^(?:show|list|view|open|see)\s+(?:me\s+)?(?:my\s+|all\s+|the\s+)?(?:opportunit(?:y|ies)|scholarships?|grants?|results|research results|finds)\b(?:\s+(?:about|for|in|matching|with)\s+(.+))?/i);
  if (show) return { kind: "opportunities", search: show[1] ? stripLead(show[1]) || null : null };
  if (/\bopportunit(y|ies)\b|\bresults\b/.test(l)) return { kind: "opportunities", search: null };

  return { kind: "help" };
}

/**
 * Several commands in one message ("check health and show my deadlines"). A research request keeps
 * the whole text (its subject may contain "and"). Returns 1-3 distinct intents, in order.
 */
export function parseIntents(input: string): Intent[] {
  const whole = parseIntent(input);
  if (whole.kind === "research") return [whole];
  const parts = input.split(/\s*(?:;|\n|,\s*(?:and\s+)?|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b)\s*/i).map((p) => p.trim()).filter((p) => p.length > 1);
  if (parts.length < 2) return [whole];
  const out: Intent[] = [];
  for (const p of parts) {
    const i = parseIntent(p);
    if (i.kind === "help") continue;
    if (!out.some((o) => JSON.stringify(o) === JSON.stringify(i))) out.push(i);
  }
  return out.length >= 2 ? out.slice(0, 3) : [whole];
}
