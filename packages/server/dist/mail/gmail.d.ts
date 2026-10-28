import type { MailSender, MailThread } from "@agenticview/shared";
/** Fetch-based Gmail REST client. `token` supplies a fresh access token per request. */
export declare class GmailClient {
    private readonly token;
    private readonly fetchImpl;
    constructor(token: (accountId: string) => Promise<string>, fetchImpl?: typeof fetch);
    /**
     * One Gmail call. 429 and 5xx are retried with backoff, except that a non-idempotent call (`once`: a send
     * or a draft create) is never retried on 5xx: Google may have accepted it, and a retry could send twice.
     * A 429 means Google did not accept it, so that is retried for every call.
     */
    private request;
    profileEmail(accountId: string): Promise<string>;
    recentSenders(accountId: string, opts?: {
        scan?: number;
        limit?: number;
    }): Promise<MailSender[]>;
    searchThreadIds(accountId: string, q: string, max?: number): Promise<string[]>;
    getThread(accountId: string, gmailThreadId: string, labelNames: Map<string, string>): Promise<Omit<MailThread, "tags" | "sentToAtlas" | "drafts">>;
    labelNames(accountId: string): Promise<Map<string, string>>;
    ensureLabel(accountId: string, name: string): Promise<string>;
    modifyThread(accountId: string, gmailThreadId: string, addLabelIds: string[]): Promise<void>;
    createDraft(accountId: string, gmailThreadId: string, raw: string): Promise<string>;
    /** Replaces a saved Gmail draft's message (the same draft id, so no second copy). */
    updateDraft(accountId: string, draftId: string, gmailThreadId: string, raw: string): Promise<void>;
    /** Sends a saved Gmail draft; Gmail removes it from Drafts. */
    sendDraftById(accountId: string, draftId: string): Promise<void>;
    /** Deletes a saved Gmail draft; one that is already gone (404) is fine. */
    deleteDraft(accountId: string, draftId: string): Promise<void>;
    send(accountId: string, gmailThreadId: string, raw: string): Promise<void>;
}
