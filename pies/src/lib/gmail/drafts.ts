import "server-only";

/**
 * Gmail integration boundary (Phase 3: NOT connected).
 *
 * Google offers no draft-only scope. users.drafts.create accepts only the
 * full-mailbox scope, gmail.modify or gmail.compose, and every one of them
 * also permits sending. gmail.compose (the narrowest) is a RESTRICTED scope.
 * Therefore:
 *   - The OAuth refresh token stays server-side only (never in n8n, never in the browser).
 *   - This module is the only code allowed to call Gmail, and it exposes draft
 *     operations only. There is no send method, and tests fail if one is added
 *     or if any send endpoint string appears in the source tree.
 *   - These are APPLICATION restrictions. They do not reduce what the Google
 *     token itself can do if it is stolen. See SECURITY.md.
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose" as const;

/** The only Gmail REST paths PIES may call. */
export const GMAIL_ALLOWED_ENDPOINTS = [
  { method: "POST", path: "/gmail/v1/users/me/drafts" }, // drafts.create
  { method: "GET", path: "/gmail/v1/users/me/drafts/{id}" }, // drafts.get
  { method: "GET", path: "/gmail/v1/users/me/drafts" }, // drafts.list
] as const;

export interface DraftInput {
  to: string;
  subject: string;
  bodyText: string;
}

export interface GmailDraftOperations {
  createDraft(input: DraftInput): Promise<{ draftId: string; threadId: string | null }>;
  getDraft(draftId: string): Promise<{ draftId: string; subject: string | null }>;
  listDrafts(max: number): Promise<{ draftId: string }[]>;
}

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected (Phase 3)");
    this.name = "GmailNotConnectedError";
  }
}

/** Placeholder until Phase 3. Every call fails closed. */
export const gmailDrafts: GmailDraftOperations = Object.freeze({
  async createDraft() {
    throw new GmailNotConnectedError();
  },
  async getDraft() {
    throw new GmailNotConnectedError();
  },
  async listDrafts() {
    throw new GmailNotConnectedError();
  },
});
