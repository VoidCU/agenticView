import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAgent, type Agent, type Provider, type ServerMessage, type Task } from "@agenticview/shared";
import { FakeRuntime, type FakeScript } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { SessionRuntime } from "../../src/runtimes/session.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { EventBus } from "../../src/events/bus.js";
import { createWorld, type World } from "../../src/world.js";
import { writeJsonFile } from "../../src/store/jsonStore.js";
import { projectRoot } from "../../src/store/paths.js";
import { MANAGER_SYSTEM_PROMPT, managerTools, validateTier, type ManagerToolContext } from "../../src/manager/tools.js";
import { AgentMemory, MEMORY_CAP, memoryBlock, outcomeOf, type MemoryRecord } from "../../src/agents/memory.js";

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

async function setup(runtimes: Map<Provider, Runtime>, settings?: Record<string, unknown>) {
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  if (settings) await writeJsonFile(join(projectRoot(proj), "settings.json"), settings);
  const world: World = await createWorld({ kind: "project", projectPath: proj }, { runtimes, bus, toolRegistry: new ToolRegistry(), bridgeUrl: () => "http://127.0.0.1:0" });
  return { world, orch: world.orchestrator, reg: world.registry, tasks: world.tasks, msgs, bus };
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

const textOf = (t: { prompt: { type: string; text?: string }[] }) => t.prompt.map((p) => p.text ?? "").join("\n");

function toolCtx(world: World, extra: Partial<ManagerToolContext> = {}): ManagerToolContext {
  return {
    world: world.ref,
    registry: world.registry,
    tasks: world.tasks,
    requestTask: { id: "t_req" } as Task,
    managerId: "m",
    knownProjects: () => [],
    startTask: () => undefined,
    awaitTask: async () => ({}) as Task,
    askUser: async () => "",
    setWaiting: async () => undefined,
    emitAgent: (a) => world.bus.emit({ type: "agent.updated", agent: a }),
    checkProvider: async () => undefined,
    sessions: () => world.sessions(),
    providerOf: async (a) => (await world.orchestrator.resolveProviderLive(a)).provider,
    ...extra,
  };
}

const call = (tools: ReturnType<typeof managerTools>, name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args);

describe("claude-session agents inherit the session's model and effort", () => {
  it("never stores a model or effort, and the wire agent carries the serving session's model", async () => {
    const rt = new SessionRuntime();
    const { world, reg } = await setup(new Map<Provider, Runtime>([["claude-session", rt]]));
    await rt.claimMany("s-opus", { waitMs: 0, info: { model: "claude-opus-5-5" } });
    const a = await reg.create({ name: "Nova", specialty: "ui", provider: "claude-session", model: "opus", effort: "high", session: { id: "s-opus", name: "Opus tab" } });
    expect(a.model).toBeNull();
    expect(a.effort).toBeNull();
    const up = await reg.update(a.id, { model: "sonnet", effort: "max", sessionModel: "leak" });
    expect(up.model).toBeNull();
    expect(up.effort).toBeNull();
    expect(up.sessionModel).toBeUndefined();
    const wire = world.decorate({ type: "agent.updated", agent: up });
    expect(wire.type === "agent.updated" && wire.agent.sessionModel).toBe("claude-opus-5-5");
    // Other providers keep theirs and get no sessionModel.
    const c = await reg.create({ name: "Cody", specialty: "", provider: "codex", model: "gpt-6-luna", effort: "medium" });
    expect(c.model).toBe("gpt-6-luna");
    const w2 = world.decorate({ type: "snapshot", ...(await world.snapshot()) });
    expect(w2.type === "snapshot" && w2.agents.find((x) => x.id === c.id)?.sessionModel).toBeUndefined();
  });

  it("migrates stored claude-session model/effort away on office start and writes model: inherit", async () => {
    const rt = new SessionRuntime();
    const first = await setup(new Map<Provider, Runtime>([["claude-session", rt]]));
    const legacy = defaultAgent({ name: "Old", role: "worker", scope: "project", specialty: "", provider: "claude-session", model: "opus", effort: "max" });
    await writeJsonFile(join(projectRoot(proj), "agents", `${legacy.id}.json`), legacy);
    void first;
    const { reg } = await setup(new Map<Provider, Runtime>([["claude-session", new SessionRuntime()]]));
    const got = await reg.get(legacy.id);
    expect(got?.model).toBeNull();
    expect(got?.effort).toBeNull();
    const file = await readFile(join(proj, ".claude", "agents", "agenticview-old.md"), "utf8");
    expect(file).toContain("model: inherit");
  });

  it("create_agent and update_agent ignore model/effort for claude-session and say so", async () => {
    const { world } = await setup(new Map<Provider, Runtime>([["claude-session", new SessionRuntime()]]));
    const tools = managerTools(toolCtx(world));
    const out = await call(tools, "create_agent", { name: "Nova", specialty: "ui", provider: "claude-session", model: "opus", effort: "high" });
    expect(out).toContain("model/effort ignored");
    const nova = (await world.registry.list()).find((a) => a.name === "Nova")!;
    expect(nova.model).toBeNull();
    const up = await call(tools, "update_agent", { agentId: nova.id, model: "sonnet" });
    expect(up).toContain("model/effort ignored");
    expect((await world.registry.get(nova.id))!.model).toBeNull();
  });
});

describe("routing across Claude Code sessions", () => {
  it("list_sessions reports model, capacity, load and bound agents; assign_session rebinds and re-dispatches", async () => {
    const rt = new SessionRuntime();
    const { world, reg, orch } = await setup(new Map<Provider, Runtime>([["claude-session", rt]]));
    await rt.claimMany("s-opus", { waitMs: 0, info: { model: "claude-opus-5-5" } });
    await rt.claimMany("s-sonnet", { waitMs: 0, info: { model: "claude-sonnet-5" } });
    await rt.rename("s-opus", "Opus tab");
    await rt.rename("s-sonnet", "Sonnet tab");
    const nova = await reg.create({ name: "Nova", specialty: "arch", provider: "claude-session", session: { id: "s-sonnet", name: "Sonnet tab" } });
    const tools = managerTools(toolCtx(world));
    const list = JSON.parse(await call(tools, "list_sessions", {})) as Record<string, unknown>[];
    const son = list.find((s) => s.name === "Sonnet tab")!;
    expect(son).toMatchObject({ model: "claude-sonnet-5", capacity: 4, load: 0, freeSlots: 4, online: true });
    expect(son.boundAgents).toEqual([{ id: nova.id, name: "Nova" }]);
    const agents = JSON.parse(await call(tools, "list_agents", {})) as Record<string, unknown>[];
    expect(agents.find((a) => a.name === "Nova")).toMatchObject({ model: "session: claude-sonnet-5" });

    // A queued task for Nova waits on the Sonnet session; move Nova to Opus and the Opus session gets it.
    const task = await orch.handleUserMessage({ agentId: nova.id, text: "design the module" });
    const out = await call(tools, "assign_session", { agent: "nova", session: "Opus tab" });
    expect(out).toContain('session "Opus tab" (model claude-opus-5-5');
    expect((await reg.get(nova.id))!.session?.id).toBe("s-opus");
    const claimed = await rt.claimMany("s-opus", { waitMs: 2000 });
    expect(claimed.tasks[0]?.taskId).toBe(task.id);

    expect(await call(tools, "assign_session", { agent: nova.id, session: "nope" })).toContain("ERROR: unknown session");
    expect(await call(tools, "assign_session", { agent: nova.id, session: "any" })).toContain("any free session");
    expect((await reg.get(nova.id))!.session).toBeNull();
    expect(MANAGER_SYSTEM_PROMPT).toContain("list_sessions");
    expect(MANAGER_SYSTEM_PROMPT).toContain("strongest-model session");
  });
});

describe("per-task model tiers", () => {
  const agent = defaultAgent({ name: "Cody", role: "worker", scope: "project", specialty: "", provider: "codex", model: "gpt-6-luna" });
  it("validates model and effort against the catalogue", () => {
    expect(validateTier("codex", agent, "gpt-6-sol", "high")).toMatchObject({ ok: true, tier: { provider: "codex", model: "gpt-6-sol", effort: "high" } });
    expect(validateTier("codex", agent, "gpt-9", undefined)).toMatchObject({ ok: false });
    expect(validateTier("codex", agent, undefined, "minimal")).toMatchObject({ ok: false });
    expect(validateTier("antigravity", agent, "gemini-3.8-flash-high", "high")).toMatchObject({ ok: true, tier: { model: "gemini-3.8-flash-high" } });
    const s = validateTier("claude-session", agent, "opus", "high");
    expect(s.ok && s.tier).toBeFalsy();
    expect(s.ok && s.note).toContain("ignored");
    expect(validateTier("codex", agent, undefined, undefined)).toEqual({ ok: true, note: "" });
  });

  it("assign_task with model/effort runs that task on the tier, later tasks on the agent default", async () => {
    const codex = new FakeRuntime(async function* () {
      yield { type: "text", text: "ok." };
    }, "codex");
    const { world, reg, tasks, orch } = await setup(new Map<Provider, Runtime>([["codex", codex]]));
    const cody = await reg.create({ name: "Cody", specialty: "", provider: "codex", model: "gpt-6-luna", effort: "medium" });
    const tools = managerTools(toolCtx(world, { startTask: (id) => orch.startTask(id) }));
    const out = await call(tools, "assign_task", { agentId: cody.id, title: "hard", description: "d", model: "gpt-6-sol", effort: "high" });
    expect(out).toContain("gpt-6-sol");
    await waitFor(async () => (await tasks.list()).find((t) => t.title === "hard" && t.status === "done"));
    expect(codex.runs[0]!.model).toBe("gpt-6-sol");
    expect(codex.runs[0]!.effort).toBe("high");
    expect(await call(tools, "assign_task", { agentId: cody.id, title: "bad", description: "d", model: "nope" })).toContain("ERROR");
    await call(tools, "assign_task", { agentId: cody.id, title: "easy", description: "d" });
    await waitFor(async () => (await tasks.list()).find((t) => t.title === "easy" && t.status === "done"));
    expect(codex.runs[1]!.model).toBe("gpt-6-luna");
    expect(codex.runs[1]!.effort).toBe("medium");
  });
});

describe("agent memory", () => {
  it("summarises outcomes in up to three sentences and caps the store", async () => {
    expect(outcomeOf("Lots of log.\n\nChanged a.ts. Added tests. All green. Extra sentence.")).toBe("Changed a.ts. Added tests. All green.");
    const mem = new AgentMemory((p) => join(p, "mem"));
    for (let i = 0; i < MEMORY_CAP + 5; i++) {
      await mem.append(proj, "w1", { taskId: `t${i}`, title: `T${i}`, status: "done", outcome: "", files: [], provider: "codex", model: null, at: new Date(2026, 0, 1, 0, i).toISOString() });
    }
    const all = await mem.list(proj, "w1");
    expect(all).toHaveLength(MEMORY_CAP);
    expect(all[0]!.taskId).toBe("t5");
    const recent = await mem.recent(proj, "w1");
    expect(recent.map((r) => r.taskId)).toEqual(["t104", "t103", "t102", "t101", "t100"]);
    const block = memoryBlock([{ ...recent[0]!, outcome: "did it" } as MemoryRecord], "t104");
    expect(block).toContain("earlier attempt of THIS task");
  });

  it("an agent switched from one provider to another continues from its memory", async () => {
    const claude = new FakeRuntime(async function* () {
      yield { type: "file_changed", path: "src/header.tsx", kind: "create" };
      yield { type: "text", text: "Built the header component. Tests pass." };
    }, "claude");
    const codex = new FakeRuntime(async function* () {
      yield { type: "text", text: "Continued." };
    }, "codex");
    const { world, reg, tasks, orch } = await setup(new Map<Provider, Runtime>([["claude", claude], ["codex", codex]]));
    const nova = await reg.create({ name: "Nova", specialty: "frontend (React)", provider: "claude", model: "sonnet" });
    const t1 = await orch.handleUserMessage({ agentId: nova.id, text: "build the header" });
    await waitFor(async () => (await tasks.get(t1.id))?.status === "done");
    expect(textOf(claude.runs[0]!)).toContain("You are Nova, expert in frontend (React).");
    await waitFor(async () => (await readFile(join(proj, ".agenticview", "memory", `${nova.id}.jsonl`), "utf8").catch(() => "")).includes("header"));
    await world.switchAgent(nova.id, { provider: "codex", model: "gpt-6-luna" });
    const t2 = await orch.handleUserMessage({ agentId: nova.id, text: "now the footer" });
    await waitFor(async () => (await tasks.get(t2.id))?.status === "done");
    const p = textOf(codex.runs[0]!);
    expect(p).toContain("You are Nova, expert in frontend (React).");
    expect(p).toContain("## Your recent work");
    expect(p).toContain("Built the header component. Tests pass.");
    expect(p).toContain("claude/sonnet");
    expect(p).toContain("src/header.tsx");
  });
});

describe('limit policy "manager"', () => {
  it("fails over automatically, briefs the Manager in its next preamble and keeps an Inbox entry; the retry sees the earlier attempt", async () => {
    const codex = new FakeRuntime(async function* () {
      yield { type: "text", text: "Started refactor of api.ts." };
      throw new Error("You exceeded your current quota, please check your plan");
    }, "codex");
    const agy = new FakeRuntime(async function* () {
      yield { type: "text", text: "Finished." };
    }, "antigravity");
    const mgr = new FakeRuntime(async function* () {
      yield { type: "text", text: "noted" };
    }, "claude");
    const { reg, tasks, orch, msgs } = await setup(new Map<Provider, Runtime>([["codex", codex], ["antigravity", agy], ["claude", mgr]]), {
      limitPolicy: "manager",
      failoverOrder: ["codex", "antigravity"],
    });
    (orch as unknown as { deps: { reviveDelayMs: number; reviveClearMs: number } }).deps.reviveDelayMs = 0;
    (orch as unknown as { deps: { reviveDelayMs: number; reviveClearMs: number } }).deps.reviveClearMs = 0;
    const cody = await reg.create({ name: "Cody", specialty: "backend", provider: "codex", model: "gpt-6-luna" });
    const t = await orch.handleUserMessage({ agentId: cody.id, text: "refactor api.ts" });
    await waitFor(async () => agy.runs.length > 0 && (await tasks.get(t.id))?.status === "done");
    expect((await reg.get(cody.id))!.provider).toBe("antigravity");
    expect(textOf(agy.runs[0]!)).toContain("earlier attempt of THIS task");
    expect(textOf(agy.runs[0]!)).toContain("quota");
    const notes = orch.peekProviderNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Cody .* hit codex limit at .*; now on antigravity\/gemini-3.8-flash-high via failover/);
    expect(msgs.some((m) => m.type === "limit.request" && m.agentId === cody.id)).toBe(true);
    expect(orch.pending().limits).toHaveLength(1);
    // The Manager's next request carries the note once.
    const m = await reg.ensureManager();
    const req = await orch.handleUserMessage({ agentId: m.id, text: "status?" });
    await waitFor(async () => (await tasks.get(req.id))?.status === "done");
    expect(textOf(mgr.runs[0]!)).toContain("## Provider notes");
    expect(textOf(mgr.runs[0]!)).toContain("hit codex limit");
    expect(orch.peekProviderNotes()).toHaveLength(0);
  });
});


