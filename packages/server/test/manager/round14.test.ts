import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Provider, ServerMessage, Task } from "@agenticview/shared";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { EventBus } from "../../src/events/bus.js";
import { createWorld, type World } from "../../src/world.js";
import { MANAGER_SYSTEM_PROMPT, managerTools, type ManagerToolContext } from "../../src/manager/tools.js";
import { findReplacement } from "../../src/tasks/retryGuard.js";

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

async function setup() {
  const codex = new FakeRuntime(async function* () {
    yield { type: "text", text: "codex done" };
  }, "codex");
  const agy = new FakeRuntime(async function* () {
    yield { type: "text", text: "agy done" };
  }, "antigravity");
  const runtimes = new Map<Provider, Runtime>([["codex", codex], ["antigravity", agy]]);
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  const world: World = await createWorld({ kind: "project", projectPath: proj }, { runtimes, bus, toolRegistry: new ToolRegistry(), bridgeUrl: () => "http://127.0.0.1:0" });
  return { world, orch: world.orchestrator, reg: world.registry, tasks: world.tasks, msgs, codex, agy };
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

function toolCtx(world: World, extra: Partial<ManagerToolContext> = {}): ManagerToolContext {
  return {
    world: world.ref,
    registry: world.registry,
    tasks: world.tasks,
    requestTask: { id: "t_req" } as Task,
    managerId: "m",
    knownProjects: () => [],
    startTask: (id) => world.orchestrator.startTask(id),
    awaitTask: (id) => world.orchestrator.awaitTask(id),
    askUser: async () => "",
    setWaiting: async () => undefined,
    emitAgent: (a) => world.bus.emit({ type: "agent.updated", agent: a }),
    checkProvider: async () => undefined,
    reviveAgent: (id, p, mo) => world.orchestrator.reviveAgent(id, p, mo),
    ...extra,
  };
}

const call = (tools: ReturnType<typeof managerTools>, name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args);

/** A task driven straight to `status` without running it. */
async function makeTask(world: World, agent: Agent, title: string, status: "failed" | "done"): Promise<Task> {
  const t = await world.tasks.create({ kind: "work", title, description: "d", createdBy: "m", assigneeId: agent.id, projectPath: proj, parentId: "t_req" });
  await world.tasks.transition(t.id, "assigned");
  await world.tasks.transition(t.id, "running");
  return status === "failed" ? world.tasks.transition(t.id, "failed", { error: "boom" }) : world.tasks.transition(t.id, "done", { result: "ok" });
}

/** Mark `agent` limited on codex the way a failed run does (provider-level + the agent's copy). */
async function limitOnCodex(world: World, agent: Agent): Promise<Agent> {
  const lim = world.usageTracker.recordFailure(agent, "codex", "gpt-6-luna", "You exceeded your current quota, please check your plan");
  return world.registry.update(agent.id, { limit: lim });
}

describe("the agent's LIMITED state clears when its provider changes", () => {
  it("update_agent to another provider clears agent.limit and broadcasts it; the provider limit and other agents stay limited", async () => {
    const { world, reg, msgs } = await setup();
    const cody = await limitOnCodex(world, await reg.create({ name: "Cody", specialty: "", provider: "codex", model: "gpt-6-luna" }));
    const kit = await limitOnCodex(world, await reg.create({ name: "Kit", specialty: "", provider: "codex", model: "gpt-6-luna" }));
    expect(cody.limit?.limited).toBe(true);
    const tools = managerTools(toolCtx(world));

    // A model change on the same, still-limited provider keeps the chip (limits are per provider).
    await call(tools, "update_agent", { agentId: cody.id, model: "gpt-6-sol" });
    expect((await reg.get(cody.id))!.limit?.limited).toBe(true);

    msgs.length = 0;
    expect(await call(tools, "update_agent", { agentId: cody.id, provider: "antigravity", model: "gemini-3.8-flash-medium" })).toContain("provider antigravity");
    expect((await reg.get(cody.id))!.limit).toBeUndefined();
    const pushed = msgs.filter((m) => m.type === "agent.updated" && m.agent.id === cody.id);
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed.at(-1)!.type === "agent.updated" && pushed.at(-1)!.agent.limit).toBeUndefined();

    // codex itself is still limited, and so is the other agent on it.
    expect(world.usageTracker.getProviderLimit("codex").limited).toBe(true);
    expect((await reg.get(kit.id))!.limit?.limited).toBe(true);
    expect(kit.provider).toBe("codex");
  });

  it("the office edit (registry update) and world.switchAgent follow the same rule", async () => {
    const { world, reg, msgs } = await setup();
    const a = await limitOnCodex(world, await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" }));
    // Same provider sent again with a new model: nothing moved, the chip stays.
    expect((await reg.update(a.id, { provider: "codex", model: "gpt-6-sol" })).limit?.limited).toBe(true);
    expect((await world.switchAgent(a.id, { model: "gpt-6-luna" })).limit?.limited).toBe(true);
    msgs.length = 0;
    const moved = await world.switchAgent(a.id, { provider: "antigravity", model: null });
    expect(moved.limit).toBeUndefined();
    expect(msgs.some((m) => m.type === "agent.updated" && m.agent.id === a.id && m.agent.limit === undefined)).toBe(true);
    // An explicit limit in the same patch wins.
    const again = await reg.update(a.id, { provider: "codex", limit: { limited: true, errorType: "quota", reason: "x" } });
    expect(again.limit?.limited).toBe(true);
  });

  it("a successful run by the agent clears its limited state and broadcasts it", async () => {
    const { world, reg, tasks, orch, msgs } = await setup();
    // Limited while on codex, then the provider limit expired (the agent copy stays until a run succeeds).
    const a = await limitOnCodex(world, await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" }));
    world.usageTracker.clearProviderLimit("codex");
    expect(a.limit?.limited).toBe(true);
    msgs.length = 0;
    const t = await orch.handleUserMessage({ agentId: a.id, text: "do it" });
    await waitFor(async () => (await tasks.get(t.id))?.status === "done");
    await waitFor(async () => (await reg.get(a.id))?.limit === undefined);
    expect(msgs.some((m) => m.type === "agent.updated" && m.agent.id === a.id && m.agent.limit === undefined)).toBe(true);
    await waitFor(() => orch.running() === 0);
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("retry does not re-run work that is already covered", () => {
  it("retry_task on a failed task whose replacement is done marks it solved instead of re-running", async () => {
    const { world, reg, tasks, codex } = await setup();
    const a = await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" });
    const failed = await makeTask(world, a, "Fix api", "failed");
    await new Promise((r) => setTimeout(r, 5));
    const replacement = await makeTask(world, a, "Fix api", "done");
    // Another assignee or another title never counts.
    const b = await reg.create({ name: "Bo", specialty: "", provider: "codex", model: "gpt-6-luna" });
    await makeTask(world, b, "Fix api", "done");
    expect(findReplacement(failed, await tasks.list())!.id).toBe(replacement.id);

    const reply = await call(managerTools(toolCtx(world)), "retry_task", { taskId: failed.id });
    expect(reply).toContain(`already covered by ${replacement.id}`);
    expect(reply).toContain("marked solved");
    const after = (await tasks.get(failed.id))!;
    expect(after.status).toBe("failed");
    expect(after.resolution?.byTaskId).toBe(replacement.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(codex.runs).toHaveLength(0);
  });

  it("the office Retry (world.retryTask, ws/http) behaves the same; force re-runs", async () => {
    const { world, reg, tasks, codex } = await setup();
    const a = await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" });
    const failed = await makeTask(world, a, "Fix api", "failed");
    await new Promise((r) => setTimeout(r, 5));
    const replacement = await makeTask(world, a, "Fix api", "done");
    const out = await world.retryTask(failed.id);
    expect(out).toMatchObject({ rerun: false, byTaskId: replacement.id });
    expect(out.message).toContain(`already covered by ${replacement.id}`);
    expect((await tasks.get(failed.id))!.resolution?.byTaskId).toBe(replacement.id);
    // Already resolved now: still not re-run.
    expect((await world.retryTask(failed.id)).rerun).toBe(false);
    expect(codex.runs).toHaveLength(0);
    // The user insists: force re-runs and clears the resolution.
    const forced = await world.retryTask(failed.id, { force: true });
    expect(forced.rerun).toBe(true);
    expect(forced.task.resolution).toBeUndefined();
    await waitFor(async () => (await tasks.get(failed.id))?.status === "done");
    expect(codex.runs).toHaveLength(1);
    await waitFor(() => world.orchestrator.running() === 0);
    await new Promise((r) => setTimeout(r, 50));
  });

  it("a failed task that already has a resolution is not re-run", async () => {
    const { world, reg, tasks, codex } = await setup();
    const a = await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" });
    const failed = await makeTask(world, a, "Fix api", "failed");
    await tasks.setResolution(failed.id, { note: "done by hand", at: new Date().toISOString() });
    const reply = await call(managerTools(toolCtx(world)), "retry_task", { taskId: failed.id });
    expect(reply).toContain("already covered by its resolution (done by hand): marked solved");
    expect((await tasks.get(failed.id))!.status).toBe("failed");
    await new Promise((r) => setTimeout(r, 50));
    expect(codex.runs).toHaveLength(0);
  });

  it("a genuine retry still re-runs (no replacement, no resolution)", async () => {
    const { world, reg, tasks, codex } = await setup();
    const a = await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" });
    const failed = await makeTask(world, a, "Fix api", "failed");
    // A later attempt that also failed does not cover it.
    await new Promise((r) => setTimeout(r, 5));
    const other = await makeTask(world, a, "Fix api", "failed");
    expect(findReplacement(failed, await tasks.list())).toBeUndefined();
    expect(await call(managerTools(toolCtx(world)), "retry_task", { taskId: failed.id })).toMatch(/^Retrying task/);
    await waitFor(async () => (await tasks.get(failed.id))?.status === "done");
    expect(codex.runs).toHaveLength(1);
    // `failed` is done now but was created BEFORE `other`: an older task never covers a newer failure.
    const out = await world.retryTask(other.id);
    expect(out.rerun).toBe(true);
    await waitFor(async () => (await tasks.get(other.id))?.status === "done");
    await waitFor(() => world.orchestrator.running() === 0);
    await new Promise((r) => setTimeout(r, 50));
  });

  it("the Inbox limit answer (reviveAgent) switches the agent but does not re-run covered work", async () => {
    const { world, reg, tasks, orch, codex, agy } = await setup();
    (orch as unknown as { deps: { reviveClearMs: number } }).deps.reviveClearMs = 0;
    const a = await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" });
    const failed = await makeTask(world, a, "Fix api", "failed");
    await new Promise((r) => setTimeout(r, 5));
    const replacement = await makeTask(world, a, "Fix api", "done");
    await reg.update(a.id, { revive: { phase: "fainted", cause: "limit", failedProvider: "codex", failedTaskId: failed.id } });
    await orch.reviveAgent(a.id, "antigravity");
    expect((await reg.get(a.id))!.provider).toBe("antigravity");
    expect((await tasks.get(failed.id))!.resolution?.byTaskId).toBe(replacement.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(codex.runs.length + agy.runs.length).toBe(0);
    await waitFor(async () => (await reg.get(a.id))?.revive === undefined);
  });
});

describe("Manager end-of-request failed sweep", () => {
  it("resolve_task marks a failure solved, with a note or the covering task", async () => {
    const { world, reg, tasks } = await setup();
    const a = await reg.create({ name: "Ada", specialty: "", provider: "codex", model: "gpt-6-luna" });
    const ok = await makeTask(world, a, "Docs", "done");
    const bad = await makeTask(world, a, "Fix api", "failed");
    const tools = managerTools(toolCtx(world));

    // Resolve with a note only (byTaskId and note are both optional).
    expect(await call(tools, "resolve_task", { taskId: bad.id })).toContain(`Resolved task ${bad.id}`);
    expect((await tasks.get(bad.id))!.resolution?.note).toBe("Marked solved by the Manager");

    // resolve_task with byTaskId links the covering task.
    const bad2 = await makeTask(world, a, "Fix db", "failed");
    expect(await call(tools, "resolve_task", { taskId: bad2.id, byTaskId: ok.id })).toContain(`completed by ${ok.id}`);
    expect((await tasks.get(bad2.id))!.resolution).toMatchObject({ byTaskId: ok.id, note: `Completed by ${ok.id}` });
  });

  it("the system prompt and tool descriptions carry the closing rule", async () => {
    expect(MANAGER_SYSTEM_PROMPT).toContain("Closing rule. Never silently abandon a failure from \"## Worker results\"");
    expect(MANAGER_SYSTEM_PROMPT).toContain("Never silently abandon a failure");
    expect(MANAGER_SYSTEM_PROMPT).toContain("mark it solved with resolve_task");
    expect(MANAGER_SYSTEM_PROMPT).toContain("Never wait for workers.");
    expect(MANAGER_SYSTEM_PROMPT).toContain("Say what was done about each failed task");
    const tools = managerTools(toolCtx((await setup()).world));
    expect(tools.some((t) => t.name === "await_tasks")).toBe(false);
    expect(tools.find((t) => t.name === "retry_task")!.description).toContain("already covered by <task>: marked solved");
  });
});

describe("recordFailure limits only real limits", () => {
  it("a crash or auth failure never marks the provider or agent limited", async () => {
    const { UsageTracker } = await import("../../src/manager/usageTracker.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "av-ut-"));
    try {
      const ut = new UsageTracker(dir);
      const agent = { id: "a1", model: null } as never;
      expect(ut.recordFailure(agent, "codex", "m", "Codex Exec exited with code 1: boom stacktrace")).toBeUndefined();
      expect(ut.recordFailure(agent, "codex", "m", "401 unauthorized: invalid api key")).toBeUndefined();
      expect(ut.getProviderLimit("codex").limited).toBe(false);
      const lim = ut.recordFailure(agent, "codex", "m", "You've hit your usage limit. Try again at 7:12 AM.");
      expect(lim?.limited).toBe(true);
      expect(ut.getProviderLimit("codex")?.limited).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
