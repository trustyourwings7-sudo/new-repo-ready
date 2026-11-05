import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GMAIL_ALLOWED_ENDPOINTS, GMAIL_SCOPE, GmailNotConnectedError, gmailDrafts } from "@/lib/gmail/drafts";
import { AUTOMATION_OPERATIONS } from "@/lib/automation/operations";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("Gmail: sending is not available through PIES", () => {
  it("exposes draft operations only", () => {
    expect(Object.keys(gmailDrafts).sort()).toEqual(["createDraft", "getDraft", "listDrafts"]);
    for (const k of Object.keys(gmailDrafts)) expect(k.toLowerCase()).not.toMatch(/send|forward|reply|modify|delete|trash/);
    expect(Object.isFrozen(gmailDrafts)).toBe(true);
  });

  it("allows no send endpoint", () => {
    for (const e of GMAIL_ALLOWED_ENDPOINTS) expect(e.path).not.toMatch(/send/);
    expect(GMAIL_ALLOWED_ENDPOINTS.every((e) => e.path.startsWith("/gmail/v1/users/me/drafts"))).toBe(true);
  });

  it("the agent interface has no email operation", () => {
    for (const op of Object.keys(AUTOMATION_OPERATIONS)) expect(op).not.toMatch(/gmail|email|send|mail/);
  });

  it("no source file references a Gmail send endpoint or a broader scope", () => {
    const offenders = walk(path.join(__dirname, "../src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /messages\/send|drafts\/send|messages\.send|drafts\.send|auth\/gmail\.send|auth\/gmail\.modify|mail\.google\.com\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("requests the narrowest scope that can create drafts", () => {
    expect(GMAIL_SCOPE).toBe("https://www.googleapis.com/auth/gmail.compose");
  });

  it("fails closed until Phase 3", async () => {
    await expect(gmailDrafts.createDraft({ to: "a@b.co", subject: "s", bodyText: "b" })).rejects.toBeInstanceOf(GmailNotConnectedError);
  });
});
