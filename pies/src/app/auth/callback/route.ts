import { NextResponse, type NextRequest } from "next/server";
import { env, isEmailAllowed } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const base = env().PIES_SITE_URL;
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await supabaseServer();
  if (!supabase || !code) return NextResponse.redirect(new URL("/login?error=callback", base));

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/login?error=callback", base));

  if (!isEmailAllowed(data.user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=forbidden", base));
  }
  // Fixed destination: never redirect to a URL taken from the query string.
  return NextResponse.redirect(new URL("/", base));
}
