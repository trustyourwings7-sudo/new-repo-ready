import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Values are validated once and never logged.
 * Missing optional integrations resolve to `null` so the UI can show an
 * honest "not configured" state instead of failing.
 */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https:\/\/[a-z0-9-]+\.supabase\.co$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v), {
      message: "NEXT_PUBLIC_SUPABASE_URL must be https://<ref>.supabase.co or a localhost URL",
    }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  PIES_ALLOWED_EMAILS: optional,
  PIES_SITE_URL: z.string().trim().url().default("http://localhost:3000"),
  ANTHROPIC_API_KEY: optional,
  GEMINI_API_KEY: optional,
  BRAVE_SEARCH_API_KEY: optional,
  GOOGLE_OAUTH_CLIENT_ID: optional,
  GOOGLE_OAUTH_CLIENT_SECRET: optional,
  PIES_WEBHOOK_SECRET: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
});

export type ServerEnv = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report variable names only, never values.
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

let cached: ServerEnv | null = null;
export function env(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

export function allowedEmails(e: ServerEnv = env()): Set<string> {
  return new Set(
    (e.PIES_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string | null | undefined, e: ServerEnv = env()): boolean {
  if (!email) return false;
  const list = allowedEmails(e);
  // Fail closed: an empty allowlist admits nobody.
  return list.size > 0 && list.has(email.trim().toLowerCase());
}

export type IntegrationStatus = "configured" | "not_configured";

/** Booleans only. Never return secret values from here. */
export function integrationStatus(e: ServerEnv = env()) {
  const s = (ok: boolean): IntegrationStatus => (ok ? "configured" : "not_configured");
  return {
    supabase: s(Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
    accessAllowlist: s(allowedEmails(e).size > 0),
    anthropic: s(Boolean(e.ANTHROPIC_API_KEY)),
    gemini: s(Boolean(e.GEMINI_API_KEY)),
    braveSearch: s(Boolean(e.BRAVE_SEARCH_API_KEY)),
    gmailOAuth: s(Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.GOOGLE_OAUTH_CLIENT_SECRET)),
    webhookSecret: s(Boolean(e.PIES_WEBHOOK_SECRET)),
  } as const;
}