describe('limit policy "manager": Atlas moves the agent and retries', () => {
  it("on a limit note the Manager calls update_agent (new provider+model) and retry_task; the retried run uses them", async () => {
    const codex = new FakeRuntime(async function* () {
      yield { type: "text", text: "Started." };
      throw new Error("You exceeded your current quota, please check your plan");
    }, "codex");
    const agy = new FakeRuntime(async function* () {
      yield { type: "text", text: "Finished on antigravity." };
    }, "antigravity");
    const mgr = new FakeRuntime(async function* () {
      yield { type: "text", text: "noted" };
    }, "claude");
    // Nothing to fail over to (codex only): nothing is switched automatically, the Manager decides.
    const { world, reg, tasks, orch, msgs } = await setup(new Map<Provider, Runtime>([["codex", codex], ["antigravity", agy], ["claude", mgr]]), {
      limitPolicy: "manager",
      failoverOrder: ["codex"],
    });
    (orch as unknown as { deps: { reviveClearMs: number } }).deps.reviveClearMs = 0;
    const cody = await reg.create({ name: "Cody", specialty: "backend", provider: "codex", model: "gpt-6-luna" });
    const t = await orch.handleUserMessage({ agentId: cody.id, text: "refactor api.ts" });
    await waitFor(async () => (await tasks.get(t.id))?.status === "failed" && (await reg.get(cody.id))?.revive?.phase === "fainted");
    // The scene walks the agent to the Manager's desk: the revive state says it was a limit on codex.
    const reporting = (await reg.get(cody.id))!.revive!;
    expect(reporting).toMatchObject({ phase: "fainted", cause: "limit", failedProvider: "codex", failedTaskId: t.id });
    expect(orch.pending().limits).toHaveLength(1);

    // Atlas gets the provider note in its next preamble.
    const m = await reg.ensureManager();
    const req = await orch.handleUserMessage({ agentId: m.id, text: "status?" });
    await waitFor(async () => (await tasks.get(req.id))?.status === "done");
    expect(textOf(mgr.runs[0]!)).toMatch(/Cody .* hit codex limit .* no failover provider available/);

    // Atlas analyses and moves Cody to antigravity on the strong tier, then retries the failed task.
    const tools = managerTools(toolCtx(world, { startTask: (id) => orch.startTask(id), reviveAgent: (id, p, mo) => orch.reviveAgent(id, p, mo) }));
    expect(await call(tools, "update_agent", { agentId: cody.id, provider: "antigravity", model: "gemini-3.1-pro-high" })).toContain("provider antigravity, model gemini-3.1-pro-high");
    expect(await call(tools, "retry_task", { taskId: t.id })).toContain("limit cleared");
    await waitFor(async () => (await tasks.get(t.id))?.status === "done");
    expect(agy.runs).toHaveLength(1);
    expect(agy.runs[0]!.model).toBe("gemini-3.1-pro-high");
    expect(codex.runs).toHaveLength(1);
    const after = (await reg.get(cody.id))!;
    expect(after.provider).toBe("antigravity");
    expect(after.limit).toBeUndefined();
    // The Inbox item is closed by the Manager's decision, and the scene saw the switch.
    expect(orch.pending().limits).toHaveLength(0);
    expect(msgs.some((mm) => mm.type === "limit.resolved")).toBe(true);
    expect(msgs.some((mm) => mm.type === "agent.updated" && mm.agent.id === cody.id && mm.agent.revive?.phase === "done" && mm.agent.revive.switchTo?.provider === "antigravity")).toBe(true);
    await waitFor(async () => (await reg.get(cody.id))?.revive === undefined);
  }, 60000);
});

void (null as unknown as Agent);
