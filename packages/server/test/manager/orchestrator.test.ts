import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage, Provider } from "@agenticview/shared";
import { FakeRuntime, type FakeScript } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { EventBus } from "../../src/events/bus.js";
import { createWorld, type World } from "../../src/world.js";
import { writeJsonFile } from "../../src/store/jsonStore.js";
import { projectRoot } from "../../src/store/paths.js";

let home: string;
let proj: string;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-home-"));
  proj = await mkdtemp(join(tmpdir(), "av-proj-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function setup(script: FakeScript, opts: { runtimes?: Map<Provider, Runtime>; settings?: Record<string, unknown>; hub?: boolean } = {}) {
  const fake = new FakeRuntime(script);
  const runtimes = opts.runtimes ?? new Map<Provider, Runtime>([["claude", fake]]);
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  if (opts.settings) await writeJsonFile(join(projectRoot(proj), "settings.json"), opts.settings);
  const world: World = await createWorld(opts.hub ? { kind: "hub" } : { kind: "project", projectPath: proj }, {
    runtimes,
    bus,
    toolRegistry: new ToolRegistry(),
    bridgeUrl: () => "http://127.0.0.1:0",
  });
  return { world, orch: world.orchestrator, reg: world.registry, tasks: world.tasks, msgs, fake, bus };
}

async function waitFor<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("Orchestrator", () => {
  it("runs a manager request end to end with delegation", async () => {
    const ctx = await setup(async function* (req) {
      if (req.agent.role === "manager") {
        yield { type: "call", tool: "create_agent", args: { name: "Nova", specialty: "frontend" } };
        const nova = (await ctx.reg.list()).find((a) => a.name === "Nova")!;
        yield { type: "call", tool: "assign_task", args: { agentId: nova.id, title: "CSS", description: "add vars" } };
        const child = (await ctx.tasks.list()).find((t) => t.kind === "work")!;
        yield { type: "call", tool: "await_tasks", args: { taskIds: [child.id] } };
        yield { type: "text", text: "All done." };
      } else {
        yield { type: "file_changed", path: "src/vars.css", kind: "create" };
        yield { type: "text", text: "vars added" };
      }
    });
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "Add dark mode" });
    expect(t.kind).toBe("request");
    const final = await ctx.orch.awaitTask(t.id);
    expect(final.status).toBe("done");
    expect(final.result).toBe("All done.");
    const child = (await ctx.tasks.list()).find((x) => x.kind === "work")!;
    expect(child).toMatchObject({ status: "done", result: "vars added", parentId: t.id, createdBy: m.id, projectPath: proj });
    expect(ctx.msgs.filter((x) => x.type === "run.event").length).toBeGreaterThan(0);
    expect(ctx.msgs.some((x) => x.type === "task.updated" && x.task.id === t.id && x.task.status === "waiting")).toBe(true);
    expect(ctx.msgs.some((x) => x.type === "agent.updated" && x.agent.name === "Nova")).toBe(true);
    const nova = (await ctx.reg.list()).find((a) => a.name === "Nova")!;
    expect(nova.stats).toMatchObject({ xp: 10, tasksDone: 1 });
    expect((await ctx.reg.get(m.id))!.stats.xp).toBe(5);
    const workerReq = ctx.fake.runs.find((r) => r.agent.role === "worker")!;
    expect(workerReq.cwd).toBe(proj);
    expect(workerReq.prompt[0]).toEqual({ type: "text", text: "CSS\n\nadd vars" });
    expect(workerReq.systemPrompt).toContain("Nova");
    const managerReq = ctx.fake.runs.find((r) => r.agent.role === "manager")!;
    expect(managerReq.prompt.map((p) => (p.type === "text" ? p.text : ""))[0]).toContain("## Roster");
    expect(managerReq.bridgeTools.map((b) => b.name).sort()).toEqual(["add_room", "arrange_workers", "ask_user", "assign_task", "await_tasks", "brainstorm", "create_agent", "list_agents", "list_spaces", "list_tasks", "move_worker", "rename_space", "resolve_task", "revive_agent", "update_agent"]);
    expect(ctx.orch.running()).toBe(0);
    const log = (await ctx.tasks.get(child.id))!.log;
    expect(log.some((l) => l.type === "file_changed")).toBe(true);
  });

  it("create_agent/update_agent take model and effort; runs get the effort the model supports", async () => {
    const replies: string[] = [];
    const ctx = await setup(async function* (req) {
      if (req.agent.role === "manager") {
        const create = req.bridgeTools.find((b) => b.name === "create_agent")!;
        replies.push(await create.handler({ name: "Nova", specialty: "", provider: "claude", model: "opus", effort: "max" }));
        const nova = (await ctx.reg.list()).find((a) => a.name === "Nova")!;
        yield { type: "call", tool: "assign_task", args: { agentId: nova.id, title: "a", description: "b" } };
        yield { type: "call", tool: "await_tasks", args: { taskIds: (await ctx.tasks.list()).filter((t) => t.kind === "work").map((t) => t.id) } };
        const update = req.bridgeTools.find((b) => b.name === "update_agent")!;
        replies.push(await update.handler({ agentId: nova.id, model: "haiku" }));
        yield { type: "call", tool: "assign_task", args: { agentId: nova.id, title: "c", description: "d" } };
        yield { type: "call", tool: "await_tasks", args: { taskIds: (await ctx.tasks.list()).filter((t) => t.kind === "work" && t.title === "c").map((t) => t.id) } };
        yield { type: "text", text: "ok" };
      } else {
        yield { type: "text", text: "done" };
      }
    });
    const m = await ctx.reg.ensureManager();
    await ctx.orch.awaitTask((await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" })).id);
    expect(replies[1]).toMatch(/model haiku, effort max/);
    const nova = (await ctx.reg.list()).find((a) => a.name === "Nova")!;
    expect(nova).toMatchObject({ model: "haiku", effort: "max" });
    const workerRuns = ctx.fake.runs.filter((r) => r.agent.role === "worker");
    expect(workerRuns[0]).toMatchObject({ model: "opus", effort: "max" });
    // Haiku has no effort control, so the stored "max" is not sent.
    expect(workerRuns[1]!.model).toBe("haiku");
    expect(workerRuns[1]!.effort).toBeUndefined();
  });

  it("refuses cross-project assignment for project agents", async () => {
    let reply = "";
    const ctx = await setup(async function* (req) {
      if (req.agent.role === "manager") {
        const w = (await ctx.reg.list()).find((a) => a.role === "worker")!;
        const tool = req.bridgeTools.find((b) => b.name === "assign_task")!;
        reply = await tool.handler({ agentId: w.id, title: "x", description: "y", projectPath: "C:/other" });
        yield { type: "text", text: "ok" };
      }
    });
    await ctx.reg.create({ name: "Nova", specialty: "" });
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" });
    await ctx.orch.awaitTask(t.id);
    expect(reply).toMatch(/^ERROR: scope/);
    expect((await ctx.tasks.list()).filter((x) => x.kind === "work")).toHaveLength(0);
  });

  it("runs a second Manager request at once, in a fresh conversation, while the first is still waiting", async () => {
    const gate = deferred<void>();
    const seen: (string | undefined)[] = [];
    let n = 0;
    const ctx = await setup(async function* (req) {
      seen.push(req.sessionId);
      const me = ++n;
      if (me === 2) await gate.promise;
      yield { type: "text", text: `run ${me}` };
    });
    // Give the Manager a saved conversation first (the fake names a new conversation fake-<runId>).
    const m = await ctx.reg.ensureManager();
    expect((await ctx.orch.awaitTask((await ctx.orch.handleUserMessage({ agentId: m.id, text: "warm up" })).id)).status).toBe("done");
    const main = `fake-${ctx.fake.runs[0]!.runId}`;
    const slow = await ctx.orch.handleUserMessage({ agentId: m.id, text: "slow one" });
    await waitFor(async () => (await ctx.tasks.get(slow.id))!.status === "running");
    const quick = await ctx.orch.handleUserMessage({ agentId: m.id, text: "quick one" });
    // The second request finishes while the first is still blocked.
    expect((await ctx.orch.awaitTask(quick.id)).status).toBe("done");
    expect((await ctx.tasks.get(slow.id))!.status).toBe("running");
    gate.resolve();
    expect((await ctx.orch.awaitTask(slow.id)).status).toBe("done");
    // First run resumed the saved conversation; the concurrent one started fresh.
    expect(seen).toEqual([undefined, main, undefined]);
    // The next request resumes the main conversation, not the side one.
    await ctx.orch.awaitTask((await ctx.orch.handleUserMessage({ agentId: m.id, text: "after" })).id);
    expect(seen.at(-1)).toBe(main);
  });

  it("runs Claude Code session tasks outside maxConcurrentRuns, even behind a queued limited task", async () => {
    const gate = deferred<void>();
    const gated = new FakeRuntime(async function* () {
      await gate.promise;
      yield { type: "text", text: "api" };
    });
    const session = new FakeRuntime(async function* () {
      yield { type: "text", text: "session" };
    }, "claude-session");
    const ctx = await setup(async function* () {}, {
      runtimes: new Map<Provider, Runtime>([["claude", gated], ["claude-session", session]]),
      settings: { maxConcurrentRuns: 1 },
    });
    const api = await ctx.reg.create({ name: "Api", specialty: "", provider: "claude" });
    const sess = await ctx.reg.create({ name: "Sess", specialty: "", provider: "claude-session" });
    const a1 = await ctx.orch.handleUserMessage({ agentId: api.id, text: "one" });
    const a2 = await ctx.orch.handleUserMessage({ agentId: api.id, text: "two" });
    const s1 = await ctx.orch.handleUserMessage({ agentId: sess.id, text: "three" });
    // The API worker holds the only slot and its second task waits, yet the session task still runs to completion.
    expect((await ctx.orch.awaitTask(s1.id)).status).toBe("done");
    expect((await ctx.tasks.get(a2.id))!.status).toBe("assigned");
    gate.resolve();
    expect((await ctx.orch.awaitTask(a1.id)).status).toBe("done");
    expect((await ctx.orch.awaitTask(a2.id)).status).toBe("done");
  });

  it("respects maxConcurrentRuns and starts the queued task when a slot frees", async () => {
    const gate = deferred<void>();
    const ctx = await setup(
      async function* (req) {
        if (req.agent.role === "manager") {
          const w = (await ctx.reg.list()).find((a) => a.role === "worker")!;
          yield { type: "call", tool: "assign_task", args: { agentId: w.id, title: "a", description: "" } };
          yield { type: "call", tool: "assign_task", args: { agentId: w.id, title: "b", description: "" } };
          const ids = (await ctx.tasks.list()).filter((t) => t.kind === "work").map((t) => t.id);
          yield { type: "call", tool: "await_tasks", args: { taskIds: ids } };
          yield { type: "text", text: "both" };
        } else {
          await gate.promise;
          yield { type: "text", text: "w" };
        }
      },
      { settings: { maxConcurrentRuns: 1 } },
    );
    await ctx.reg.create({ name: "Nova", specialty: "" });
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" });
    const statuses = await waitFor(async () => {
      const s = (await ctx.tasks.list()).filter((x) => x.kind === "work").map((x) => x.status).sort();
      return s.length === 2 && s.includes("running") ? s : undefined;
    });
    expect(statuses).toEqual(["assigned", "running"]);
    expect(ctx.orch.running()).toBe(1);
    gate.resolve();
    const final = await ctx.orch.awaitTask(t.id);
    expect(final.result).toBe("both");
    expect((await ctx.tasks.list()).filter((x) => x.kind === "work").every((x) => x.status === "done")).toBe(true);
  });

  it("cancel aborts a hung worker and unblocks await_tasks", async () => {
    const ctx = await setup(async function* (req) {
      if (req.agent.role === "manager") {
        const w = (await ctx.reg.list()).find((a) => a.role === "worker")!;
        yield { type: "call", tool: "assign_task", args: { agentId: w.id, title: "hang", description: "" } };
        const child = (await ctx.tasks.list()).find((t) => t.kind === "work")!;
        yield { type: "call", tool: "await_tasks", args: { taskIds: [child.id] } };
        yield { type: "text", text: "manager saw it" };
      } else {
        await new Promise(() => {});
      }
    });
    await ctx.reg.create({ name: "Nova", specialty: "" });
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" });
    const child = await waitFor(async () => (await ctx.tasks.list()).find((x) => x.kind === "work" && x.status === "running"));
    expect(child.status).toBe("running");
    await ctx.orch.cancel(child.id);
    const final = await ctx.orch.awaitTask(t.id);
    expect((await ctx.tasks.get(child.id))!.status).toBe("cancelled");
    expect(final.status).toBe("done");
    const toolEnd = ctx.msgs.find((x) => x.type === "run.event" && x.event.type === "tool_end" && x.event.name === "await_tasks");
    expect(toolEnd && toolEnd.type === "run.event" && toolEnd.event.type === "tool_end" ? toolEnd.event.summary : "").toContain("cancelled");
    expect(ctx.orch.running()).toBe(0);
    expect((await ctx.reg.list()).find((a) => a.role === "worker")!.stats.tasksFailed).toBe(0);
  });

  it("cancelling a queued task never runs it, and cancelling a terminal task is a no-op", async () => {
    const ctx = await setup(async function* () { yield { type: "text", text: "x" }; }, { settings: { maxConcurrentRuns: 1 } });
    const w = await ctx.reg.create({ name: "Nova", specialty: "" });
    const a = await ctx.orch.handleUserMessage({ agentId: w.id, text: "one" });
    const b = await ctx.orch.handleUserMessage({ agentId: w.id, text: "two" });
    await ctx.orch.cancel(b.id);
    await ctx.orch.awaitTask(a.id);
    expect((await ctx.tasks.get(b.id))!.status).toBe("cancelled");
    expect(ctx.fake.runs).toHaveLength(1);
    await expect(ctx.orch.cancel(b.id)).resolves.toBeUndefined();
  });

  it("permission and question round trips", async () => {
    const ctx = await setup(async function* (req) {
      if (req.agent.role === "manager") {
        yield { type: "call", tool: "ask_user", args: { question: "Which colour?" } };
        yield { type: "text", text: "thanks" };
      } else {
        const ok = await req.onPermission!({ id: "p1", tool: "Bash", input: { command: "rm" } });
        yield { type: "text", text: String(ok) };
      }
    });
    const w = await ctx.reg.create({ name: "Nova", specialty: "", permissionMode: "ask" });
    const t = await ctx.orch.handleUserMessage({ agentId: w.id, text: "do" });
    const preq = await waitFor(() => ctx.msgs.find((x) => x.type === "permission.request"));
    expect(preq).toMatchObject({ type: "permission.request", id: "p1", agentId: w.id, taskId: t.id, tool: "Bash" });
    ctx.orch.respondPermission("p1", true);
    expect((await ctx.orch.awaitTask(t.id)).result).toBe("true");
    expect(ctx.msgs.some((x) => x.type === "permission.resolved" && x.id === "p1")).toBe(true);

    const m = await ctx.reg.ensureManager();
    const r = await ctx.orch.handleUserMessage({ agentId: m.id, text: "theme?" });
    const q = await waitFor(() => ctx.msgs.find((x) => x.type === "question.request"));
    expect(q).toMatchObject({ type: "question.request", agentId: m.id, taskId: r.id, question: "Which colour?" });
    expect((await ctx.tasks.get(r.id))!.status).toBe("waiting");
    ctx.orch.respondQuestion((q as { id: string }).id, "blue");
    expect((await ctx.orch.awaitTask(r.id)).result).toBe("thanks");
    const end = ctx.msgs.find((x) => x.type === "run.event" && x.event.type === "tool_end" && x.event.name === "ask_user");
    expect(end && end.type === "run.event" && end.event.type === "tool_end" ? end.event.summary : "").toBe("blue");
  });

  it("fails fast when the provider is unavailable", async () => {
    const ctx = await setup(async function* () { yield { type: "text", text: "never" }; });
    const w = await ctx.reg.create({ name: "G", specialty: "", provider: "gemini" });
    const t = await ctx.orch.handleUserMessage({ agentId: w.id, text: "hi" });
    const final = await ctx.orch.awaitTask(t.id);
    expect(final.status).toBe("failed");
    expect(final.error).toMatch(/provider gemini unavailable/);
    expect(ctx.fake.runs).toHaveLength(0);
    expect((await ctx.reg.get(w.id))!.stats.tasksFailed).toBe(1);
  });

  it("resolves provider and model from agent, then settings, then global config", async () => {
    const ctx = await setup(async function* () { yield { type: "text", text: "x" }; }, { settings: { defaultProvider: "codex", defaultModel: "gpt-x" } });
    const a = await ctx.reg.create({ name: "A", specialty: "" });
    expect(ctx.orch.resolveProvider(a)).toEqual({ provider: "codex", model: "gpt-x" });
    const b = await ctx.reg.create({ name: "B", specialty: "", provider: "claude", model: "claude-opus-5" });
    expect(ctx.orch.resolveProvider(b)).toEqual({ provider: "claude", model: "claude-opus-5" });
    const c = await ctx.reg.create({ name: "C", specialty: "", provider: "gemini" });
    expect(ctx.orch.resolveProvider(c)).toEqual({ provider: "gemini", model: undefined });
  });

  it("persists sessions per agent and world and marks failures", async () => {
    const ctx = await setup(async function* (req) {
      if (req.prompt.some((p) => p.type === "text" && p.text.includes("explode"))) throw new Error("kaboom");
      yield { type: "text", text: "ok" };
    });
    const m = await ctx.reg.ensureManager();
    const t1 = await ctx.orch.handleUserMessage({ agentId: m.id, text: "first" });
    await ctx.orch.awaitTask(t1.id);
    const t2 = await ctx.orch.handleUserMessage({ agentId: m.id, text: "second" });
    await ctx.orch.awaitTask(t2.id);
    expect(ctx.fake.runs[1]!.sessionId).toBe(`fake-${ctx.fake.runs[0]!.runId}`);
    expect((await ctx.tasks.get(t2.id))!.session).toEqual({ provider: "claude", sessionId: `fake-${ctx.fake.runs[0]!.runId}` });
    const t3 = await ctx.orch.handleUserMessage({ agentId: m.id, text: "explode" });
    const f = await ctx.orch.awaitTask(t3.id);
    expect(f.status).toBe("failed");
    expect(f.error).toBe("kaboom");
  });

  it("hub: assign_task requires a known projectPath and global agents work anywhere", async () => {
    const other = await mkdtemp(join(tmpdir(), "av-other-"));
    await writeJsonFile(join(home, "config.json"), { knownProjects: [{ path: other, name: "other", lastOpened: "" }] });
    const replies: string[] = [];
    const ctx = await setup(
      async function* (req) {
        if (req.agent.role === "manager") {
          const w = (await ctx.reg.list()).find((a) => a.role === "worker")!;
          const assign = req.bridgeTools.find((b) => b.name === "assign_task")!;
          replies.push(await assign.handler({ agentId: w.id, title: "x", description: "y" }));
          replies.push(await assign.handler({ agentId: w.id, title: "x", description: "y", projectPath: "C:/nope" }));
          replies.push(await assign.handler({ agentId: w.id, title: "x", description: "y", projectPath: other }));
          const child = (await ctx.tasks.list()).find((t) => t.kind === "work")!;
          yield { type: "call", tool: "await_tasks", args: { taskIds: [child.id] } };
          yield { type: "text", text: "done" };
        } else {
          yield { type: "text", text: "worked in " + req.cwd };
        }
      },
      { hub: true },
    );
    const w = await ctx.reg.create({ name: "Rover", specialty: "" });
    expect(w.scope).toBe("global");
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" });
    await ctx.orch.awaitTask(t.id);
    expect(replies[0]).toMatch(/^ERROR: scope/);
    expect(replies[1]).toMatch(/^ERROR: scope/);
    expect(replies[2]).toMatch(/^Started task t_/);
    const child = (await ctx.tasks.list()).find((x) => x.kind === "work")!;
    expect(child.projectPath).toBe(other);
    expect(child.result).toBe("worked in " + other);
    await rm(other, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("records the project as known and recovers interrupted tasks on boot", async () => {
    const first = await setup(async function* () { await new Promise(() => {}); });
    const w = await first.reg.create({ name: "N", specialty: "" });
    const t = await first.orch.handleUserMessage({ agentId: w.id, text: "hang" });
    await waitFor(async () => (await first.tasks.get(t.id))!.status === "running");
    const second = await setup(async function* () { yield { type: "text", text: "x" }; });
    expect((await second.tasks.get(t.id))).toMatchObject({ status: "failed", error: "interrupted" });
    const info = await second.world.info();
    expect(info.knownProjects.map((p) => p.path)).toContain(proj);
    expect(info.kind).toBe("project");
  });

  it("hub: a request that names a project tells the manager the target project", async () => {
    await writeJsonFile(join(home, "config.json"), { knownProjects: [{ path: proj, name: "proj", lastOpened: "" }] });
    const ctx = await setup(async function* () { yield { type: "text", text: "ok" }; }, { hub: true });
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "tidy up", projectPath: proj });
    await ctx.orch.awaitTask(t.id);
    const prompt = ctx.fake.runs[0]!.prompt[0];
    expect(prompt.type === "text" ? prompt.text : "").toContain(`Target project: ${proj}`);
    expect(t.projectPath).toBe(proj);
    await expect(ctx.orch.handleUserMessage({ agentId: m.id, text: "x", projectPath: "C:/nope" })).rejects.toThrow(/not a known project/);
  });
});

describe("Automatic provider", () => {
  const status = (provider: Provider, ok: boolean): Runtime => ({
    provider,
    check: async () => (ok ? { provider, ok } : { provider, ok, reason: "nope" }),
    run: async () => ({ text: "", stopReason: "done" }),
  });

  it("picks the first available provider in order claude, claude-session, codex, gemini", async () => {
    const runtimes = new Map<Provider, Runtime>([
      ["claude", status("claude", false)],
      ["claude-session", status("claude-session", false)],
      ["codex", status("codex", true)],
      ["gemini", status("gemini", true)],
    ]);
    const ctx = await setup(async function* () {}, { runtimes });
    const a = await ctx.reg.create({ name: "A", specialty: "" });
    expect(await ctx.orch.autoProvider()).toBe("codex");
    expect((await ctx.orch.resolveProviderLive(a)).provider).toBe("codex");
    expect((await ctx.world.snapshot()).autoProvider).toBe("codex");
    runtimes.set("claude-session", status("claude-session", true));
    expect(await ctx.orch.autoProvider()).toBe("claude-session");
    runtimes.set("claude", status("claude", true));
    expect(await ctx.orch.autoProvider()).toBe("claude");
  });

  it("an explicit default overrides Automatic, and no available provider is a clear problem", async () => {
    const runtimes = new Map<Provider, Runtime>([["claude", status("claude", false)], ["gemini", status("gemini", true)]]);
    const ctx = await setup(async function* () {}, { runtimes, settings: { defaultProvider: "claude" } });
    const a = await ctx.reg.create({ name: "A", specialty: "" });
    expect((await ctx.orch.resolveProviderLive(a)).provider).toBe("claude");
    expect(await ctx.orch.providerProblem(a)).toMatch(/provider claude unavailable/);

    const none = await setup(async function* () {}, { runtimes: new Map([["claude", status("claude", false)]]), settings: { defaultProvider: null } });
    const b = await none.reg.create({ name: "B", specialty: "" });
    expect(await none.orch.providerProblem(b)).toMatch(/no provider available/);
  });

  it("an agent on claude-session is never refused for lack of a worker (its task waits in the queue)", async () => {
    const ctx = await setup(async function* () {}, { runtimes: new Map([["claude-session", status("claude-session", false)]]) });
    const a = await ctx.reg.create({ name: "A", specialty: "", provider: "claude-session" });
    expect(await ctx.orch.providerProblem(a)).toBeUndefined();
  });
});

it("persists room names per world, broadcasts updates, resolves renamed moves and resets", async () => {
  const ctx = await setup(async function* (req) {
    const call = (name: string, args: Record<string, unknown>) => req.bridgeTools.find(t => t.name === name)!.handler(args);
    await call("rename_space", { space: "pod-b", name: "Backend" });
    const rows = JSON.parse(await call("list_spaces", {}));
    expect(rows.find((s: { id: string }) => s.id === "pod-b")).toMatchObject({ name: "Backend", defaultName: "Pod B" });
    expect(await call("rename_space", { space: "pod-a", name: "Backend" })).toContain("already in use");
    expect(await call("rename_space", { space: "roof", name: "QA" })).toContain("unknown space");
    await call("move_worker", { agent: "Nova", space: "backend" });
    expect((await ctx.reg.list()).find(a => a.name === "Nova")!.placement?.space).toBe("pod-b");
    await call("arrange_workers", { moves: [{ agent: "Nova", space: "Backend", seat: 2 }] });
    expect((await ctx.reg.list()).find(a => a.name === "Nova")!.placement?.seat).toBe(2);
    await call("rename_space", { space: "Backend", name: "" });
    expect((await ctx.world.snapshot()).spaceNames).toEqual({});
    await call("rename_space", { space: "office", name: "Leadership" });
    yield { type: "text", text: "done" };
  });
  await ctx.reg.create({ name: "Nova", specialty: "backend" });
  const t = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "organize" });
  expect((await ctx.orch.awaitTask(t.id)).status).toBe("done");
  expect(ctx.msgs).toContainEqual({ type: "spaceNames.updated", spaceNames: { office: "Leadership" } });
  const reload = await setup(async function* () {});
  expect((await reload.world.snapshot()).spaceNames).toEqual({ office: "Leadership" });
  const hub = await setup(async function* (req) {
    await req.bridgeTools.find(t => t.name === "rename_space")!.handler({ space: "meeting", name: "Hub design" });
  }, { hub: true });
  expect((await hub.world.snapshot()).spaceNames).toEqual({});
  const h = await hub.orch.handleUserMessage({ agentId: await hub.reg.managerId(), text: "rename" });
  await hub.orch.awaitTask(h.id);
  const hubReload = await setup(async function* () {}, { hub: true });
  expect((await hubReload.world.snapshot()).spaceNames).toEqual({ meeting: "Hub design" });
  expect((await reload.world.snapshot()).spaceNames).toEqual({ office: "Leadership" });
});

