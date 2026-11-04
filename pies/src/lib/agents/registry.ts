/** The seven PIES agents. IDs must match public.pies_is_valid_agent(). */
export const AGENT_IDS = [
  "discovery",
  "qualification",
  "contact_research",
  "outreach",
  "career_strategist",
  "revenue_intelligence",
  "executive_coordinator",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentDefinition {
  id: AgentId;
  number: string;
  name: string;
  purpose: string;
  phase: 2 | 3 | 4 | 5;
}

export const AGENTS: readonly AgentDefinition[] = [
  { id: "discovery", number: "01", name: "Discovery Agent", purpose: "Finds public opportunities from traceable sources and deduplicates them.", phase: 2 },
  { id: "qualification", number: "02", name: "Opportunity Qualification Agent", purpose: "Scores opportunities with deterministic rules; eligibility failures override scores.", phase: 2 },
  { id: "contact_research", number: "03", name: "Contact Research Agent", purpose: "Finds publicly listed decision-makers and business channels with source URLs. Never guesses emails.", phase: 3 },
  { id: "outreach", number: "04", name: "Outreach Agent", purpose: "Writes personalized drafts and Gmail drafts. Never sends without a single-use approval.", phase: 3 },
  { id: "career_strategist", number: "05", name: "Career Strategist", purpose: "Matches roles to the verified profile, tracks applications and skills gaps.", phase: 5 },
  { id: "revenue_intelligence", number: "06", name: "Revenue Intelligence Agent", purpose: "Finds and qualifies paying clients; deal values carry labelled assumptions.", phase: 4 },
  { id: "executive_coordinator", number: "07", name: "Executive Coordinator", purpose: "Daily briefing, deadlines, failures. Cannot override security or budget policy.", phase: 5 },
];

export function isAgentId(v: string): v is AgentId {
  return (AGENT_IDS as readonly string[]).includes(v);
}
