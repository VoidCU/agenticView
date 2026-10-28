import type { MailThread } from "@agenticview/shared";
export type GmailPayload = {
    mimeType?: string;
    headers?: {
        name: string;
        value: string;
    }[];
    body?: {
        data?: string;
        size?: number;
    };
    parts?: GmailPayload[];
    filename?: string;
};
/** Split `Name <addr>` into parts; email lower-cased, name falls back to the address. */
export declare function parseAddress(header: string): {
    name: string;
    email: string;
};
/** Regex-based HTML to plain text (no DOM). */
export declare function htmlToText(html: string): string;
/** Drop the quoted history ("On ... wrote:" and trailing "> " lines). */
export declare function trimQuoted(text: string): string;
/** Message body as plain text: text/plain preferred, else text/html converted. */
export declare function bodyText(payload: GmailPayload): string;
/** Fenced, injection-safe rendering of a thread for an agent task. */
export declare function renderThreadForTask(thread: MailThread, tagNames: string[]): string;
/** RFC 2822 reply message, base64url encoded for the Gmail API. */
export declare function buildReplyMime(opts: {
    from: string;
    to: string;
    subject: string;
    inReplyTo?: string;
    references?: string;
    body: string;
}): string;
/** True when an agent's output is just the reply body, not chatter or a structured doc. */
export declare function looksLikeBareReply(text: string): boolean;