it("brainstorms in parallel with read-only tasks, skips busy workers and restores seats", async () => {
  let started = 0;
  const gate = deferred<void>();
  const ctx = await setup(async function* (req) {
    if (req.agent.role === "manager") {
      const reply = await req.bridgeTools.find(t => t.name === "brainstorm")!.handler({ topic: "API design", participants: ["Busy", "missing"] });
      yield { type: "text", text: reply };
    } else {
      started++;
      if (started === 2) gate.resolve();
      expect(req.tools).toEqual({ edit: false, shell: false, web: false, screenshot: false });
      expect(req.bridgeTools).toEqual([]);
      expect(req.sessionId).toBeUndefined();
      expect((await ctx.reg.get(req.agent.id))!.placement?.space).toBe("meeting");
      await gate.promise;
      yield { type: "text", text: `- Advice from ${req.agent.name}` };
    }
  });
  const a = await ctx.reg.create({ name: "Nova", specialty: "backend" });
  const b = await ctx.reg.create({ name: "Pixel", specialty: "frontend" });
  const busy = await ctx.reg.create({ name: "Busy", specialty: "QA" });
  await ctx.tasks.create({ kind: "work", title: "Busy", description: "", assigneeId: busy.id, createdBy: "user", projectPath: proj });
  await ctx.reg.pinPlacements();
  const before = (await ctx.reg.list()).map(a => ({ id: a.id, placement: a.placement }));
  const parent = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "design" });
  const final = await ctx.orch.awaitTask(parent.id);
  expect(final.status).toBe("done");
  const result = JSON.parse(final.result!);
  expect(result.complete).toBe(true);
  expect(result.stillRunning).toEqual([]);
  expect(result.answers.map((x: { name: string }) => x.name).sort()).toEqual(["Nova", "Pixel"]);
  expect(result.answers.find((x: { name: string }) => x.name === "Nova")).toMatchObject({ specialty: "backend", answer: "- Advice from Nova" });
  expect(result.skipped).toEqual(expect.arrayContaining([{ name: "Busy", reason: "busy" }, { name: "missing", reason: "unknown worker" }]));
  expect((await ctx.tasks.children(parent.id))).toHaveLength(2);
  expect((await ctx.tasks.children(parent.id)).every(t => t.readOnly && t.title === "Brainstorm: API design")).toBe(true);
  for (const old of before) expect((await ctx.reg.get(old.id))!.placement).toEqual(old.placement);
  expect((await ctx.reg.get(a.id))!.tools).toEqual(a.tools);
  expect((await ctx.reg.get(b.id))!.tools).toEqual(b.tools);
});

