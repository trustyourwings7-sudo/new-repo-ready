import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  // Reject cross-site sign-out requests (CSRF).
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env().PIES_SITE_URL).origin) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 });
  }
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", env().PIES_SITE_URL), { status: 303 });
}
