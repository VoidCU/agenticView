import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, ServerMessage } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { MailAccounts } from "../../src/mail/accounts.js";
import { OAuthFlow, MailReconnectError } from "../../src/mail/oauth.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-mail-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-mail-p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  vi.useRealTimers();
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const REDIRECT = "http://127.0.0.1:4242/oauth/google/callback";

interface Call { url: string; body: URLSearchParams | undefined; headers: Record<string, string> }

/** Fake Google: token endpoint + Gmail profile. `refresh` decides the refresh_token grant response. */
function fakeGoogle(opts: { email?: string; refresh?: () => Response } = {}) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? new URLSearchParams(String(init.body)) : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, body, headers });
    if (url === "https://oauth2.googleapis.com/token") {
      if (body?.get("grant_type") === "authorization_code") {
        return Response.json({ access_token: "at-1", refresh_token: "rt-secret-1", expires_in: 3599, token_type: "Bearer" });
      }
      if (body?.get("grant_type") === "refresh_token") {
        return opts.refresh?.() ?? Response.json({ access_token: "at-2", expires_in: 3599, token_type: "Bearer" });
      }
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
      return Response.json({ emailAddress: opts.email ?? "me@example.com", messagesTotal: 1 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

async function filesUnder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function bootServer(mailFetch: typeof fetch) {
  const runtimes = new Map<Provider, Runtime>([["claude", new FakeRuntime(async function* () { yield { type: "text", text: "x" }; })]]);
  server = await createServer({ world: { kind: "project", projectPath: proj }, token: "tok", runtimes, mailFetch });
  return server;
}

describe("mail oauth", () => {
  it("start returns a Google auth URL with PKCE and offline access", async () => {
    const accounts = new MailAccounts();
    await accounts.setClient(CLIENT);
    const flow = new OAuthFlow(accounts, () => REDIRECT, () => undefined, fakeGoogle().impl);
    const { authUrl } = await flow.start();
    const u = new URL(authUrl);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("accounts.google.com");
    const p = u.searchParams;
    expect(p.get("client_id")).toBe(CLIENT.clientId);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.modify",
    );
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    // 32 random bytes, base64url.
    expect(p.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authUrl).not.toContain(CLIENT.clientSecret);
  });

  it("start throws when no client is configured", async () => {
    const flow = new OAuthFlow(new MailAccounts(), () => REDIRECT, () => undefined, fakeGoogle().impl);
    await expect(flow.start()).rejects.toThrow("Google client not configured");
  });

  it("complete exchanges code, saves account, never returns tokens", async () => {
    const accounts = new MailAccounts();
    await accounts.setClient(CLIENT);
    const g = fakeGoogle({ email: "me@example.com" });
    const connected: string[] = [];
    const flow = new OAuthFlow(accounts, () => REDIRECT, (a) => connected.push(a.email), g.impl);
    const { authUrl } = await flow.start();
    const u = new URL(authUrl);
    const state = u.searchParams.get("state")!;
    const account = await flow.complete(state, "the-code");
    expect(account.email).toBe("me@example.com");
    expect(account.id).toMatch(/^ma_[0-9a-f]{8}$/);
    expect(JSON.stringify(account)).not.toMatch(/refresh|rt-secret|at-1/i);
    expect(connected).toEqual(["me@example.com"]);

    const tokenCall = g.calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    expect(tokenCall.body?.get("grant_type")).toBe("authorization_code");
    expect(tokenCall.body?.get("code")).toBe("the-code");
    expect(tokenCall.body?.get("redirect_uri")).toBe(REDIRECT);
    expect(tokenCall.body?.get("client_id")).toBe(CLIENT.clientId);
    const verifier = tokenCall.body?.get("code_verifier");
    expect(verifier).toBeTruthy();
    expect(createHash("sha256").update(verifier!).digest("base64url")).toBe(u.searchParams.get("code_challenge"));
    const profileCall = g.calls.find((c) => c.url.includes("/users/me/profile"))!;
    expect(profileCall.headers.authorization).toBe("Bearer at-1");

    const list = await accounts.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.email).toBe("me@example.com");
    expect(JSON.stringify(list)).not.toMatch(/refresh/i);
    expect(await accounts.getSecret(account.id)).toEqual({ refreshToken: "rt-secret-1" });
    // The access token from the exchange is cached: no refresh call needed.
    expect(await flow.accessToken(account.id)).toBe("at-1");
  });

  it("reconnecting the same email keeps the id and replaces the token", async () => {
    const accounts = new MailAccounts();
    const a = await accounts.save({ email: "Me@Example.com", refreshToken: "old" });
    const b = await accounts.save({ email: "me@example.com", refreshToken: "new" });
    expect(b.id).toBe(a.id);
    expect(await accounts.list()).toHaveLength(1);
    expect(await accounts.getSecret(a.id)).toEqual({ refreshToken: "new" });
  });

  it("client config and account removal round-trip; bad ids are rejected", async () => {
    const accounts = new MailAccounts();
    expect(await accounts.getClient()).toBeUndefined();
    await accounts.setClient(CLIENT);
    expect(await accounts.getClient()).toEqual(CLIENT);
    await accounts.setClient(null);
    expect(await accounts.getClient()).toBeUndefined();
    const a = await accounts.save({ email: "x@example.com", refreshToken: "r" });
    expect(await accounts.getSecret("../google-client")).toBeUndefined();
    expect(await accounts.remove("../../config")).toBe(false);
    expect(await accounts.remove(a.id)).toBe(true);
    expect(await accounts.list()).toEqual([]);
    expect(await accounts.remove(a.id)).toBe(false);
  });

  it("refreshes the access token with the refresh token and caches it", async () => {
    const accounts = new MailAccounts();
    await accounts.setClient(CLIENT);
    const a = await accounts.save({ email: "me@example.com", refreshToken: "rt-x" });
    const g = fakeGoogle();
    const flow = new OAuthFlow(accounts, () => REDIRECT, () => undefined, g.impl);
    expect(await flow.accessToken(a.id)).toBe("at-2");
    expect(await flow.accessToken(a.id)).toBe("at-2");
    const refreshes = g.calls.filter((c) => c.body?.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.body?.get("refresh_token")).toBe("rt-x");
  });

  it("forget during an in-flight refresh does not re-cache the token", async () => {
    const accounts = new MailAccounts();
    await accounts.setClient(CLIENT);
    const a = await accounts.save({ email: "me@example.com", refreshToken: "rt-x" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const g = fakeGoogle({ refresh: () => Response.json({ access_token: `at-r${++n}`, expires_in: 3599 }) });
    const slow = (async (input: string | URL | Request, init?: RequestInit) => {
      await gate;
      return g.impl(input, init);
    }) as typeof fetch;
    const flow = new OAuthFlow(accounts, () => REDIRECT, () => undefined, slow);
    const first = flow.accessToken(a.id);
    await new Promise((r) => setTimeout(r, 20));
    flow.forget(a.id);
    release();
    expect(await first).toBe("at-r1");
    // Not cached: the next call refreshes again.
    expect(await flow.accessToken(a.id)).toBe("at-r2");
  });

  it("marks account needsReconnect on invalid_grant", async () => {
    const accounts = new MailAccounts();
    await accounts.setClient(CLIENT);
    const a = await accounts.save({ email: "me@example.com", refreshToken: "revoked" });
    const g = fakeGoogle({ refresh: () => Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }) });
    const flow = new OAuthFlow(accounts, () => REDIRECT, () => undefined, g.impl);
    const err = await flow.accessToken(a.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailReconnectError);
    expect((err as MailReconnectError).accountId).toBe(a.id);
    expect((await accounts.list())[0]!.needsReconnect).toBe(true);
    // Reconnecting clears the flag.
    await accounts.save({ email: "me@example.com", refreshToken: "fresh" });
    expect((await accounts.list())[0]!.needsReconnect).toBeFalsy();
  });

  it.skipIf(process.platform === "win32")("account files are written 0o600", async () => {
    const accounts = new MailAccounts();
    await accounts.setClient(CLIENT);
    const a = await accounts.save({ email: "me@example.com", refreshToken: "r" });
    expect((await stat(join(home, "mail", "google-client.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, "mail", "accounts", `${a.id}.json`))).mode & 0o777).toBe(0o600);
  });

  describe("callback route", () => {
    it("callback rejects bad state", async () => {
      const g = fakeGoogle();
      const s = await bootServer(g.impl);
      await s.mail.accounts.setClient(CLIENT);
      const r = await fetch(`${s.url}/oauth/google/callback?state=nope&code=x`);
      expect(r.status).toBe(400);
      expect(await filesUnder(join(home, "mail", "accounts"))).toEqual([]);
      expect(g.calls).toEqual([]);
      const missing = await fetch(`${s.url}/oauth/google/callback`);
      expect(missing.status).toBe(400);
    });

    it("callback succeeds once (no token needed) and rejects the same state twice", async () => {
      const g = fakeGoogle({ email: "a<b>@example.com" });
      const s = await bootServer(g.impl);
      await s.mail.accounts.setClient(CLIENT);
      const events: ServerMessage[] = [];
      s.bus.on((m) => events.push(m));
      const { authUrl } = await s.mail.flow.start();
      const u = new URL(authUrl);
      expect(u.searchParams.get("redirect_uri")).toBe(`${s.url}/oauth/google/callback`);
      const state = u.searchParams.get("state")!;
      const ok = await fetch(`${s.url}/oauth/google/callback?state=${encodeURIComponent(state)}&code=c1`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toMatch(/text\/html/);
      const html = await ok.text();
      expect(html).toContain("Gmail connected: a&lt;b&gt;@example.com. You can close this tab.");
      expect(html).not.toContain("a<b>");
      expect(html).not.toMatch(/rt-secret|at-1/);
      expect(events).toContainEqual({ type: "mail.changed", what: "accounts" });
      expect(await s.mail.accounts.list()).toHaveLength(1);

      const again = await fetch(`${s.url}/oauth/google/callback?state=${encodeURIComponent(state)}&code=c1`);
      expect(again.status).toBe(400);
      expect(g.calls.filter((c) => c.body?.get("grant_type") === "authorization_code")).toHaveLength(1);
    });

    it("callback rejects a state older than 10 minutes", async () => {
      const g = fakeGoogle();
      const s = await bootServer(g.impl);
      await s.mail.accounts.setClient(CLIENT);
      const { authUrl } = await s.mail.flow.start();
      const state = new URL(authUrl).searchParams.get("state")!;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 11 * 60_000);
      const r = await fetch(`${s.url}/oauth/google/callback?state=${encodeURIComponent(state)}&code=x`);
      expect(r.status).toBe(400);
      expect(await filesUnder(join(home, "mail", "accounts"))).toEqual([]);
      expect(g.calls).toEqual([]);
    });

    it("escapes the error shown on failure", async () => {
      const s = await bootServer(fakeGoogle().impl);
      const r = await fetch(`${s.url}/oauth/google/callback?error=${encodeURIComponent("<script>x</script>")}`);
      expect(r.status).toBe(400);
      const html = await r.text();
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });
});