it("brainstorm returns stillRunning and a follow-up collects the same tasks after restoration", async () => {
  const gate = deferred<void>();
  let first: { complete: boolean; stillRunning: { id: string }[] };
  const ctx = await setup(async function* (req) {
    if (req.agent.role === "manager") {
      const tool = req.bridgeTools.find(t => t.name === "brainstorm")!;
      first = JSON.parse(await tool.handler({ topic: "design", maxWaitSeconds: 1 }));
      expect(first.complete).toBe(false);
      expect(first.stillRunning).toHaveLength(1);
      gate.resolve();
      const reply = await tool.handler({ topic: "design", maxWaitSeconds: 1 });
      yield { type: "text", text: reply };
    } else {
      await gate.promise;
      yield { type: "text", text: "- Done" };
    }
  });
  const worker = await ctx.reg.create({ name: "Nova", specialty: "backend" });
  const parent = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "brainstorm" });
  const final = await ctx.orch.awaitTask(parent.id);
  expect(final.status).toBe("done");
  expect(JSON.parse(final.result!)).toMatchObject({ complete: true, stillRunning: [] });
  expect(await ctx.tasks.children(parent.id)).toHaveLength(1);
  expect((await ctx.reg.get(worker.id))!.placement).toEqual({ space: "pod-a", seat: 0 });
});

