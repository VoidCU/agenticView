import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, ServerMessage } from "@agenticview/shared";
import { FakeRuntime, type FakeScript } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { EventBus } from "../../src/events/bus.js";
import { createWorld } from "../../src/world.js";
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

async function setup(script: FakeScript, settings?: Record<string, unknown>) {
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  if (settings) await writeJsonFile(join(projectRoot(proj), "settings.json"), settings);
  const world = await createWorld({ kind: "project", projectPath: proj }, { runtimes: new Map<Provider, Runtime>([["claude", new FakeRuntime(script)]]), bus, toolRegistry: new ToolRegistry(), bridgeUrl: () => "http://127.0.0.1:0" });
  return { world, orch: world.orchestrator, reg: world.registry, tasks: world.tasks, msgs };
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

describe("Orchestrator cancel cascade and pending prompts", () => {
  it("cancelling a request cancels its running and queued children", async () => {
    const ctx = await setup(async function* (req) {
      if (req.agent.role === "manager") {
        const w = (await ctx.reg.list()).find((a) => a.role === "worker")!;
        yield { type: "call", tool: "assign_task", args: { agentId: w.id, title: "a", description: "" } };
        yield { type: "call", tool: "assign_task", args: { agentId: w.id, title: "b", description: "" } };
        const ids = (await ctx.tasks.list()).filter((t) => t.kind === "work").map((t) => t.id);
        yield { type: "call", tool: "await_tasks", args: { taskIds: ids } };
        yield { type: "text", text: "done" };
      } else {
        await new Promise(() => {});
      }
    }, { maxConcurrentRuns: 1 });
    await ctx.reg.create({ name: "Nova", specialty: "" });
    const m = await ctx.reg.ensureManager();
    const t = await ctx.orch.handleUserMessage({ agentId: m.id, text: "go" });
    await waitFor(async () => (await ctx.tasks.list()).filter((x) => x.kind === "work").length === 2 && (await ctx.tasks.get(t.id))!.status === "waiting");
    await ctx.orch.cancel(t.id);
    const all = await ctx.tasks.list();
    expect(all.find((x) => x.id === t.id)!.status).toBe("cancelled");
    expect(all.filter((x) => x.kind === "work").map((x) => x.status)).toEqual(["cancelled", "cancelled"]);
    expect(ctx.orch.running()).toBe(0);
  });

  it("exposes pending prompts and resolves them when the task is cancelled", async () => {
    const ctx = await setup(async function* (req) {
      const ok = await req.onPermission!({ id: "pp", tool: "Bash", input: {} });
      yield { type: "text", text: String(ok) };
    });
    const w = await ctx.reg.create({ name: "Nova", specialty: "", permissionMode: "ask" });
    const t = await ctx.orch.handleUserMessage({ agentId: w.id, text: "do" });
    await waitFor(() => ctx.msgs.find((x) => x.type === "permission.request"));
    expect(ctx.orch.pending().permissions).toEqual([{ id: "pp", agentId: w.id, taskId: t.id, tool: "Bash", input: {} }]);
    await ctx.orch.cancel(t.id);
    expect(ctx.orch.pending().permissions).toEqual([]);
    expect(ctx.msgs.some((x) => x.type === "permission.resolved" && x.id === "pp")).toBe(true);
    const final = await ctx.orch.awaitTask(t.id);
    expect(final.status).toBe("cancelled");
  });
});
