/**
 * Deadline follow-up: official programme pages often keep the dated deadline on a sub-page
 * ("How to apply", "Deadlines", "Call for applications"). Pick at most ONE such link on the same
 * site from the page's own markdown. Pure function: no network.
 */

const STRONG = /\b(deadlines?|closing dates?|key dates|important dates|timeline|calendar)\b/i;
const MEDIUM = /\b(how to apply|application (process|procedure|guide)|apply now|apply|call for (applications|proposals)|calls?\b|admission|selection procedure|submit)/i;
const SKIP = /\.(pdf|docx?|xlsx?|pptx?|zip|jpg|jpeg|png|gif|svg)(\?|#|$)|^mailto:|^tel:|^javascript:/i;
const NOISE = /\b(log ?in|sign ?in|register for (an )?account|cookie|privacy|contact|news|events?|faq|search)\b/i;

function baseHost(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

/** Same site: same host, or a subdomain of / parent of the page's host (e.g. apply.uni.ca ↔ uni.ca). */
function sameSite(a: string, b: string): boolean {
  const x = baseHost(a);
  const y = baseHost(b);
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

export function findDeadlineLink(markdown: string, pageUrl: string): string | null {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  let best: { url: string; score: number } | null = null;
  for (const m of markdown.matchAll(/\[([^\]]{1,120})\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const text = m[1]!.replace(/[*_`]/g, "").trim();
    const href = m[2]!;
    if (SKIP.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, page);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, page.hostname)) continue;
    u.hash = "";
    if (u.href === new URL(page.href.split("#")[0]!).href) continue;
    const hay = `${text} ${decodeURIComponent(u.pathname).replace(/[-_/]+/g, " ")}`;
    if (NOISE.test(text)) continue;
    const score = (STRONG.test(hay) ? 3 : 0) + (MEDIUM.test(hay) ? 2 : 0) + (/\b20\d{2}\b/.test(hay) ? 1 : 0);
    if (score >= 2 && (!best || score > best.score)) best = { url: u.href, score };
  }
  return best?.url ?? null;
}