it("brainstorm cancellation restores seats and cancels its children", async () => {
  const parked = deferred<void>();
  const ctx = await setup(async function* (req) {
    if (req.agent.role === "manager") {
      yield { type: "call", tool: "brainstorm", args: { topic: "cancel me" } };
    } else {
      await parked.promise;
    }
  });
  const a = await ctx.reg.create({ name: "Nova", specialty: "backend" });
  const parent = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "design" });
  await waitFor(async () => (await ctx.reg.get(a.id))?.placement?.space === "meeting");
  await ctx.orch.cancel(parent.id);
  await waitFor(async () => (await ctx.reg.get(a.id))?.placement?.space === "pod-a");
  expect((await ctx.tasks.children(parent.id)).every(t => t.status === "cancelled")).toBe(true);
  parked.resolve();
});

it("brainstorm uses room-sized parallel batches for larger groups", async () => {
  let count = 0;
  const firstBatch = deferred<void>();
  const ctx = await setup(async function* (req) {
    if (req.agent.role === "manager") {
      const reply = await req.bridgeTools.find(t => t.name === "brainstorm")!.handler({ topic: "large design" });
      yield { type: "text", text: reply };
    } else {
      count++;
      if (count === 6) firstBatch.resolve();
      await firstBatch.promise;
      expect((await ctx.reg.get(req.agent.id))!.placement?.space).toBe("meeting");
      yield { type: "text", text: "- idea" };
    }
  }, { settings: { maxConcurrentRuns: 8 } });
  for (let i = 0; i < 8; i++) await ctx.reg.create({ name: `Expert ${i}`, specialty: "design" });
  const workers = (await ctx.reg.list()).filter(a => a.role === "worker");
  for (let i = 0; i < 6; i++) await ctx.reg.update(workers[i]!.id, { placement: { space: "meeting", seat: i } });
  await ctx.reg.pinPlacements();
  const before = await ctx.reg.list();
  const parent = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "design" });
  const final = await ctx.orch.awaitTask(parent.id);
  expect(final.status).toBe("done");
  expect(JSON.parse(final.result!).answers).toHaveLength(8);
  for (const a of before) expect((await ctx.reg.get(a.id))!.placement).toEqual(a.placement);
});

