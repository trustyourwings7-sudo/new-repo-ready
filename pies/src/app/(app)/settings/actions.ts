"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { log } from "@/lib/logger";

/** Loads the initialization profile context. Idempotent; runs as the signed-in user. */
export async function initializeProfile() {
  const session = await getSession();
  if (session.kind !== "signed_in") redirect("/login");
  const { error: profileError } = await session.supabase.rpc("initialize_profile", {});
  const { error: projectsError } = profileError ? { error: null } : await session.supabase.rpc("initialize_projects", {});
  const error = profileError ?? projectsError;
  if (error) {
    log.error("initialize_profile failed", { code: error.code });
    redirect("/settings?profile=error");
  }
  redirect("/settings?profile=ok");
}
