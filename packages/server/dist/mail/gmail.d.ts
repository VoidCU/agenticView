import type { MailSender, MailThread } from "@agenticview/shared";
/** Fetch-based Gmail REST client. `token` supplies a fresh access token per request. */
export declare class GmailClient {
    private readonly token;
    private readonly fetchImpl;
    constructor(token: (accountId: string) => Promise<string>, fetchImpl?: typeof fetch);
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
    send(accountId: string, gmailThreadId: string, raw: string): Promise<void>;
}