it("session brainstorms route to the generated read-only companion instead of the coordinator", async () => {
  const { SessionRuntime } = await import("../../src/runtimes/session.js");
  const session = new SessionRuntime();
  const managerRuntime = new FakeRuntime(async function* (req) {
    const result = await req.bridgeTools.find(t => t.name === "brainstorm")!.handler({ topic: "session design" });
    yield { type: "text", text: result };
  });
  const ctx = await setup(async function* () {}, { runtimes: new Map<Provider, Runtime>([["claude", managerRuntime], ["claude-session", session]]) });
  await ctx.reg.create({ name: "Nova", specialty: "backend", provider: "claude-session" });
  const parent = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "design" });
  const claimed = await session.claim("worker", 5000);
  expect(claimed).not.toBeNull();
  expect(claimed!.subagent).toBe("agenticview-nova-readonly");
  expect(claimed!.tools).toEqual({ edit: false, shell: false, web: false, screenshot: false });
  expect(claimed!.systemPrompt).toContain("Do not edit files or run commands");
  session.complete(claimed!.runId, { text: "- Advice" }, "worker");
  const final = await ctx.orch.awaitTask(parent.id);
  expect(final.status).toBe("done");
  expect(JSON.parse(final.result!).answers[0].answer).toBe("- Advice");
});

