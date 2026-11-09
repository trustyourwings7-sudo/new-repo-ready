import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public liveness + latency probe. Returns no data: only whether Supabase answers and how long
 * one round trip from this server region takes. Used to measure the region bottleneck.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const region = process.env.VERCEL_REGION ?? "local";
  if (!url || !key) return NextResponse.json({ ok: false, region, reason: "not_configured" }, { status: 503 });
  const samples: number[] = [];
  let ok = true;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    try {
      const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store" });
      ok = ok && r.ok;
    } catch {
      ok = false;
    }
    samples.push(Math.round(performance.now() - t));
  }
  return NextResponse.json(
    { ok, region, supabaseRoundTripMs: samples },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
