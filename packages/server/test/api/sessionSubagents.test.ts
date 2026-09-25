import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Provider } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { SessionRuntime } from "../../src/runtimes/session.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { instanceFile } from "../../src/instances.js";
import { complete, heldRuns, nextTask, report, resetWorkerState } from "../../src/worker-mcp.js";

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
  const file = instanceFile(proj);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ pid: process.pid, url: server.url, token: "tok", projectPath: proj, startedAt: "" }));
  process.env.AGENTICVIEW_PROJECT = proj;
  return server;
}

const agentsDir = () => join(proj, ".claude", "agents");

describe("claude-session agents as subagents of one session", () => {
  it("git-ignores .agenticview and the generated subagents when the office opens", async () => {
    await writeFile(join(proj, ".gitignore"), "node_modules\r\n");
    await boot();
    expect(await readFile(join(proj, ".gitignore"), "utf8")).toBe("node_modules\r\n\r\n# AgenticView\r\n.agenticview/\r\n.claude/agents/agenticview-*.md\r\n");
  });

  it("writes subagent files on start and on create/update, and removes them on provider change and delete", async () => {
    await mkdir(join(home, "agents"), { recursive: true });
    const s = await boot();
    const nova = await s.world.registry.create({ name: "Nova", specialty: "frontend", provider: "claude-session", model: "sonnet" });
    s.bus.emit({ type: "agent.updated", agent: nova });
    await waitFor(async () => (await readdir(agentsDir()).catch(() => [])).includes("agenticview-nova.md"));
    expect(await readFile(join(agentsDir(), "agenticview-nova.md"), "utf8")).toContain("model: sonnet");

    // A user-authored file with another agent's name stays untouched.
    await writeFile(join(agentsDir(), "agenticview-orion.md"), "---\nname: agenticview-orion\ndescription: mine\n---\nhand\n");
    const orion = await s.world.registry.create({ name: "Orion", specialty: "", provider: "claude-session" });
    s.bus.emit({ type: "agent.updated", agent: orion });
    const res = await s.world.syncSubagents();
    expect(res?.userFiles).toEqual(["agenticview-orion"]);

    const moved = await s.world.registry.update(nova.id, { provider: "codex" });
    s.bus.emit({ type: "agent.updated", agent: moved });
    await waitFor(async () => !(await readdir(agentsDir())).includes("agenticview-nova.md"));

    const back = await s.world.registry.update(nova.id, { provider: "claude-session" });
    s.bus.emit({ type: "agent.updated", agent: back });
    await waitFor(async () => (await readdir(agentsDir())).includes("agenticview-nova.md"));
    await s.world.registry.remove(nova.id);
    s.bus.emit({ type: "agent.removed", id: nova.id });
    await waitFor(async () => !(await readdir(agentsDir())).includes("agenticview-nova.md"));
    expect(await readFile(join(agentsDir(), "agenticview-orion.md"), "utf8")).toContain("hand");

    // Office restart: the sync on start writes files for existing agents.
    await rm(agentsDir(), { recursive: true });
    await s.close();
    server = undefined;
    await boot();
    expect(await readdir(agentsDir())).toEqual(["agenticview-orion.md"]);
  });

  it("one session claims both agents' tasks, routes reports by run_id, records who did what, and digests earlier work", async () => {
    const s = await boot();
    const nova = await s.world.registry.create({ name: "Nova", specialty: "frontend", provider: "claude-session", model: "opus" });
    const orion = await s.world.registry.create({ name: "Orion", specialty: "backend", provider: "claude-session" });
    const tNova = await s.orchestrator.handleUserMessage({ agentId: nova.id, text: "build the header" });
    const tOrion = await s.orchestrator.handleUserMessage({ agentId: orion.id, text: "add the endpoint" });
    await waitFor(() => s.world.sessionRuntime!.queued() === 2);

    const out = (await nextTask({ session_id: "sess-one", model: "claude-opus-5-5", wait_seconds: 5, max_tasks: 4 })).content[0]!.text;
    expect(out).toMatch(/^2 tasks claimed\. This session holds 2 of 4 task slots\./);
    expect(out).toContain('subagent_type "agenticview-nova"');
    expect(out).toContain('subagent_type "agenticview-orion"');
    expect(out).toContain("build the header");
    expect(out).toContain("add the endpoint");
    expect(out).toContain("(none yet: this is the agent's first task here)");
    const runs = heldRuns();
    expect(runs).toHaveLength(2);
    const sessions = await s.world.sessions();
    expect(sessions[0]).toMatchObject({ id: "sess-one", capacity: 4, agentIds: expect.arrayContaining([nova.id, orion.id]) });
    expect(sessions[0]!.runs.map((r) => r.subagent).sort()).toEqual(["agenticview-nova", "agenticview-orion"]);

    const [runNova, runOrion] = [tNova, tOrion].map((t) => sessions[0]!.runs.find((r) => r.taskId === t.id)!.runId);
    // Two tasks held: a call without run_id is refused with the choices.
    const ambiguous = await report({ text: "hi" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]!.text).toContain("pass run_id");
    expect((await report({ run_id: runNova, text: "working", subagent_id: "a1b2c3", events: [{ type: "file_changed", path: "src/Header.tsx", kind: "create" }] })).isError).toBeUndefined();
    await waitFor(async () => (await s.world.sessions())[0]!.runs.find((r) => r.runId === runNova)?.subagentId === "a1b2c3");
    expect((await complete({ run_id: runOrion, result: "endpoint added" })).content[0]!.text).toContain("1 still running");
    // One task left: run_id may be omitted (backward compatible).
    expect((await complete({ result: "header built" })).isError).toBeUndefined();
    const doneNova = await waitFor(async () => {
      const t = await s.world.tasks.get(tNova.id);
      return t?.status === "done" ? t : undefined;
    });
    expect(doneNova.result).toBe("header built");
    expect(doneNova.worker).toMatchObject({ runId: runNova, sessionId: "sess-one", subagent: "agenticview-nova", subagentId: "a1b2c3", files: ["src/Header.tsx"] });
    expect((await waitFor(async () => (await s.world.tasks.get(tOrion.id))?.status === "done" && s.world.tasks.get(tOrion.id)))!.worker).toMatchObject({ subagent: "agenticview-orion" });

    // Nova's next task carries her recent work, so a fresh subagent continues the thread.
    await s.orchestrator.handleUserMessage({ agentId: nova.id, text: "now the footer" });
    const next = (await nextTask({ session_id: "sess-one", wait_seconds: 5 })).content[0]!.text;
    expect(next).toContain("## Your recent work");
    expect(next).toMatch(/\[done\] "build the header" \(task t_\w+ .*\(subagent id a1b2c3 in ".*"\): header built \[files: src\/Header\.tsx\]/);
  });

  it("session capacity limits concurrent claims and persists", async () => {
    const s = await boot();
    const a = await s.world.registry.create({ name: "A", specialty: "", provider: "claude-session" });
    const b = await s.world.registry.create({ name: "B", specialty: "", provider: "claude-session" });
    await nextTask({ session_id: "sess-cap", wait_seconds: 1, max_tasks: 0 });
    await s.world.sessionRuntime!.setCapacity("sess-cap", 1);
    await s.orchestrator.handleUserMessage({ agentId: a.id, text: "one" });
    await s.orchestrator.handleUserMessage({ agentId: b.id, text: "two" });
    await waitFor(() => s.world.sessionRuntime!.queued() === 2);
    expect((await nextTask({ session_id: "sess-cap", wait_seconds: 2 })).content[0]!.text).toMatch(/^1 task claimed\. This session holds 1 of 1/);
    expect(JSON.parse(await readFile(join(proj, ".agenticview", "worker-sessions.json"), "utf8")).sessions[0].capacity).toBe(1);
  });
});