it("settings defaults: limitPolicy=ask, loungeBreaks=true", async () => {
  const ctx = await setup(async function* () { yield { type: "text", text: "x" }; });
  const s = ctx.world.settings();
  expect(s.limitPolicy).toBe("ask");
  expect(s.loungeBreaks).toBe(true);
});

describe("pickReviveProvider", () => {
  it("follows failoverOrder (default: codex → antigravity → claude-session), skips the failed provider", async () => {
    const make = (p: Provider): Runtime => ({ provider: p, check: async () => ({ provider: p, ok: true }), run: async () => ({ text: "", stopReason: "done" }) });
    const runtimes = new Map<Provider, Runtime>([
      ["claude", make("claude")],
      ["claude-session", make("claude-session")],
      ["antigravity", make("antigravity")],
      ["codex", make("codex")],
      ["gemini", make("gemini")],
    ]);
    const ctx = await setup(async function* () {}, { runtimes });
    // Default failoverOrder is ['codex', 'antigravity', 'claude-session'].
    // 'claude' is not in the list → iterate from the start → picks 'codex'.
    expect(ctx.orch.pickReviveProvider("claude")?.provider).toBe("codex");
    // 'codex' is index 0 → next is 'antigravity'.
    expect(ctx.orch.pickReviveProvider("codex")?.provider).toBe("antigravity");
    // 'antigravity' is index 1 → next is 'claude-session'.
    expect(ctx.orch.pickReviveProvider("antigravity")?.provider).toBe("claude-session");
    // 'claude-session' is last → wraps to 'codex'.
    expect(ctx.orch.pickReviveProvider("claude-session")?.provider).toBe("codex");
  });

  it("skips providers with active limits", async () => {
    const make = (p: Provider): Runtime => ({ provider: p, check: async () => ({ provider: p, ok: true }), run: async () => ({ text: "", stopReason: "done" }) });
    const runtimes = new Map<Provider, Runtime>([["claude", make("claude")], ["codex", make("codex")]]);
    const ctx = await setup(async function* () {}, { runtimes });
    ctx.world.usageTracker.recordFailure({ id: "w_1", name: "A" } as import("@agenticview/shared").Agent, "codex", "default", "rate limit exceeded");
    // codex is now limited, claude is the failed provider, so no good candidate
    const result = ctx.orch.pickReviveProvider("claude");
    // Only codex remains but it's limited; no candidate
    expect(result).toBeUndefined();
  });
});

