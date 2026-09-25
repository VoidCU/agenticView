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
  await rm(home, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
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
    expect(managerReq.bridgeTools.map((b) => b.name).sort()).toEqual(["ask_user", "assign_task", "await_tasks", "create_agent", "list_agents", "list_tasks"]);
    expect(ctx.orch.running()).toBe(0);
    const log = (await ctx.tasks.get(child.id))!.log;
    expect(log.some((l) => l.type === "file_changed")).toBe(true);
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
    await rm(other, { recursive: true, force: true });
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
