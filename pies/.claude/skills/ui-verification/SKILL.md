---
name: ui-verification
description: Verify the PIES web interface in a real headless browser with Playwright MCP - pages render, no horizontal overflow at phone and desktop widths, honest empty states, accessible labels. Use after UI changes or when asked to check how PIES looks or behaves.
---

# UI verification (Playwright MCP, local only)

Playwright MCP is configured in the repository-root `.mcp.json`: pinned `@playwright/mcp@0.0.83`, `--headless --isolated` (no saved profile, no cookies kept). The arbitrary-code tools (`browser_run_code_unsafe`, `browser_evaluate`) and file upload are denied.

## Procedure
1. From `pies/`, run `pnpm build`, then `node_modules/.bin/next start -p 3123` in the background.
2. With Playwright MCP, `browser_resize` to 390×844, then 1366×900. For each of `/`, `/budget`, `/settings`, `/agents`, `/login`:
   - `browser_navigate` to `http://localhost:3123<path>`
   - `browser_snapshot`: confirm the heading, the setup or empty-state notice, and that no sample data appears
   - `browser_take_screenshot` for the record
3. Horizontal overflow check (Playwright MCP's evaluate tool is denied on purpose): run
   `node scripts/check-ui-overflow.mjs http://localhost:3123`. It checks every page at 390 px and 1366 px and exits 1 on overflow.
4. Accessibility spot checks: every form control has a label, nav has `aria-current`, and the skip link works with the keyboard (`browser_press_key Tab`).
5. Stop the server. Report pass or fail per page and width.

## Rules
- Only browse `localhost` for PIES checks. For external sites, follow `opportunity-research` rules (no logins, respect terms).
- Never enter real credentials into any page.
- Screenshots go to `.playwright-mcp/` (git-ignored).
