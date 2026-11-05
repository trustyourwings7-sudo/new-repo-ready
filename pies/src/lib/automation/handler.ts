import { log } from "@/lib/logger";
import { automationEnvelopeSchema, isAutomationOperation, MAX_AUTOMATION_BODY_BYTES } from "./operations";
import { verifySignature } from "./signature";

export interface AutomationConfig {
  /** Shared HMAC secret (>= 32 chars). Held by the app and by n8n only. */
  secret: string | null;
  /** The single integration this deployment accepts. */
  integrationId: string | null;
}

/** Executes one validated request in the database as the pies_automation role. */
export type AutomationExecutor = (
  integrationId: string,
  requestId: string,
  agent: string,
  operation: string,
  payload: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure request handler (no framework objects) so every rejection path is unit-testable.
 * Order: config -> size -> signature -> integration -> envelope -> operation -> database.
 * The database repeats every authorization, limit and validation check.
 */
export async function handleAutomationRequest(
  input: { headers: { integration: string | null; timestamp: string | null; signature: string | null }; rawBody: string; contentType: string | null },
  config: AutomationConfig,
  execute: AutomationExecutor | null,
  nowSeconds?: number,
): Promise<HandlerResult> {
  if (!config.secret || config.secret.length < 32 || !config.integrationId || !execute) {
    return { status: 503, body: { ok: false, error: "automation_disabled" } };
  }
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_AUTOMATION_BODY_BYTES) {
    return { status: 413, body: { ok: false, error: "payload_too_large" } };
  }
  if (!input.contentType?.toLowerCase().startsWith("application/json")) {
    return { status: 415, body: { ok: false, error: "json_required" } };
  }
  const sig = verifySignature(config.secret, input.headers, input.rawBody, nowSeconds);
  if (!sig.ok) {
    log.warn("automation request rejected", { reason: sig.reason });
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }
  const integration = input.headers.integration ?? "";
  if (!UUID.test(integration) || integration.toLowerCase() !== config.integrationId.toLowerCase()) {
    log.warn("automation request rejected", { reason: "unknown_integration" });
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }
  const envelope = automationEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    return { status: 400, body: { ok: false, error: "invalid_envelope" } };
  }
  const { request_id, agent, operation, payload } = envelope.data;
  if (!isAutomationOperation(operation)) {
    // Refused here AND in SQL. Send/submit/spend operations do not exist.
    log.warn("automation request rejected", { reason: "unknown_operation", operation: operation.slice(0, 64) });
    return { status: 404, body: { ok: false, error: "unknown_operation" } };
  }

  try {
    const result = await execute(integration, request_id, agent, operation, payload);
    const ok = result.ok === true;
    return { status: ok ? 200 : result.error === "rate_limited" ? 429 : 422, body: result };
  } catch (err) {
    log.error("automation executor failed", { err });
    return { status: 502, body: { ok: false, error: "executor_unavailable" } };
  }
}
