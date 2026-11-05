// Usage: node scripts/check-ui-overflow.mjs http://localhost:3123
// Fails (exit 1) if any PIES page scrolls horizontally at phone or desktop width.
// Uses the machine's Playwright install; set PLAYWRIGHT_EXECUTABLE_PATH to use a specific browser.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("@playwright/test"); }
const base = process.argv[2] ?? "http://localhost:3123";
const pages = ["/", "/budget", "/settings", "/agents", "/opportunities", "/login"];
const browser = await playwright.chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
let failed = 0;
for (const [w, h] of [[390, 844], [1366, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const p of pages) {
    const res = await page.goto(base + p, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const ok = res && res.status() < 400 && !overflow;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${w}px ${p} status=${res?.status()} overflow=${overflow}`);
  }
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
