import { describe, it, expect, afterEach, beforeEach } from "vitest";
import WebSocket from "ws";
import { connect as netConnect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, ServerMessage } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime, type FakeScript } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-hard-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-hard-p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Msg = ServerMessage & Record<string, any>;
async function boot(script: FakeScript, world: { kind: "project"; projectPath: string } | { kind: "hub" } = { kind: "project", projectPath: proj }, extra: Record<string, unknown> = {}) {
  const runtimes = new Map<Provider, Runtime>([["claude", new FakeRuntime(script)]]);
  server = await createServer({ world, token: "tok", runtimes, ...extra });
  return server;
}
function open(url: string, token: string) {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws?token=${token}`);
  const msgs: Msg[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  return new Promise<{ ws: WebSocket; msgs: Msg[] }>((res, rej) => {
    ws.on("open", () => res({ ws, msgs }));
    ws.on("error", rej);
  });
}
const until = (msgs: Msg[], pred: (m: Msg) => boolean, ms = 8000) =>
  new Promise<Msg>((res, rej) => {
    const start = Date.now();
    const i = setInterval(() => {
      const m = msgs.find(pred);
      if (m) { clearInterval(i); res(m); }
      else if (Date.now() - start > ms) { clearInterval(i); rej(new Error("timeout waiting for message")); }
    }, 10);
  });

describe("hardening", () => {
  it("survives a client that sends garbage frames after the upgrade", async () => {
    const s = await boot(async function* () { yield { type: "text", text: "x" }; });
    const sock = netConnect(s.port, "127.0.0.1");
    await new Promise((r) => sock.on("connect", r));
    sock.write("GET /ws?token=tok HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await new Promise((r) => sock.once("data", r));
    sock.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01, 0x02]));
    await new Promise((r) => setTimeout(r, 150));
    sock.destroy();
    expect((await fetch(`${s.url}/healthz`)).status).toBe(200);
    const a = await open(s.url, "tok");
    await until(a.msgs, (m) => m.type === "snapshot");
    a.ws.close();
  });

  it("does not rebroadcast the task for every run event and ships tasks without logs", async () => {
    const s = await boot(async function* () {
      for (let i = 0; i < 20; i++) yield { type: "text", text: `chunk ${i} ` };
      yield { type: "tool_start", name: "Read", input: {} };
      yield { type: "tool_end", name: "Read", ok: true, summary: "x" };
    });
    const a = await open(s.url, "tok");
    const snap = await until(a.msgs, (m) => m.type === "snapshot");
    const managerId = snap.agents.find((x: any) => x.role === "manager").id;
    a.ws.send(JSON.stringify({ type: "chat.send", agentId: managerId, text: "hello" }));
    const done = await until(a.msgs, (m) => m.type === "task.updated" && m.task.status === "done");
    await new Promise((r) => setTimeout(r, 100));
    expect(a.msgs.filter((m) => m.type === "run.event").length).toBe(22);
    expect(a.msgs.filter((m) => m.type === "task.updated" && m.task.id === done.task.id).length).toBeLessThanOrEqual(5);
    expect(done.task.log).toEqual([]);
    expect((await s.world.tasks.get(done.task.id))!.log.length).toBeGreaterThan(0);
    const snap2 = await (await fetch(`${s.url}/api/snapshot?token=tok`)).json();
    expect(snap2.tasks.every((t: any) => Array.isArray(t.log) && t.log.length === 0)).toBe(true);
    a.ws.close();
  });

  it("includes pending permissions and questions in the snapshot and resolves them on cancel", async () => {
    const s = await boot(async function* (req) {
      if (req.agent.role === "manager") {
        yield { type: "call", tool: "ask_user", args: { question: "Colour?" } };
        yield { type: "text", text: "thanks" };
      } else {
        await req.onPermission!({ id: "p9", tool: "Bash", input: { command: "rm -rf" } });
        yield { type: "text", text: "never" };
      }
    });
    const a = await open(s.url, "tok");
    const snap = await until(a.msgs, (m) => m.type === "snapshot");
    const managerId = snap.agents.find((x: any) => x.role === "manager").id;
    a.ws.send(JSON.stringify({ type: "agent.create", agent: { name: "W", specialty: "", permissionMode: "ask" } }));
    const created = await until(a.msgs, (m) => m.type === "agent.updated" && m.agent.name === "W");
    a.ws.send(JSON.stringify({ type: "chat.send", agentId: created.agent.id, text: "go" }));
    a.ws.send(JSON.stringify({ type: "chat.send", agentId: managerId, text: "ask me" }));
    await until(a.msgs, (m) => m.type === "permission.request" && m.id === "p9");
    const q = await until(a.msgs, (m) => m.type === "question.request");
    const b = await open(s.url, "tok");
    const snapB = await until(b.msgs, (m) => m.type === "snapshot");
    expect(snapB.permissions).toEqual([expect.objectContaining({ id: "p9", agentId: created.agent.id, tool: "Bash" })]);
    expect(snapB.questions).toEqual([expect.objectContaining({ id: q.id, agentId: managerId, question: "Colour?" })]);
    const permTask = snapB.tasks.find((t: any) => t.assigneeId === created.agent.id);
    a.ws.send(JSON.stringify({ type: "task.cancel", id: permTask.id }));
    await until(a.msgs, (m) => m.type === "permission.resolved" && m.id === "p9");
    await until(a.msgs, (m) => m.type === "task.updated" && m.task.id === permTask.id && m.task.status === "cancelled");
    a.ws.send(JSON.stringify({ type: "task.cancel", id: q.taskId }));
    await until(a.msgs, (m) => m.type === "question.resolved" && m.id === q.id);
    const snapC = await (await fetch(`${s.url}/api/snapshot?token=tok`)).json();
    expect(snapC.permissions).toEqual([]);
    expect(snapC.questions).toEqual([]);
    a.ws.close();
    b.ws.close();
  });

  it("refuses project.open for a path that is not a directory", async () => {
    const opened: string[] = [];
    const s = await boot(async function* () { yield { type: "text", text: "x" }; }, { kind: "hub" }, { openProject: async (p: string) => { opened.push(p); return "http://127.0.0.1:1/#token=x"; } });
    const a = await open(s.url, "tok");
    await until(a.msgs, (m) => m.type === "snapshot");
    a.ws.send(JSON.stringify({ type: "project.open", path: join(proj, "does-not-exist") }));
    const err = await until(a.msgs, (m) => m.type === "error" && m.ref === "project.open");
    expect(err.message).toMatch(/not a directory|does not exist/i);
    expect(opened).toEqual([]);
    a.ws.send(JSON.stringify({ type: "project.open", path: proj }));
    const ok = await until(a.msgs, (m) => m.type === "opened");
    expect(ok.url).toContain("#token=");
    expect(opened).toEqual([proj]);
    a.ws.close();
  });
});