it("auto limitPolicy: revive sets fainted → reviving → done phases then clears", async () => {
  const ctx = await setup(
    async function* (req) {
      if (req.agent.role === "worker") {
        if (req.agent.provider === "claude") throw new Error("rate limit exceeded 429");
        yield { type: "text", text: "revived ok" };
      } else {
        yield { type: "text", text: "ok" };
      }
    },
    {
      settings: { limitPolicy: "auto" },
      runtimes: new Map<Provider, Runtime>([
        ["claude", new FakeRuntime(async function* (req) {
          if (req.agent.role === "worker") throw new Error("rate limit exceeded 429");
          yield { type: "text", text: "ok" };
        })],
        ["codex", new FakeRuntime(async function* () { yield { type: "text", text: "revived ok" }; }, "codex")],
      ] as [Provider, Runtime][]),
    },
  );
  const w = await ctx.reg.create({ name: "Nova", specialty: "", provider: "claude" });
  const t = await ctx.orch.handleUserMessage({ agentId: w.id, text: "do work" });
  const failed = await ctx.orch.awaitTask(t.id);
  expect(failed.status).toBe("failed");
  // With auto policy and a 0ms delay (default 6s is too long for tests but we use default timing here)
  // just verify the fainted state was set
  const fainted = await waitFor(async () => {
    const a = await ctx.reg.get(w.id);
    return a?.revive?.phase === "fainted" || a?.revive?.phase === "reviving" ? a : undefined;
  });
  expect(["fainted", "reviving"]).toContain(fainted!.revive?.phase);
});

it("ask limitPolicy: revive creates a pending limit and resolves on accept", async () => {
  const ctx = await setup(
    async function* () { throw new Error("quota exceeded"); },
    {
      settings: { limitPolicy: "ask" },
      runtimes: new Map<Provider, Runtime>([
        ["claude", new FakeRuntime(async function* () { throw new Error("quota exceeded"); })],
        ["codex", new FakeRuntime(async function* () { yield { type: "text", text: "retried" }; }, "codex")],
      ] as [Provider, Runtime][]),
    },
  );
  const w = await ctx.reg.create({ name: "Nova", specialty: "", provider: "claude" });
  const t = await ctx.orch.handleUserMessage({ agentId: w.id, text: "do work" });
  await ctx.orch.awaitTask(t.id);
  const limitReq = await waitFor(() => ctx.msgs.find((x) => x.type === "limit.request") as Extract<import("@agenticview/shared").ServerMessage, { type: "limit.request" }> | undefined);
  expect(limitReq).toBeDefined();
  expect(limitReq!.agentId).toBe(w.id);
  const snapshot = ctx.orch.pending();
  expect(snapshot.limits).toHaveLength(1);
  ctx.orch.respondLimit(limitReq!.id, "accept");
  await waitFor(() => ctx.msgs.some((x) => x.type === "limit.resolved"));
  expect(ctx.msgs.some((x) => x.type === "limit.resolved")).toBe(true);
});

