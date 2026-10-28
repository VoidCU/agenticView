import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-mailr-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-mailr-p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret-xyz" };

/** Fake Google whose refresh grant is always revoked (invalid_grant). Records every URL. */
function revokedGoogle() {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ error: "invalid_grant" }, { status: 400 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, urls };
}

async function boot(mailFetch?: typeof fetch) {
  const runtimes = new Map<Provider, Runtime>([["claude", new FakeRuntime(async function* () { yield { type: "text", text: "x" }; })]]);
  server = await createServer({ world: { kind: "project", projectPath: proj }, token: "tok", runtimes, ...(mailFetch ? { mailFetch } : {}) });
  return server;
}

const H = { "x-agenticview-token": "tok", "content-type": "application/json" };

describe("mail routes", () => {
  it("GET /api/mail/status needs the token and never returns the client secret", async () => {
    const s = await boot();
    expect((await fetch(`${s.url}/api/mail/status`)).status).toBe(401);
    await s.mail.accounts.setClient(CLIENT);
    await s.mail.accounts.save({ email: "me@example.com", refreshToken: "rt-secret" });
    const r = await fetch(`${s.url}/api/mail/status`, { headers: H });
    expect(r.status).toBe(200);
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.clientConfigured).toBe(true);
    expect(body.accounts).toHaveLength(1);
    expect(text).not.toContain("clientSecret");
    expect(text).not.toContain("csecret-xyz");
    expect(text).not.toContain("rt-secret");
  });

  it("PUT /api/mail/client validates and sets/clears the client", async () => {
    const s = await boot();
    expect((await fetch(`${s.url}/api/mail/client`, { method: "PUT", headers: H, body: JSON.stringify({ clientId: "" }) })).status).toBe(400);
    const ok = await fetch(`${s.url}/api/mail/client`, { method: "PUT", headers: H, body: JSON.stringify(CLIENT) });
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toContain("csecret-xyz");
    expect((await s.mail.accounts.getClient())?.clientId).toBe(CLIENT.clientId);
    await fetch(`${s.url}/api/mail/client`, { method: "PUT", headers: H, body: "null" });
    expect(await s.mail.accounts.getClient()).toBeUndefined();
  });

  it("sources: create validates ranges (400); unknown ids 404", async () => {
    const s = await boot();
    const a = await s.mail.accounts.save({ email: "me@example.com", refreshToken: "rt" });
    const post = (body: unknown) => fetch(`${s.url}/api/mail/sources`, { method: "POST", headers: H, body: JSON.stringify(body) });
    expect((await post({ accountId: a.id, senders: ["a@x.com"], amount: { kind: "range", from: "2026-10-27", to: "2026-10-01" } })).status).toBe(400);
    expect((await post({ accountId: a.id, senders: [], amount: { kind: "sinceLast" } })).status).toBe(400);
    const created = await post({ accountId: a.id, senders: ["A@X.com"], amount: { kind: "sinceLast" } });
    expect(created.status).toBe(200);
    expect((await created.json()).senders).toEqual(["a@x.com"]);
    const list = await (await fetch(`${s.url}/api/mail/sources`, { headers: H })).json();
    expect(list).toHaveLength(1);
    expect((await fetch(`${s.url}/api/mail/sources/ms_ffffffff`, { method: "DELETE", headers: H })).status).toBe(404);
    expect((await fetch(`${s.url}/api/mail/threads/..%2F..%2Fx`, { headers: H })).status).toBe(404);
  });

  it("pull with a revoked account returns 409 needsReconnect, then stops calling Google", async () => {
    const g = revokedGoogle();
    const s = await boot(g.impl);
    await s.mail.accounts.setClient(CLIENT);
    const a = await s.mail.accounts.save({ email: "me@example.com", refreshToken: "revoked" });
    const src = await (await fetch(`${s.url}/api/mail/sources`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ accountId: a.id, senders: ["a@x.com"], amount: { kind: "latest", n: 10 } }),
    })).json();
    const r = await fetch(`${s.url}/api/mail/sources/${src.id}/pull`, { method: "POST", headers: H });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body).toMatchObject({ accountId: a.id, needsReconnect: true });
    expect(typeof body.error).toBe("string");
    const calls = g.urls.length;
    const again = await fetch(`${s.url}/api/mail/sources/${src.id}/pull`, { method: "POST", headers: H });
    expect(again.status).toBe(409);
    expect(g.urls.length).toBe(calls);
  });

  it("DELETE /api/mail/accounts/:id removes the account", async () => {
    const s = await boot();
    const a = await s.mail.accounts.save({ email: "me@example.com", refreshToken: "rt" });
    expect((await fetch(`${s.url}/api/mail/accounts/${a.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    expect(await s.mail.accounts.list()).toEqual([]);
    expect((await fetch(`${s.url}/api/mail/accounts/${a.id}`, { method: "DELETE", headers: H })).status).toBe(404);
  });

  it("tags: create, list, invalid colour 400, delete", async () => {
    const s = await boot();
    const bad = await fetch(`${s.url}/api/mail/tags`, { method: "POST", headers: H, body: JSON.stringify({ name: "X", color: "red", meaning: "" }) });
    expect(bad.status).toBe(400);
    const t = await (await fetch(`${s.url}/api/mail/tags`, { method: "POST", headers: H, body: JSON.stringify({ name: "X", color: "#ff0000", meaning: "" }) })).json();
    expect(t.writeToGmail).toBe(false);
    expect(await (await fetch(`${s.url}/api/mail/tags`, { headers: H })).json()).toHaveLength(1);
    expect((await fetch(`${s.url}/api/mail/tags/${t.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    expect(await (await fetch(`${s.url}/api/mail/threads`, { headers: H })).json()).toEqual([]);
  });
});
