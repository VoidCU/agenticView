import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Provider } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { SessionRuntime } from "../../src/runtimes/session.js";
import type { Runtime } from "../../src/runtimes/types.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  const session = new SessionRuntime();
  const echoed: string[] = [];
  server = await createServer({
    world: { kind: "project", projectPath: proj },
    token: "tok",
    runtimes: new Map<Provider, Runtime>([["claude-session", session]]),
    workerTools: () => [{ name: "echo", description: "Echo back", schema: { s: z.string() }, handler: async (a) => (echoed.push(String(a.s)), `echo:${String(a.s)}`) }],
  });
  const s = server;
  const call = async (path: string, body: unknown = {}, token = "tok") => {
    const res = await fetch(`${s.url}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-agenticview-token": token, "x-agenticview-worker": "w-test" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { s, session, call, echoed };
}

describe("session worker API", () => {
  it("rejects calls without the launch token", async () => {
    const { call } = await boot();
    expect((await call("/api/worker/claim", { waitMs: 0 }, "nope")).status).toBe(401);
  });

  it("queues a task with no worker, then a worker claims, reports, calls a bridge tool and completes it", async () => {
    const { s, call, echoed } = await boot();
    const agent = await s.world.registry.create({ name: "Nova", specialty: "tests", provider: "claude-session" });
    expect(await s.orchestrator.providerProblem(agent)).toBeUndefined();
    const task = await s.orchestrator.handleUserMessage({ agentId: agent.id, text: "Write the thing" });
    await waitFor(async () => (await s.world.tasks.get(task.id))?.status === "running");

    // With nobody polling the provider is "unavailable" but the task waits instead of failing.
    const snap = await s.world.snapshot();
    expect(snap.providers.find((p) => p.provider === "claude-session")).toMatchObject({ ok: false });
    expect(snap.autoProvider).toBeNull();

    const { json: claimed } = await call("/api/worker/claim", { waitMs: 5000 });
    expect(claimed.task).toMatchObject({ cwd: proj, agent: { name: "Nova" } });
    expect(claimed.task.prompt).toContain("Write the thing");
    const runId = claimed.task.runId as string;
    expect(claimed.task.bridgeTools.map((t: { name: string }) => t.name)).toContain("echo");
    expect((await s.world.snapshot()).providers.find((p) => p.provider === "claude-session")).toMatchObject({ ok: true, version: "1 worker" });

    expect((await call(`/api/worker/${runId}/report`, { events: [{ type: "text", text: "halfway" }] })).json).toEqual({ ok: true });
    expect((await call(`/api/worker/${runId}/bridge`, { name: "echo", args: { s: "hey" } })).json).toEqual({ ok: true, result: "echo:hey" });
    expect(echoed).toEqual(["hey"]);
    expect((await call(`/api/worker/${runId}/bridge`, { name: "echo", args: {} })).json).toMatchObject({ ok: false, error: expect.stringContaining("Invalid arguments") });
    expect((await call(`/api/worker/${runId}/complete`, { text: "Finished." })).json).toEqual({ ok: true });

    const done = await waitFor(async () => {
      const t = await s.world.tasks.get(task.id);
      return t?.status === "done" ? t : undefined;
    });
    expect(done.result).toBe("Finished.");
    expect((await call(`/api/worker/${runId}/report`, { events: [] })).json).toMatchObject({ ok: false });
  });

  it("cancelling a claimed task tells the worker to stop", async () => {
    const { s, call } = await boot();
    const agent = await s.world.registry.create({ name: "Nova", specialty: "", provider: "claude-session" });
    const task = await s.orchestrator.handleUserMessage({ agentId: agent.id, text: "long job" });
    const { json } = await call("/api/worker/claim", { waitMs: 5000 });
    expect(json.task).toBeTruthy();
    await s.orchestrator.cancel(task.id);
    await waitFor(async () => (await call(`/api/worker/${json.task.runId}/report`, { events: [] })).json.cancelled === true);
  });
});
