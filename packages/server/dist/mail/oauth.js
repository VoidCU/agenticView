import { createHash, randomBytes } from "node:crypto";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
export const GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
];
/** A `state` is single-use and valid for 10 minutes after it is issued. */
const STATE_TTL_MS = 10 * 60_000;
/** Refresh this long before Google's stated expiry. */
const EXPIRY_SLACK_MS = 60_000;
/** Bound on outstanding sign-ins, so repeated start() calls cannot grow memory without limit. */
const MAX_PENDING = 50;
/** The account's refresh token was revoked or expired; the user must reconnect it. */
export class MailReconnectError extends Error {
    accountId;
    constructor(accountId) {
        super("Gmail account needs to be reconnected");
        this.accountId = accountId;
        this.name = "MailReconnectError";
    }
}
const b64url = (buf) => buf.toString("base64url");
/** Reads a JSON body without throwing; Google error bodies are `{ error, error_description }`. */
async function jsonBody(r) {
    try {
        const v = await r.json();
        return v && typeof v === "object" ? v : {};
    }
    catch {
        return {};
    }
}
/** Only Google's short error code is surfaced (never bodies, codes or tokens). */
function errorCode(body, status) {
    return typeof body.error === "string" && /^[\w.-]{1,64}$/.test(body.error) ? body.error : `HTTP ${status}`;
}
/**
 * Google OAuth for Gmail: authorization code + PKCE (S256) with a loopback redirect, using the user's
 * own Desktop OAuth client. Access tokens live in memory only; refresh tokens go to MailAccounts.
 */
export class OAuthFlow {
    accounts;
    redirectUri;
    onConnected;
    fetchImpl;
    pending = new Map();
    tokens = new Map();
    refreshing = new Map();
    /** Bumped by forget(), so a refresh that started before it cannot re-cache a token. */
    generation = new Map();
    constructor(accounts, redirectUri, onConnected, fetchImpl = fetch) {
        this.accounts = accounts;
        this.redirectUri = redirectUri;
        this.onConnected = onConnected;
        this.fetchImpl = fetchImpl;
    }
    prune(now) {
        for (const [k, p] of this.pending)
            if (p.expiresAt <= now)
                this.pending.delete(k);
        while (this.pending.size >= MAX_PENDING)
            this.pending.delete(this.pending.keys().next().value);
    }
    async start() {
        const client = await this.accounts.getClient();
        if (!client)
            throw new Error("Google client not configured");
        const now = Date.now();
        this.prune(now);
        const state = b64url(randomBytes(32));
        const verifier = b64url(randomBytes(32));
        const challenge = b64url(createHash("sha256").update(verifier).digest());
        const redirectUri = this.redirectUri();
        this.pending.set(state, { verifier, redirectUri, expiresAt: now + STATE_TTL_MS });
        const u = new URL(AUTH_URL);
        u.search = new URLSearchParams({
            client_id: client.clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: GMAIL_SCOPES.join(" "),
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
            access_type: "offline",
            prompt: "consent",
        }).toString();
        return { authUrl: u.toString() };
    }
    /** Finishes a sign-in. The state is consumed before anything else, so it can never be replayed. */
    async complete(state, code) {
        const p = typeof state === "string" ? this.pending.get(state) : undefined;
        if (p)
            this.pending.delete(state);
        if (!p || Date.now() >= p.expiresAt)
            throw new Error("Invalid or expired sign-in state. Start the connection again.");
        if (typeof code !== "string" || !code)
            throw new Error("Missing authorization code");
        const client = await this.accounts.getClient();
        if (!client)
            throw new Error("Google client not configured");
        const f = this.fetchImpl;
        const tr = await f(TOKEN_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: client.clientId,
                client_secret: client.clientSecret,
                redirect_uri: p.redirectUri,
                grant_type: "authorization_code",
                code_verifier: p.verifier,
            }).toString(),
        });
        const tok = await jsonBody(tr);
        if (!tr.ok)
            throw new Error(`Google token exchange failed (${errorCode(tok, tr.status)})`);
        const accessToken = typeof tok.access_token === "string" ? tok.access_token : "";
        const refreshToken = typeof tok.refresh_token === "string" ? tok.refresh_token : "";
        if (!accessToken)
            throw new Error("Google did not return an access token");
        if (!refreshToken)
            throw new Error("Google did not return a refresh token");
        const pr = await f(PROFILE_URL, { headers: { authorization: `Bearer ${accessToken}` } });
        const profile = await jsonBody(pr);
        if (!pr.ok)
            throw new Error(`Reading the Gmail profile failed (${errorCode(profile, pr.status)})`);
        const email = typeof profile.emailAddress === "string" ? profile.emailAddress.trim() : "";
        if (!email)
            throw new Error("Gmail did not return the account's email address");
        const account = await this.accounts.save({ email, refreshToken });
        this.cache(account.id, accessToken, tok.expires_in);
        this.onConnected(account);
        return account;
    }
    cache(accountId, token, expiresIn) {
        const secs = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 3600;
        this.tokens.set(accountId, { token, expiresAt: Date.now() + secs * 1000 - EXPIRY_SLACK_MS });
    }
    /** A valid access token for the account: cached until 60 s before expiry, else refreshed (one refresh at a time). */
    async accessToken(accountId) {
        const hit = this.tokens.get(accountId);
        if (hit && Date.now() < hit.expiresAt)
            return hit.token;
        const inflight = this.refreshing.get(accountId);
        if (inflight)
            return inflight;
        const run = this.refresh(accountId).finally(() => {
            if (this.refreshing.get(accountId) === run)
                this.refreshing.delete(accountId);
        });
        this.refreshing.set(accountId, run);
        return run;
    }
    async refresh(accountId) {
        const gen = this.generation.get(accountId) ?? 0;
        this.tokens.delete(accountId);
        const secret = await this.accounts.getSecret(accountId);
        if (!secret)
            throw new Error("Unknown mail account");
        const client = await this.accounts.getClient();
        if (!client)
            throw new Error("Google client not configured");
        const f = this.fetchImpl;
        const r = await f(TOKEN_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: client.clientId,
                client_secret: client.clientSecret,
                refresh_token: secret.refreshToken,
                grant_type: "refresh_token",
            }).toString(),
        });
        const body = await jsonBody(r);
        if (!r.ok) {
            if (body.error === "invalid_grant") {
                await this.accounts.markNeedsReconnect(accountId, true);
                throw new MailReconnectError(accountId);
            }
            throw new Error(`Google token refresh failed (${errorCode(body, r.status)})`);
        }
        const token = typeof body.access_token === "string" ? body.access_token : "";
        if (!token)
            throw new Error("Google did not return an access token");
        // forget() ran while this refresh was in flight (account removed): hand the token back, don't cache it.
        if ((this.generation.get(accountId) ?? 0) === gen)
            this.cache(accountId, token, body.expires_in);
        return token;
    }
    /** Drops any cached access token (e.g. after the account is removed); an in-flight refresh won't re-cache. */
    forget(accountId) {
        this.tokens.delete(accountId);
        this.refreshing.delete(accountId);
        this.generation.set(accountId, (this.generation.get(accountId) ?? 0) + 1);
    }
}
//# sourceMappingURL=oauth.js.map