import type { MailAccount } from "@agenticview/shared";
import type { MailAccounts } from "./accounts.js";
export declare const GMAIL_SCOPES: readonly ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.modify"];
/** The account's refresh token was revoked or expired; the user must reconnect it. */
export declare class MailReconnectError extends Error {
    readonly accountId: string;
    constructor(accountId: string);
}
/**
 * Google OAuth for Gmail: authorization code + PKCE (S256) with a loopback redirect, using the user's
 * own Desktop OAuth client. Access tokens live in memory only; refresh tokens go to MailAccounts.
 */
export declare class OAuthFlow {
    private readonly accounts;
    private readonly redirectUri;
    private readonly onConnected;
    private readonly fetchImpl;
    private readonly pending;
    private readonly tokens;
    private readonly refreshing;
    /** Bumped by forget(), so a refresh that started before it cannot re-cache a token. */
    private readonly generation;
    constructor(accounts: MailAccounts, redirectUri: () => string, onConnected: (a: MailAccount) => void, fetchImpl?: typeof fetch);
    private prune;
    start(): Promise<{
        authUrl: string;
    }>;
    /** Finishes a sign-in. The state is consumed before anything else, so it can never be replayed. */
    complete(state: string, code: string): Promise<MailAccount>;
    private cache;
    /** A valid access token for the account: cached until 60 s before expiry, else refreshed (one refresh at a time). */
    accessToken(accountId: string): Promise<string>;
    private refresh;
    /** Drops any cached access token (e.g. after the account is removed); an in-flight refresh won't re-cache. */
    forget(accountId: string): void;
}
