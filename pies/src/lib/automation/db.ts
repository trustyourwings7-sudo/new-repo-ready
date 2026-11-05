import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";
import type { AutomationExecutor } from "./handler";

/**
 * Database connection as the restricted `pies_automation` login role.
 * That role can execute four functions and nothing else (no table access),
 * so even a bug in this file cannot read or write tables directly.
 * The Supabase service-role key is not used anywhere in PIES.
 */
let sql: ReturnType<typeof postgres> | null = null;

function client() {
  const url = env().PIES_AUTOMATION_DATABASE_URL;
  if (!url) return null;
  sql ??= postgres(url, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // required for Supabase's transaction-mode pooler
    connection: { application_name: "pies-automation-api", statement_timeout: 15000 },
  });
  return sql;
}

export function automationExecutor(): AutomationExecutor | null {
  const db = client();
  if (!db) return null;
  return async (integrationId, requestId, agent, operation, payload) => {
    const rows = await db<{ result: Record<string, unknown> }[]>`
      select public.automation_execute(${integrationId}::uuid, ${requestId}, ${agent}, ${operation}, ${db.json(payload as never)}::jsonb) as result`;
    const result = rows[0]?.result;
    if (!result || typeof result !== "object") throw new Error("empty automation result");
    return result;
  };
}
