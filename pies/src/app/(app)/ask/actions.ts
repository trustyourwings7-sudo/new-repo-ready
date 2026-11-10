"use server";

import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { answer, researchPreflight, type Reply } from "@/lib/assistant/answer";
import { dispatchResearch } from "@/lib/assistant/github";
import { cleanQuery, parseIntents, RESEARCH_CATEGORIES } from "@/lib/assistant/intent";
import { log } from "@/lib/logger";

export async function ask(text: string): Promise<Reply> {
  const session = await getSession();
  if (session.kind !== "signed_in") return { text: "Please sign in again.", tone: "bad" };
  const input = String(text ?? "").slice(0, 300);
  const intents = parseIntents(input);
  if (intents.length === 1) return answer(session.supabase, intents[0]!);
  const sections = await Promise.all(intents.map((i) => answer(session.supabase, i)));
  const tone = sections.some((r) => r.tone === "bad") ? "bad" : sections.some((r) => r.tone === "warn") ? "warn" : "info";
  return { text: `${sections.length} answers:`, tone, sections };
}

/** Starts live research. Only from the confirm button; every limit is re-checked here. */
export async function startResearch(query: string | null, category: string): Promise<Reply> {
  const session = await getSession();
  if (session.kind !== "signed_in") return { text: "Please sign in again.", tone: "bad" };
  const q = query === null ? null : cleanQuery(query);
  if (query !== null && !q) return { text: "That search contains characters research cannot use. Use letters, numbers and spaces.", tone: "warn" };
  const cat = (RESEARCH_CATEGORIES as readonly string[]).includes(category) ? category : "scholarship";
  const pre = await researchPreflight(session.supabase);
  if (!pre.ok) return { text: pre.reason, tone: "warn" };
  const requestId = `r${randomBytes(8).toString("hex")}`;
  try {
    await dispatchResearch({ requestId, query: q, category: cat });
  } catch (e) {
    log.warn("research dispatch failed", { code: e instanceof Error ? e.message.slice(0, 40) : "unknown" });
    return { text: "GitHub refused to start the run. Nothing was spent. Try again in a minute; if it repeats, ask \"Check PIES health\".", tone: "bad" };
  }
  return {
    text: q ? `Started research for "${q}". Live progress below (usually 1-3 minutes).` : "Started today's research. Live progress below (usually 1-3 minutes).",
    tone: "info",
    track: { requestId },
  };
}
