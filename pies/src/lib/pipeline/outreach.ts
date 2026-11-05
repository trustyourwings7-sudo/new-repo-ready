import type { PublicContact } from "./contacts.ts";
import type { VerifiedProfile } from "./qualify.ts";

/**
 * Deterministic draft (no model call, $0). Uses only verified profile facts and
 * fields extracted with evidence. Page text never flows into the body except a
 * sanitized title. The result is text for owner review: PIES has no send path.
 */
export interface Draft {
  to: string | null;
  subject: string;
  body: string;
  basedOn: string[];
}

export function safeTitle(title: string, suspicious: boolean): string {
  if (suspicious) return "(title withheld: page contained instruction-like text)";
  return title
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[<>{}\[\]`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "(untitled)";
}

export function buildDraft(input: {
  title: string;
  suspicious: boolean;
  organization: string;
  deadline: string | null;
  contact: PublicContact | null;
  profile: VerifiedProfile;
}): Draft {
  const t = safeTitle(input.title, input.suspicious);
  const proof = input.profile.proofPoints.slice(0, 2);
  const lines = [
    `Dear ${input.organization} team,`,
    "",
    `I am ${input.profile.name}, from ${input.profile.nationality}, and I am interested in "${t}".`,
    ...(proof.length ? ["", ...proof.map((p) => `- ${p}`)] : []),
    "",
    input.deadline
      ? `I would like to submit a complete application before the ${input.deadline} deadline.`
      : "I could not find the application deadline on your page.",
    "",
    "Could you confirm whether applicants from my country are eligible, and whether any application fee applies?",
    "",
    "Kind regards,",
    input.profile.name,
  ];
  return {
    to: input.contact?.value ?? null,
    subject: `Question about ${t}`.slice(0, 150),
    body: lines.join("\n").slice(0, 3500),
    basedOn: ["profile.proofPoints", "page.title", ...(input.deadline ? ["page.deadline"] : []), ...(input.contact ? ["page.contact"] : [])],
  };
}
