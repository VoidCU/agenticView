import { describe, it, expect, afterEach, beforeEach } from "vitest";
import WebSocket from "ws";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, ServerMessage } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-h-"));
  proj = await mkdtemp(join(tmpdir(), "av p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

async function boot(opts: { staticDir?: string; runtimes?: Map<Provider, Runtime> } = {}) {
  const fake = new FakeRuntime(async function* (req) {
    yield { type: "text", text: req.agent.role === "manager" ? "hi there" : "worker says hi" };
  });
  server = await createServer({ world: { kind: "project", projectPath: proj }, token: "tok", runtimes: opts.runtimes ?? new Map([["claude", fake]]), staticDir: opts.staticDir });
  return { s: server, fake };
}

type Msg = ServerMessage & Record<string, any>;
function open(url: string, token: string) {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws?token=${token}`);
  const msgs: Msg[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  return new Promise<{ ws: WebSocket; msgs: Msg[] }>((res, rej) => {
    ws.on("open", () => res({ ws, msgs }));
    ws.on("error", rej);
  });
}
const until = (msgs: Msg[], pred: (m: Msg) => boolean, ms = 5000) =>
  new Promise<Msg>((res, rej) => {
    const start = Date.now();
    const i = setInterval(() => {
      const m = msgs.find(pred);
      if (m) { clearInterval(i); res(m); }
      else if (Date.now() - start > ms) { clearInterval(i); rej(new Error("timeout waiting for message")); }
    }, 10);
  });

describe("server", () => {
  it("binds localhost, rejects missing token, serves healthz and snapshot", async () => {
    const { s } = await boot();
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${s.url}/healthz`)).status).toBe(200);
    expect(await (await fetch(`${s.url}/healthz`)).json()).toEqual({ ok: true, world: "project" });
    expect((await fetch(`${s.url}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/snapshot?token=wrong`)).status).toBe(401);
    const res = await fetch(`${s.url}/api/snapshot`, { headers: { "x-agenticview-token": "tok" } });
    expect(res.status).toBe(200);
    const snap = await res.json();
    expect(snap.world.projectPath).toBe(proj);
    expect(snap.agents.some((a: any) => a.role === "manager")).toBe(true);
    expect(snap.providers.map((p: any) => p.provider)).toEqual(["claude", "codex", "gemini"]);
    expect((await fetch(`${s.url}/api/snapshot?token=tok`)).status).toBe(200);
  });

  it("sends a snapshot on connect and broadcasts to two clients exactly once", async () => {
    const { s } = await boot();
    const a = await open(s.url, "tok");
    const b = await open(s.url, "tok");
    const snap = await until(a.msgs, (m) => m.type === "snapshot");
    const managerId = snap.agents.find((x: any) => x.role === "manager").id;
    a.ws.send(JSON.stringify({ type: "chat.send", agentId: managerId, text: "hello" }));
    const doneA = await until(a.msgs, (m) => m.type === "task.updated" && m.task.status === "done");
    const doneB = await until(b.msgs, (m) => m.type === "task.updated" && m.task.status === "done");
    expect(doneA.task.id).toBe(doneB.task.id);
    expect(doneA.task.result).toBe("hi there");
    expect(b.msgs.filter((m) => m.type === "task.updated" && m.task.status === "done")).toHaveLength(1);
    expect(a.msgs.some((m) => m.type === "run.event" && m.event.type === "text")).toBe(true);
    a.ws.close();
    b.ws.close();
  });

  it("rejects a bad websocket token and malformed messages", async () => {
    const { s } = await boot();
    await expect(open(s.url, "nope")).rejects.toThrow();
    const a = await open(s.url, "tok");
    a.ws.send("{not json");
    const err = await until(a.msgs, (m) => m.type === "error");
    expect(err.message).toMatch(/JSON/);
    a.ws.send(JSON.stringify({ type: "chat.send" }));
    const err2 = await until(a.msgs, (m) => m.type === "error" && m.ref === "chat.send");
    expect(err2.message).toMatch(/agentId|text/);
    a.ws.send(JSON.stringify({ type: "snapshot.request" }));
    await until(a.msgs, (m) => m.type === "snapshot" && a.msgs.filter((x) => x.type === "snapshot").length >= 2);
    a.ws.close();
  });

  it("handles agent create/update/copy/delete, settings, cancel, and refuses unavailable providers", async () => {
    const { s } = await boot();
    const a = await open(s.url, "tok");
    await until(a.msgs, (m) => m.type === "snapshot");
    a.ws.send(JSON.stringify({ type: "agent.create", agent: { name: "Nova", specialty: "frontend" } }));
    const created = await until(a.msgs, (m) => m.type === "agent.updated" && m.agent.name === "Nova");
    a.ws.send(JSON.stringify({ type: "agent.update", id: created.agent.id, patch: { specialty: "css" } }));
    await until(a.msgs, (m) => m.type === "agent.updated" && m.agent.specialty === "css");
    a.ws.send(JSON.stringify({ type: "agent.create", agent: { name: "Gem", specialty: "", provider: "gemini" } }));
    const refused = await until(a.msgs, (m) => m.type === "error" && m.ref === "agent.create");
    expect(refused.message).toMatch(/gemini/);
    a.ws.send(JSON.stringify({ type: "agent.create", agent: { name: "Glob", specialty: "", scope: "global" } }));
    const glob = await until(a.msgs, (m) => m.type === "agent.updated" && m.agent.name === "Glob");
    expect(glob.agent.scope).toBe("global");
    a.ws.send(JSON.stringify({ type: "agent.copyToProject", id: glob.agent.id }));
    const copy = await until(a.msgs, (m) => m.type === "agent.updated" && m.agent.originId === glob.agent.id);
    expect(copy.agent.scope).toBe("project");
    a.ws.send(JSON.stringify({ type: "agent.delete", id: copy.agent.id }));
    await until(a.msgs, (m) => m.type === "agent.removed" && m.id === copy.agent.id);
    a.ws.send(JSON.stringify({ type: "settings.update", settings: { maxConcurrentRuns: 1, defaultProvider: "claude" } }));
    const snap2 = await until(a.msgs, (m) => m.type === "snapshot" && m.settings.maxConcurrentRuns === 1);
    expect(snap2.settings.defaultProvider).toBe("claude");
    a.ws.send(JSON.stringify({ type: "chat.send", agentId: created.agent.id, text: "hey" }));
    const done = await until(a.msgs, (m) => m.type === "task.updated" && m.task.status === "done" && m.task.assigneeId === created.agent.id);
    expect(done.task.result).toBe("worker says hi");
    a.ws.send(JSON.stringify({ type: "task.cancel", id: "t_missing" }));
    a.ws.send(JSON.stringify({ type: "project.open", path: proj }));
    const perr = await until(a.msgs, (m) => m.type === "error" && m.ref === "project.open");
    expect(perr.message).toMatch(/hub/i);
    a.ws.close();
  });

  it("mirrors hook events and stores uploads", async () => {
    const { s } = await boot();
    const a = await open(s.url, "tok");
    await until(a.msgs, (m) => m.type === "snapshot");
    const r = await fetch(`${s.url}/hooks`, { method: "POST", headers: { "content-type": "application/json", "x-agenticview-token": "tok" }, body: JSON.stringify({ kind: "PostToolUse", text: "Edit src/a.ts" }) });
    expect(r.status).toBe(200);
    const m = await until(a.msgs, (m) => m.type === "mirror.event");
    expect(m.event.text).toBe("Edit src/a.ts");
    expect(m.event.kind).toBe("PostToolUse");
    expect((await fetch(`${s.url}/hooks`, { method: "POST", body: "{}" })).status).toBe(401);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), "shot.png");
    const up = await fetch(`${s.url}/api/upload?token=tok`, { method: "POST", body: form });
    expect(up.status).toBe(200);
    const { path } = await up.json();
    expect(path.replace(/\\/g, "/")).toContain("/.agenticview/uploads/");
    expect(path.endsWith(".png")).toBe(true);
    const bad = await fetch(`${s.url}/api/upload?token=tok`, { method: "POST", body: new FormData() });
    expect(bad.status).toBe(400);
    a.ws.close();
  });

  it("serves the static bundle with an SPA fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-static-"));
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "index.html"), "<html>index</html>");
    await writeFile(join(dir, "assets", "app.js"), "console.log(1)");
    const { s } = await boot({ staticDir: dir });
    expect(await (await fetch(`${s.url}/`)).text()).toBe("<html>index</html>");
    expect(await (await fetch(`${s.url}/assets/app.js`)).text()).toBe("console.log(1)");
    expect(await (await fetch(`${s.url}/some/route`)).text()).toBe("<html>index</html>");
    expect((await fetch(`${s.url}/api/nope?token=tok`)).status).toBe(404);
    await rm(dir, { recursive: true, force: true });
  });
});
