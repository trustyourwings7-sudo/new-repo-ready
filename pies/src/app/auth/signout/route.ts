import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", env().PIES_SITE_URL), { status: 303 });
}
