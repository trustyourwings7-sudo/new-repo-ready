import "server-only";
import { redirect } from "next/navigation";
import { isEmailAllowed } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export type SessionState =
  | { kind: "unconfigured" }
  | { kind: "signed_out" }
  | { kind: "forbidden"; email: string | null }
  | { kind: "signed_in"; userId: string; email: string; supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>> };

/** Server-side session check. Uses getUser() (verified with Supabase), not the unverified cookie payload. */
export async function getSession(): Promise<SessionState> {
  const supabase = await supabaseServer();
  if (!supabase) return { kind: "unconfigured" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "signed_out" };
  const email = data.user.email ?? null;
  if (!isEmailAllowed(email)) return { kind: "forbidden", email };
  return { kind: "signed_in", userId: data.user.id, email: email as string, supabase };
}

/** For pages that need data: redirects when signed out; returns state otherwise. */
export async function requireSessionOrSetup(): Promise<Exclude<SessionState, { kind: "signed_out" }>> {
  const s = await getSession();
  if (s.kind === "signed_out") redirect("/login");
  return s;
}
