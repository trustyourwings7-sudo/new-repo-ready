import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Request signing for the automation API.
 *   X-PIES-Integration: <integration uuid>
 *   X-PIES-Timestamp:   <unix seconds>
 *   X-PIES-Signature:   v1=<hex HMAC-SHA256(secret, "v1:" + integration + ":" + timestamp + ":" + rawBody)>
 * Replays outside the window are refused; replays inside it are absorbed by
 * request_id idempotency in the database.
 */
export const SIGNATURE_WINDOW_SECONDS = 300;

export function signRequest(secret: string, integrationId: string, timestamp: number, rawBody: string): string {
  const mac = createHmac("sha256", secret).update(`v1:${integrationId}:${timestamp}:${rawBody}`).digest("hex");
  return `v1=${mac}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" };

export function verifySignature(
  secret: string,
  headers: { integration: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
  const { integration, timestamp, signature } = headers;
  if (!integration || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(timestamp);
  if (Math.abs(nowSeconds - ts) > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "stale_timestamp" };
  const expected = Buffer.from(signRequest(secret, integration, ts, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
