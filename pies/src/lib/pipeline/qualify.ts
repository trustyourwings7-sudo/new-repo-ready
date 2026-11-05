import type { PageFacts } from "./verify.ts";

/**
 * Rubric v1 (pies/.claude/skills/opportunity-qualification) as deterministic code.
 * Mandatory gates override any score. Automation never concludes "eligible":
 * the best it can say is "partially_eligible"; the owner confirms.
 */

export interface VerifiedProfile {
  /** ISO 3166 country name as it appears on official pages, e.g. "Rwanda". */
  nationality: string;
  age: number;
  /** Highest COMPLETED level. */
  education: "secondary" | "bachelor" | "master" | "doctorate";
  experienceKeywords: string[];
  /** Reject opportunities that charge an application fee (owner rule). */
  rejectApplicationFees: boolean;
  /** Short verified proof points used in drafts. */
  proofPoints: string[];
  name: string;
}

export type EligibilityStatus = "ineligible" | "needs_review" | "partially_eligible";

export interface Qualification {
  rubric: "v1";
  total: number;
  parts: { eligibility: number; experience: number; value: number; strategic: number; access: number; timing: number };
  eligibility: EligibilityStatus;
  gateFailures: string[];
  missing: string[];
  daysToDeadline: number | null;
}

const LEVEL = { secondary: 0, bachelor: 1, master: 2, doctorate: 3 } as const;

export function qualify(
  facts: PageFacts,
  text: string,
  profile: VerifiedProfile,
  opts: { today: string; strategicFit: "primary" | "secondary"; hasPublicContact: boolean },
): Qualification {
  const gates: string[] = [];
  const missing: string[] = [];

  if (facts.maxAge && profile.age > facts.maxAge.value) gates.push(`age limit ${facts.maxAge.value}: "${facts.maxAge.quote}"`);
  if (facts.degreeRequired && LEVEL[facts.degreeRequired.value] > LEVEL[profile.education]) {
    gates.push(`requires a completed ${facts.degreeRequired.value} degree: "${facts.degreeRequired.quote}"`);
  }
  if (facts.nationality?.value === "restricted" && !facts.restrictedTo.some((c) => c.toLowerCase() === profile.nationality.toLowerCase())) {
    gates.push(`nationality restricted: "${facts.nationality.quote}"`);
  }
  if (profile.rejectApplicationFees && facts.applicationFee?.value === "required") gates.push(`application fee: "${facts.applicationFee.quote}"`);

  let days: number | null = null;
  if (facts.deadline) {
    days = Math.round((Date.parse(`${facts.deadline.value}T00:00:00Z`) - Date.parse(`${opts.today}T00:00:00Z`)) / 86_400_000);
    if (days < 0) gates.push(`deadline passed (${facts.deadline.value})`);
  } else missing.push("deadline");
  if (!facts.maxAge) missing.push("age limit (none found)");
  if (!facts.nationality) missing.push("nationality eligibility");
  if (!facts.applicationFee) missing.push("application fee");

  const eligibility = gates.length ? 0 : missing.length <= 1 ? 22 : missing.length <= 2 ? 17 : 12;
  const lower = text.toLowerCase();
  const kw = profile.experienceKeywords.filter((k) => k && lower.includes(k.toLowerCase()));
  const experience = profile.experienceKeywords.length ? Math.round((20 * Math.min(kw.length, 4)) / Math.min(profile.experienceKeywords.length, 4)) : 0;
  const value = facts.fullyFunded ? 18 : facts.amount ? 12 : 5; // "not stated" scores at most 5
  const strategic = opts.strategicFit === "primary" ? 15 : 8;
  const access = opts.hasPublicContact || facts.applicationLink ? 10 : 3;
  const timing = days === null ? 3 : days < 0 ? 0 : days < 7 ? 4 : days <= 90 ? 10 : 7;
  const parts = { eligibility, experience, value, strategic, access, timing };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);

  return {
    rubric: "v1",
    total: gates.length ? Math.min(total, 25) : total,
    parts,
    eligibility: gates.length ? "ineligible" : missing.length ? "needs_review" : "partially_eligible",
    gateFailures: gates,
    missing,
    daysToDeadline: days,
  };
}

export interface Ranked<T> {
  item: T;
  q: Qualification;
}

/** Ineligible items are dropped. Higher score first; ties go to the nearer deadline. */
export function prioritize<T>(rows: Ranked<T>[]): Ranked<T>[] {
  return rows
    .filter((r) => r.q.eligibility !== "ineligible")
    .sort((a, b) => b.q.total - a.q.total || (a.q.daysToDeadline ?? 9999) - (b.q.daysToDeadline ?? 9999));
}
