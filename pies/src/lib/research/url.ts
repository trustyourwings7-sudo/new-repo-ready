import { createHash } from "node:crypto";

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/i;

/** Canonical form used for caching and deduplication. Returns null for non-http(s) URLs. */
export function normalizeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null; // never follow credentialed URLs
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** Matches the database rule: ^[A-Za-z0-9._:/-]{8,200}$ */
export function dedupeKey(normalizedUrl: string): string {
  return `url:${createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 40)}`;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Registrable-domain approximation (last two labels, three for common second-level suffixes). */
export function siteOf(url: string): string {
  const parts = hostOf(url).split(".");
  const sld = new Set(["ac", "co", "com", "edu", "gov", "org", "net"]);
  const n = parts.length >= 3 && sld.has(parts[parts.length - 2]!) ? 3 : 2;
  return parts.slice(-n).join(".");
}
