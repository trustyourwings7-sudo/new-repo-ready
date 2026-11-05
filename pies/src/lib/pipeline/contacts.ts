import { siteOf } from "../research/url.ts";

/**
 * Contacts are taken ONLY as they appear verbatim on the fetched page. Never
 * constructed, never pattern-guessed. An address on a different domain than
 * the page (a common injection or scraping artefact) is kept for review but
 * never used in a draft.
 */
export interface PublicContact {
  kind: "email" | "phone";
  value: string;
  role: "role_based" | "personal" | "unknown";
  sameDomain: boolean;
  sourceUrl: string;
  quote: string;
}

const ROLE = /^(admissions?|info|contact|scholarships?|enquir(y|ies)|apply|applications?|office|international|hr|careers|jobs|recruit(ment|ing)?|partnerships?|grants?|support|hello|study)\b/i;

export function extractContacts(text: string, sourceUrl: string): PublicContact[] {
  const site = siteOf(sourceUrl);
  const out = new Map<string, PublicContact>();
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}/g)) {
    const value = m[0].toLowerCase().replace(/\.$/, "");
    if (/\.(png|jpe?g|gif|svg|webp)$/.test(value) || out.has(value)) continue;
    const local = value.split("@")[0]!;
    const domain = value.split("@")[1]!;
    const start = Math.max(0, (m.index ?? 0) - 80);
    out.set(value, {
      kind: "email",
      value,
      role: ROLE.test(local) ? "role_based" : /^[a-z]+([._-][a-z]+)?$/.test(local) ? "personal" : "unknown",
      sameDomain: domain === site || domain.endsWith(`.${site}`),
      sourceUrl,
      quote: text.slice(start, (m.index ?? 0) + m[0].length + 40).replace(/\s+/g, " ").trim(),
    });
  }
  for (const m of text.matchAll(/(?:\+|00)\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}/g)) {
    const value = m[0].replace(/[^\d+]/g, "");
    if (value.length < 9 || value.length > 16 || out.has(value)) continue;
    out.set(value, { kind: "phone", value, role: "unknown", sameDomain: true, sourceUrl, quote: m[0] });
  }
  return [...out.values()];
}

/** The one contact a draft may address: same-domain, role-based email first. */
export function draftableContact(contacts: PublicContact[]): PublicContact | null {
  const emails = contacts.filter((c) => c.kind === "email" && c.sameDomain);
  return emails.find((c) => c.role === "role_based") ?? emails[0] ?? null;
}
