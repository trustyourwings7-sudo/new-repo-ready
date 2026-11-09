import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { findAppRun, getRunMetrics, getSteps } from "@/lib/assistant/github";
import { explainStop } from "@/lib/assistant/explain";

export const dynamic = "force-dynamic";

/** Owner-only live status of an app-started research run. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session.kind !== "signed_in") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^r[0-9a-f]{16}$/.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  let run;
  try {
    run = await findAppRun(id);
  } catch {
    return NextResponse.json({ phase: "unknown", message: "GitHub did not answer; retrying." }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!run) return NextResponse.json({ phase: "queued", message: "Waiting for GitHub to start the run…" }, { headers: { "Cache-Control": "no-store" } });

  const steps = await getSteps(run.id).catch(() => []);
  if (run.status !== "completed") {
    const current = steps.find((s) => s.status === "in_progress")?.name ?? (run.status === "queued" ? "Queued on GitHub" : "Starting");
    return NextResponse.json({ phase: "running", message: `Running: ${current}`, steps, url: run.url }, { headers: { "Cache-Control": "no-store" } });
  }

  const m = await getRunMetrics(run.id).catch(() => null);
  const metrics = (m?.metrics ?? null) as Record<string, number> | null;
  const outcome = typeof m?.outcome === "string" ? m.outcome : null;
  const stop = typeof m?.stoppedEarly === "string" ? m.stoppedEarly : typeof m?.error === "string" ? m.error : null;
  const explained = stop ? explainStop(stop) : null;
  const { data: found } = await session.supabase
    .from("opportunities")
    .select("title,source_url,deadline,last_verified_at")
    .gte("created_at", run.createdAt)
    .order("created_at", { ascending: false })
    .limit(10);
  return NextResponse.json(
    {
      phase: "done",
      conclusion: run.conclusion,
      outcome,
      metrics,
      explanation: explained ? `${explained.cause} ${explained.fix === "Nothing to fix." ? "" : `Fix: ${explained.fix}`}`.trim() : null,
      found: found ?? [],
      url: run.url,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