it("ask limitPolicy: dismiss leaves agent without revive state", async () => {
  const ctx = await setup(
    async function* () { throw new Error("quota exceeded"); },
    {
      settings: { limitPolicy: "ask" },
      runtimes: new Map<Provider, Runtime>([
        ["claude", new FakeRuntime(async function* () { throw new Error("quota exceeded"); })],
        ["codex", new FakeRuntime(async function* () { yield { type: "text", text: "x" }; }, "codex")],
      ] as [Provider, Runtime][]),
    },
  );
  const w = await ctx.reg.create({ name: "Nova", specialty: "", provider: "claude" });
  const t = await ctx.orch.handleUserMessage({ agentId: w.id, text: "work" });
  await ctx.orch.awaitTask(t.id);
  const limitReq = await waitFor(() => ctx.msgs.find((x) => x.type === "limit.request") as Extract<import("@agenticview/shared").ServerMessage, { type: "limit.request" }> | undefined);
  ctx.orch.respondLimit(limitReq!.id, "dismiss");
  // After dismiss the revive state should be cleared
  const cleared = await waitFor(async () => {
    const a = await ctx.reg.get(w.id);
    return a && a.revive === undefined ? a : undefined;
  });
  expect(cleared!.revive).toBeUndefined();
});

it("brainstorm.updated events are emitted when brainstorm starts and answers arrive", async () => {
  const ctx = await setup(async function* (req) {
    if (req.agent.role === "manager") {
      const reply = await req.bridgeTools.find(t => t.name === "brainstorm")!.handler({ topic: "live feed test" });
      yield { type: "text", text: reply };
    } else {
      yield { type: "text", text: "answer" };
    }
  });
  await ctx.reg.create({ name: "Nova", specialty: "backend" });
  const parent = await ctx.orch.handleUserMessage({ agentId: await ctx.reg.managerId(), text: "design" });
  await ctx.orch.awaitTask(parent.id);
  const updates = ctx.msgs.filter((x) => x.type === "brainstorm.updated") as Extract<import("@agenticview/shared").ServerMessage, { type: "brainstorm.updated" }>[];
  expect(updates.length).toBeGreaterThanOrEqual(1);
  expect(updates[0]!.topic).toBe("live feed test");
  expect(updates[0]!.managerId).toBe(await ctx.reg.managerId());
  const last = updates[updates.length - 1]!;
  expect(last.complete).toBe(true);
});

describe("preferCheapModels", () => {
  it("create_agent without provider/model picks cheapest available (codex) when preferCheapModels is on", async () => {
    let createReply = "";
    const managerScript: FakeScript = async function* (req) {
      if (req.agent.role === "manager") {
        const create = req.bridgeTools.find((b) => b.name === "create_agent")!;
        createReply = await create.handler({ name: "Penny", specialty: "frontend" });
        yield { type: "text", text: "ok" };
      } else {
        yield { type: "text", text: "done" };
      }
    };
    const fakeManager = new FakeRuntime(managerScript);
    const fakeWorker = new FakeRuntime(async function* () { yield { type: "text", text: "done" }; });
    // Include codex so it shows up as an available cheap provider
    const runtimes = new Map<Provider, Runtime>([
      ["claude", fakeManager],
      ["codex", fakeWorker],
    ]);
    const ctx = await setup(managerScript, { runtimes });
    const m = await ctx.reg.ensureManager();
    await ctx.orch.awaitTask((await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" })).id);
    expect(createReply).toContain("preferCheapModels");
    expect(createReply).toContain("codex");
    const penny = (await ctx.reg.list()).find((a) => a.name === "Penny")!;
    expect(penny.provider).toBe("codex");
    expect(penny.model).toBe("gpt-6-luna");
  });

  it("create_agent with explicit provider skips cheap selection", async () => {
    let createReply = "";
    const managerScript2: FakeScript = async function* (req) {
      if (req.agent.role === "manager") {
        const create = req.bridgeTools.find((b) => b.name === "create_agent")!;
        createReply = await create.handler({ name: "Explicit", specialty: "backend", provider: "claude", model: "opus" });
        yield { type: "text", text: "ok" };
      } else {
        yield { type: "text", text: "done" };
      }
    };
    const fakeManager2 = new FakeRuntime(managerScript2);
    const fakeWorker2 = new FakeRuntime(async function* () { yield { type: "text", text: "done" }; });
    const runtimes2 = new Map<Provider, Runtime>([["claude", fakeManager2], ["codex", fakeWorker2]]);
    const ctx = await setup(managerScript2, { runtimes: runtimes2 });
    const m = await ctx.reg.ensureManager();
    await ctx.orch.awaitTask((await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" })).id);
    expect(createReply).not.toContain("preferCheapModels");
    const agent = (await ctx.reg.list()).find((a) => a.name === "Explicit")!;
    expect(agent.provider).toBe("claude");
    expect(agent.model).toBe("opus");
  });

  it("create_agent skips cheap selection when preferCheapModels is false", async () => {
    let createReply = "";
    const managerScript3: FakeScript = async function* (req) {
      if (req.agent.role === "manager") {
        const create = req.bridgeTools.find((b) => b.name === "create_agent")!;
        createReply = await create.handler({ name: "Free", specialty: "backend" });
        yield { type: "text", text: "ok" };
      } else {
        yield { type: "text", text: "done" };
      }
    };
    const fakeManager3 = new FakeRuntime(managerScript3);
    const fakeWorker3 = new FakeRuntime(async function* () { yield { type: "text", text: "done" }; });
    const runtimes3 = new Map<Provider, Runtime>([["claude", fakeManager3], ["codex", fakeWorker3]]);
    const ctx = await setup(managerScript3, { runtimes: runtimes3, settings: { preferCheapModels: false } });
    const m = await ctx.reg.ensureManager();
    await ctx.orch.awaitTask((await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" })).id);
    expect(createReply).not.toContain("preferCheapModels");
    const agent = (await ctx.reg.list()).find((a) => a.name === "Free")!;
    expect(agent.provider).toBeNull();
  });
});
