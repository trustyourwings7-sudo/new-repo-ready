"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env, isEmailAllowed } from "@/lib/env";
import { log } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase/server";

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export async function requestMagicLink(formData: FormData) {
  const parsed = emailSchema.safeParse(formData.get("email"));
  // Same response whether or not the address is allowed, to avoid account enumeration.
  const done = () => redirect("/login?sent=1");
  if (!parsed.success) redirect("/login?error=invalid");

  const supabase = await supabaseServer();
  if (!supabase) redirect("/login?error=unconfigured");

  if (!isEmailAllowed(parsed.data)) {
    log.warn("login refused: email not on allowlist");
    done();
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      // Never create accounts from the login form. The owner account is created in Supabase.
      shouldCreateUser: false,
      emailRedirectTo: `${env().PIES_SITE_URL}/auth/callback`,
    },
  });
  if (error) log.warn("magic link request failed", { code: error.code ?? "unknown" });
  done();
}
