import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttp } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Provider, ServerMessage } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { SessionRuntime } from "../../src/runtimes/session.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { instanceFile } from "../../src/instances.js";
import { bridge, cleanSessionId, complete, nextTask, postJson, report, resetWorkerState } from "../../src/worker-mcp.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
const saved = { home: process.env.AGENTICVIEW_HOME, project: process.env.AGENTICVIEW_PROJECT, chunk: process.env.AGENTICVIEW_AWAIT_CHUNK_SECONDS };
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-p-"));
  process.env.AGENTICVIEW_HOME = home;
  resetWorkerState();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = saved.home;
  if (saved.project === undefined) delete process.env.AGENTICVIEW_PROJECT;
  else process.env.AGENTICVIEW_PROJECT = saved.project;
  if (saved.chunk === undefined) delete process.env.AGENTICVIEW_AWAIT_CHUNK_SECONDS;
  else process.env.AGENTICVIEW_AWAIT_CHUNK_SECONDS = saved.chunk;
  await rm(home, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function waitFor<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function boot() {
  server = await createServer({
    world: { kind: "project", projectPath: proj },
    token: "tok",
    runtimes: new Map<Provider, Runtime>([["claude-session", new SessionRuntime()]]),
    workerTools: () => [],
  });
  const s = server;
  const call = async (session: string, path: string, body: unknown = {}) => {
    const res = await fetch(`${s.url}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-agenticview-token": "tok", "x-agenticview-worker": session }, body: JSON.stringify(body) });
    return (await res.json()) as any;
  };
  return { s, call };
}

describe("Claude Code session registry and affinity (HTTP)", () => {
  it("binds an agent to the session that served it and keeps the binding and session across an office restart", async () => {
    let { s, call } = await boot();
    const nova = await s.world.registry.create({ name: "Nova", specialty: "", provider: "claude-session" });
    const t1 = await s.orchestrator.handleUserMessage({ agentId: nova.id, text: "one" });
    const c1 = await call("sess-A", "/api/worker/claim", { waitMs: 3000, session: { model: "claude-opus-5-5[1m]", cwd: proj } });
    expect(c1.task.session).toMatchObject({ id: "sess-A", model: "claude-opus-5-5[1m]" });
    expect(await call("sess-A", `/api/worker/${c1.task.runId}/complete`, { text: "ok" })).toEqual({ ok: true });
    await waitFor(async () => (await s.world.tasks.get(t1.id))?.status === "done");
    expect((await s.world.registry.get(nova.id))?.session).toMatchObject({ id: "sess-A" });
    const sessions = await s.world.sessions();
    expect(sessions).toMatchObject([{ id: "sess-A", model: "claude-opus-5-5[1m]", online: true, agentIds: [nova.id] }]);
    const file = JSON.parse(await readFile(join(proj, ".agenticview", "worker-sessions.json"), "utf8"));
    expect(file.sessions[0]).toMatchObject({ id: "sess-A", model: "claude-opus-5-5[1m]" });

    // Restart the office: fresh runtime, same store.
    await s.close();
    ({ s, call } = await boot());
    expect((await s.world.snapshot()).sessions).toMatchObject([{ id: "sess-A", online: false, agentIds: [nova.id] }]);
    await s.orchestrator.handleUserMessage({ agentId: nova.id, text: "two" });
    await waitFor(async () => (await s.world.tasks.list()).some((t) => t.description === "two" && t.status === "running"));
    // Another session cannot take Nova's task; sess-A (resumed) can.
    expect((await call("sess-B", "/api/worker/claim", { waitMs: 300 })).task).toBeNull();
    const c2 = await call("sess-A", "/api/worker/claim", { waitMs: 3000 });
    expect(c2.task.prompt).toBe("two");
  });

  it("releases a task waiting on an offline session when the office unbinds the agent", async () => {
    const { s, call } = await boot();
    const nova = await s.world.registry.create({ name: "Nova", specialty: "", provider: "claude-session" });
    await call("sess-A", "/api/worker/claim", { waitMs: 0 });
    await s.world.registry.update(nova.id, { session: { id: "sess-A", name: "A" } });
    const events: ServerMessage[] = [];
    s.bus.on((m) => events.push(m));
    await s.orchestrator.handleUserMessage({ agentId: nova.id, text: "job" });
    const pending = call("sess-B", "/api/worker/claim", { waitMs: 4000 });
    await new Promise((r) => setTimeout(r, 200));
    // "Use any session" in the office = agent.update with session null (broadcast as agent.updated).
    const agent = await s.world.registry.update(nova.id, { session: null });
    s.bus.emit({ type: "agent.updated", agent });
    expect((await pending).task?.prompt).toBe("job");
    expect((await s.world.registry.get(nova.id))?.session?.id).toBe("sess-B");
    expect(events.some((e) => e.type === "sessions.updated")).toBe(true);
  });

  it("guards a Manager against waiting on a task queued for its own session, and chunks long await_tasks", async () => {
    process.env.AGENTICVIEW_AWAIT_CHUNK_SECONDS = "1";
    const { s, call } = await boot();
    const manager = await s.world.registry.ensureManager();
    await s.world.registry.update(manager.id, { provider: "claude-session" });
    const orion = await s.world.registry.create({ name: "Orion", specialty: "", provider: "claude-session" });
    await s.orchestrator.handleUserMessage({ agentId: manager.id, text: "plan it" });
    const m = await call("sess-M", "/api/worker/claim", { waitMs: 3000 });
    const runId = m.task.runId as string;
    expect(m.task.bridgeTools.map((t: { name: string }) => t.name)).toContain("await_tasks");

    // Unbound worker: fine to assign; await_tasks returns early with stillRunning (no other session).
    const assigned = await call("sess-M", `/api/worker/${runId}/bridge`, { name: "assign_task", args: { agentId: orion.id, title: "t", description: "do" } });
    expect(assigned.result).toMatch(/^Started task/);
    const taskId = /Started task (\S+)/.exec(assigned.result)![1]!;
    const waited = await call("sess-M", `/api/worker/${runId}/bridge`, { name: "await_tasks", args: { taskIds: [taskId] } });
    expect(JSON.parse(waited.result)).toMatchObject({ stillRunning: [{ id: taskId }], message: expect.stringContaining("await_tasks again") });

    // Bound to the manager's own session with a free slot beside the manager: fine (a subagent runs it).
    await s.world.registry.update(orion.id, { session: { id: "sess-M", name: "M" } });
    const ok = await call("sess-M", `/api/worker/${runId}/bridge`, { name: "await_tasks", args: { taskIds: [taskId] } });
    expect(ok.result).not.toMatch(/deadlock/);
    // Capacity 1: the manager holds the only slot, so both tools refuse with a clear message.
    await s.world.sessionRuntime!.setCapacity("sess-M", 1);
    const again = await call("sess-M", `/api/worker/${runId}/bridge`, { name: "await_tasks", args: { taskIds: [taskId] } });
    expect(again.result).toMatch(/deadlock/);
    expect(again.result).toContain("open another Claude Code session");
    expect(again.result).toContain("raise that session's capacity");
    const assign2 = await call("sess-M", `/api/worker/${runId}/bridge`, { name: "assign_task", args: { agentId: orion.id, title: "t2", description: "do" } });
    expect(assign2.result).toMatch(/^ERROR: Orion is bound to Claude Code session/);
    // Let the manager run end so nothing writes into the project while it is removed.
    await s.orchestrator.cancel(m.task.taskId);
    await new Promise((r) => setTimeout(r, 100));
  });

  it("rename and forget over the session list", async () => {
    const { s, call } = await boot();
    const nova = await s.world.registry.create({ name: "Nova", specialty: "", provider: "claude-session", session: { id: "sess-A" } });
    await call("sess-A", "/api/worker/claim", { waitMs: 0 });
    await s.world.sessionRuntime!.rename("sess-A", "Main tab");
    expect((await s.world.sessions())[0]).toMatchObject({ name: "Main tab", agentIds: [nova.id] });
    await s.world.sessionRuntime!.forget("sess-A");
    expect(await s.world.sessions()).toEqual([]);
  });
});

describe("worker MCP tools", () => {
  it("forward the session id, model and named agent, and report/complete as that session", async () => {
    const { s } = await boot();
    const file = instanceFile(proj);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ pid: process.pid, url: s.url, token: "tok", projectPath: proj, startedAt: "" }));
    process.env.AGENTICVIEW_PROJECT = proj;
    const nova = await s.world.registry.create({ name: "Nova", specialty: "", provider: "claude-session", model: "opus" });
    const task = await s.orchestrator.handleUserMessage({ agentId: nova.id, text: "hello" });
    const out = await nextTask({ session_id: "3f2a-session", model: "claude-sonnet-5", agent: "Nova", wait_seconds: 5 });
    const text = out.content[0]!.text;
    expect(text).toContain("hello");
    // The agent's subagent runs on its own model, so no mismatch note; the task names the subagent.
    expect(text).not.toContain("MODEL MISMATCH");
    expect(text).toContain("agenticview-nova");
    expect(text).toContain("subagent runs on opus");
    expect(await readFile(join(proj, ".claude", "agents", "agenticview-nova.md"), "utf8")).toContain("model: opus");
    expect((await s.world.registry.get(nova.id))?.session?.id).toBe("3f2a-session");
    expect(s.world.sessionRuntime!.session("3f2a-session")).toMatchObject({ model: "claude-sonnet-5", cwd: proj });
    expect((await report({ text: "working" })).isError).toBeUndefined();
    expect((await bridge({ tool: "nope" })).content[0]!.text).toMatch(/ERROR/);
    expect((await complete({ result: "done" })).isError).toBeUndefined();
    await waitFor(async () => (await s.world.tasks.get(task.id))?.status === "done");
  });

  it("ignores an unsubstituted session id placeholder", () => {
    expect(cleanSessionId("${CLAUDE_SESSION_ID}")).toBeUndefined();
    expect(cleanSessionId(" 0b6f1c7e-1111-2222-3333-444444444444 ")).toBe("0b6f1c7e-1111-2222-3333-444444444444");
  });

  it("posts with node:http so slow responses are not cut off by fetch's header timeout", async () => {
    const slow = createHttp((req, res) => {
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, header: req.headers["x-test"] }));
      }, 1200);
    });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", () => r()));
    const port = (slow.address() as { port: number }).port;
    try {
      const res = await postJson<{ ok: boolean; header: string }>(`http://127.0.0.1:${port}/x`, { "x-test": "y" }, { a: 1 });
      expect(res).toEqual({ status: 200, json: { ok: true, header: "y" } });
      await expect(postJson(`http://127.0.0.1:${port}/x`, {}, {}, AbortSignal.timeout(100))).rejects.toThrow();
    } finally {
      slow.closeAllConnections();
      await new Promise((r) => slow.close(r));
    }
  });
});
