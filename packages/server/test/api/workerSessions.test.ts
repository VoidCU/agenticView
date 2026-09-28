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
const saved = { home: process.env.AGENTICVIEW_HOME, project: process.env.AGENTICVIEW_PROJECT };
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
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  }, 60000);

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

  it("a session Manager hands out work and completes, freeing its slot; the office wakes it with the results", async () => {
    const { s, call } = await boot();
    const manager = await s.world.registry.ensureManager();
    await s.world.registry.update(manager.id, { provider: "claude-session" });
    const orion = await s.world.registry.create({ name: "Orion", specialty: "", provider: "claude-session" });
    const req = await s.orchestrator.handleUserMessage({ agentId: manager.id, text: "plan it" });
    const m = await call("sess-M", "/api/worker/claim", { waitMs: 3000 });
    // Capacity 1 with the worker bound to the Manager's own session: no deadlock, since the Manager does not wait.
    await s.world.sessionRuntime!.setCapacity("sess-M", 1);
    await s.world.registry.update(orion.id, { session: { id: "sess-M", name: "M" } });
    const runId = m.task.runId as string;
    expect(m.task.bridgeTools.map((t: { name: string }) => t.name)).not.toContain("await_tasks");
    expect(m.task.systemPrompt).toContain("Never wait for workers");
    const assigned = await call("sess-M", `/api/worker/${runId}/bridge`, { name: "assign_task", args: { agentId: orion.id, title: "t", description: "do" } });
    expect(assigned.result).toMatch(/^Started task/);
    await call("sess-M", `/api/worker/${runId}/complete`, { text: "Orion is on it." });
    await waitFor(async () => (await s.world.tasks.get(req.id))?.status === "delegated");
    // The freed slot takes Orion's task.
    const w = await call("sess-M", "/api/worker/claim", { waitMs: 3000 });
    expect(w.task.prompt).toContain("do");
    await call("sess-M", `/api/worker/${w.task.runId}/complete`, { text: "did it" });
    // Then the Manager is woken with the outcome, as a new run on the session.
    const wake = await call("sess-M", "/api/worker/claim", { waitMs: 3000 });
    expect(wake.task.taskId).toBe(req.id);
    expect(wake.task.prompt).toMatch(/## Worker results[^]*"t" by Orion: done[^]*did it/);
    await call("sess-M", `/api/worker/${wake.task.runId}/complete`, { text: "Report: done." });
    expect((await s.orchestrator.awaitTask(req.id)).result).toBe("Report: done.");
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
    expect(text).toContain("inherited from this Claude Code session (claude-sonnet-5)");
    expect(await readFile(join(proj, ".claude", "agents", "agenticview-nova.md"), "utf8")).toContain("model: inherit");
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
