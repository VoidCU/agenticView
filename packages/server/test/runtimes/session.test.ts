import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defaultAgent, type RunEvent } from "@agenticview/shared";
import { SessionRuntime, SESSION_WORKER_HINT } from "../../src/runtimes/session.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const agent = defaultAgent({ name: "Nova", role: "worker", scope: "project", specialty: "tests" });
const req = (runId: string, extra: Partial<RunRequest> = {}): RunRequest => ({
  runId,
  agent,
  cwd: "/proj",
  prompt: [{ type: "text", text: "do it" }, { type: "image", path: "/tmp/a.png" }],
  systemPrompt: "You are Nova",
  tools: { edit: false, shell: true, web: false, screenshot: false },
  bridgeTools: [{ name: "echo", description: "Echo", schema: { s: z.string() }, handler: async (a) => String(a.s) }],
  bridgeToken: "btok",
  permissionMode: "auto-edit",
  model: "opus",
  ...extra,
});

describe("SessionRuntime", () => {
  it("is unavailable until a worker polls, then reports the worker count, and expires stale workers", async () => {
    let now = 1_000_000;
    const changes: number[] = [];
    const rt = new SessionRuntime({ now: () => now, liveMs: 60_000 });
    rt.onWorkersChanged = () => changes.push(rt.workers());
    expect(await rt.check()).toEqual({ provider: "claude-session", ok: false, reason: SESSION_WORKER_HINT });
    expect(await rt.claim("w1", 0)).toBeNull();
    expect(await rt.check()).toMatchObject({ ok: true, version: "1 session worker connected" });
    await rt.claim("w2", 0);
    expect((await rt.check()).version).toBe("2 session workers connected");
    now += 61_000;
    expect((await rt.check()).ok).toBe(false);
    expect(changes).toEqual([1, 2]);
  });

  it("queues a run until claimed, streams reports into the sink, and resolves on complete", async () => {
    const rt = new SessionRuntime();
    const events: RunEvent[] = [];
    const done = rt.run(req("r1"), (e) => events.push(e), new AbortController().signal);
    expect(rt.queued()).toBe(1);
    expect(events[0]).toMatchObject({ type: "status", text: expect.stringContaining("/agenticview-work") });

    const task = await rt.claim("w1", 1000);
    expect(task).toMatchObject({
      runId: "r1",
      cwd: "/proj",
      systemPrompt: "You are Nova",
      prompt: "do it",
      images: ["/tmp/a.png"],
      model: "opus",
      tools: { edit: false, shell: true },
      agent: { name: "Nova", specialty: "tests" },
    });
    expect(task!.bridgeTools[0]).toMatchObject({ name: "echo", inputSchema: { type: "object" } });
    expect(rt.queued()).toBe(0);

    expect(rt.report("r1", [{ type: "text", text: "working" }, { type: "tool_start", name: "Bash", input: { command: "ls" } }, { type: "tool_end", name: "Bash", summary: "ok" }, { type: "file_changed", path: "a.ts" }, { type: "bogus" } as never], "w1")).toEqual({ ok: true });
    expect(rt.bridgeAccess("r1", "w1")).toEqual({ token: "btok" });
    expect(rt.complete("r1", { text: "all done" }, "w1")).toEqual({ ok: true });
    const res = await done;
    expect(res).toEqual({ text: "all done", stopReason: "done" });
    expect(events.map((e) => e.type)).toEqual(["status", "status", "text", "tool_start", "tool_end", "file_changed", "text"]);
    expect(events).toContainEqual({ type: "file_changed", path: "a.ts", kind: "modify" });
    expect(rt.report("r1", [], "w1")).toMatchObject({ ok: false, error: expect.stringContaining("Unknown or finished") });
  });

  it("hands a waiting worker the run as soon as it is queued", async () => {
    const rt = new SessionRuntime();
    const claim = rt.claim("w1", 5000);
    const done = rt.run(req("r2"), () => undefined, new AbortController().signal);
    expect((await claim)?.runId).toBe("r2");
    rt.complete("r2", { error: "could not" });
    expect(await done).toMatchObject({ stopReason: "error", error: "could not" });
  });

  it("serves runs in FIFO order, one per claim", async () => {
    const rt = new SessionRuntime();
    const sig = new AbortController().signal;
    void rt.run(req("a"), () => undefined, sig);
    void rt.run(req("b"), () => undefined, sig);
    expect((await rt.claim("w1", 0))?.runId).toBe("a");
    expect((await rt.claim("w2", 0))?.runId).toBe("b");
    expect(await rt.claim("w3", 0)).toBeNull();
  });

  it("abort removes a queued run and tells the worker of a claimed run to stop", async () => {
    const rt = new SessionRuntime();
    const ac1 = new AbortController();
    const queued = rt.run(req("q"), () => undefined, ac1.signal);
    ac1.abort();
    expect(await queued).toMatchObject({ stopReason: "aborted" });
    expect(rt.queued()).toBe(0);
    expect(await rt.claim("w1", 0)).toBeNull();

    const ac2 = new AbortController();
    const claimed = rt.run(req("c"), () => undefined, ac2.signal);
    await rt.claim("w1", 0);
    ac2.abort();
    expect(await claimed).toMatchObject({ stopReason: "aborted" });
    expect(rt.report("c", [{ type: "text", text: "still going" }], "w1")).toMatchObject({ ok: false, cancelled: true });
    expect(rt.complete("c", { text: "x" }, "w1")).toMatchObject({ ok: false, cancelled: true });
    expect(rt.bridgeAccess("c", "w1")).toMatchObject({ ok: false, cancelled: true });
  });

  it("a claim long-poll returns null after its wait and can be cut short by its signal", async () => {
    const rt = new SessionRuntime();
    const t0 = Date.now();
    expect(await rt.claim("w1", 50)).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
    const ac = new AbortController();
    const p = rt.claim("w1", 60_000, ac.signal);
    ac.abort();
    expect(await p).toBeNull();
    // The dropped waiter must not swallow the next run.
    void rt.run(req("z"), () => undefined, new AbortController().signal);
    expect((await rt.claim("w2", 0))?.runId).toBe("z");
  });
});
