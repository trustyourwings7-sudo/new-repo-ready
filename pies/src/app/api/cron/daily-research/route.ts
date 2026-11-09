import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchResearch, findAppRun } from "@/lib/assistant/github";

export const dynamic = "force-dynamic";

/**
 * Daily research trigger called by Vercel Cron (GitHub's own schedule is unreliable). Vercel sends
 * "Authorization: Bearer <CRON_SECRET>". The run uses request id "sched-YYYYMMDD", which the runner
 * maps to the scheduled slot's budget key: research happens at most once a day whichever fires first.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (secret.length < 32 || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const requestId = `sched-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  try {
    if (await findAppRun(requestId)) return NextResponse.json({ ok: true, status: "already_dispatched", requestId });
    await dispatchResearch({ requestId, query: null, category: "scholarship" });
    return NextResponse.json({ ok: true, status: "dispatched", requestId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 40) : "unknown" }, { status: 502 });
  }
}
