import { NextResponse, type NextRequest } from "next/server";
import { automationExecutor } from "@/lib/automation/db";
import { handleAutomationRequest } from "@/lib/automation/handler";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const e = env();
  const rawBody = await request.text();
  const result = await handleAutomationRequest(
    {
      headers: {
        integration: request.headers.get("x-pies-integration"),
        timestamp: request.headers.get("x-pies-timestamp"),
        signature: request.headers.get("x-pies-signature"),
      },
      rawBody,
      contentType: request.headers.get("content-type"),
    },
    { secret: e.PIES_AUTOMATION_SECRET, integrationId: e.PIES_AUTOMATION_INTEGRATION_ID },
    automationExecutor(),
  );
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
