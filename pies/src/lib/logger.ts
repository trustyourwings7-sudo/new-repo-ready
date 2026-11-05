/**
 * Structured JSON logger with secret redaction.
 * Redacts by key name and by value shape (JWTs, API keys, bearer tokens, emails in "token" fields).
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|service[_-]?role|refresh|access[_-]?key|private)/i;
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI/Anthropic-style keys
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /ya29\.[0-9A-Za-z_-]{20,}/g, // Google OAuth access tokens
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

export function redactString(s: string): string {
  return SECRET_VALUE_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), s);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
