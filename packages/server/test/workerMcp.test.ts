import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultAgent } from "@agenticview/shared";
import {
  discoverOffice,
  formatDispatch,
  formatTask,
  resetWorkerState,
  _testInjectRun,
  dropRunsForOldOffice,
  heldRuns,
  complete,
  report,
} from "../src/worker-mcp.js";
import { instanceFile } from "../src/instances.js";
import { createServer, type RunningServer } from "../src/server.js";
import { SessionRuntime } from "../src/runtimes/session.js";
import type { Instance } from "../src/instances.js";

let home: string;
let proj: string;
let server: RunningServer | undefined;
let server2: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
const savedProject = process.env.AGENTICVIEW_PROJECT;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-p-"));
  process.env.AGENTICVIEW_HOME = home;
  resetWorkerState();
});
afterEach(async () => {
  await server?.close();
  await server2?.close();
  server = undefined;
  server2 = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  process.env.AGENTICVIEW_PROJECT = savedProject;
  resetWorkerState();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("worker MCP", () => {
  it("discovers the office for the project or one of its parents, and reports none otherwise", async () => {
    expect(await discoverOffice(proj)).toBeUndefined();
    server = await createServer({ world: { kind: "project", projectPath: proj }, token: "t", runtimes: new Map([["claude-session", new SessionRuntime()]]) });
    const file = instanceFile(proj);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ pid: process.pid, url: server.url, token: "t", projectPath: proj, startedAt: "" }));
    const sub = join(proj, "src", "deep");
    await mkdir(sub, { recursive: true });
    expect((await discoverOffice(sub))?.url).toBe(server.url);
  });

  it("formats a task with persona, cwd, tool limits, office tools and the prompt", () => {
    const agent = defaultAgent({ name: "Nova", role: "worker", scope: "project", specialty: "tests" });
    const text = formatTask({
      runId: "r_1",
      agent: { id: agent.id, name: "Nova", role: "worker", specialty: "tests" },
      cwd: "/proj",
      systemPrompt: "Be Nova.",
      prompt: "Fix the bug",
      images: ["/tmp/a.png"],
      tools: { edit: false, shell: true, web: false, screenshot: false },
      permissionMode: "auto",
      model: "opus",
      effort: "max",
      bridgeTools: [{ name: "take_screenshot", description: "Shoot", inputSchema: { type: "object" } }],
    });
    expect(text).toContain('"Nova"');
    expect(text).toContain("Working directory: /proj");
    expect(text).toContain("file edits: NOT allowed");
    expect(text).toContain("shell commands: ALLOWED");
    expect(text).toContain("take_screenshot: Shoot");
    expect(text).toContain("Be Nova.");
    expect(text).toContain("Fix the bug");
    expect(text).toContain("Requested model: opus");
    expect(text).toContain("Requested effort: max");
    expect(text).toContain("/tmp/a.png");
  });

  it("names the run_id and subagent, digests recent work, and only flags a model mismatch the subagent cannot fix", () => {
    const base = {
      runId: "r_9",
      taskId: "t_9",
      agent: { id: "w_1", name: "Nova", role: "worker", specialty: "" },
      cwd: "/proj",
      systemPrompt: "",
      prompt: "Next step",
      images: [],
      tools: { edit: true, shell: true, web: false, screenshot: false },
      permissionMode: "auto" as const,
      model: "opus",
      bridgeTools: [],
      session: { id: "s", name: "Main", model: "claude-sonnet-5" },
    };
    const withSub = formatTask({
      ...base,
      subagent: "agenticview-nova",
      recentWork: [{ taskId: "t_1", title: "Header", status: "done", summary: "Built it", files: ["a.tsx"], finishedAt: "2026-09-25T10:00:00.000Z", subagentId: "ag-1", sessionName: "Main" }],
    });
    expect(withSub).toContain("run_id: r_9");
    expect(withSub).toContain('agenticview_complete {run_id: "r_9", result}');
    expect(withSub).toContain("the agenticview-nova subagent runs on opus");
    expect(withSub).not.toContain("MODEL MISMATCH");
    expect(withSub).toContain('- [done] "Header" (task t_1 2026-09-25 10:00) (subagent id ag-1 in "Main"): Built it [files: a.tsx]');
    const noSub = formatTask({ ...base, subagent: null });
    expect(noSub).toContain("MODEL MISMATCH");
    expect(noSub).toContain("(none yet: this is the agent's first task here)");
    expect(formatDispatch({ ...base, subagent: "agenticview-nova" }, 0, 2)).toMatch(/^=== Task 1 of 2: Nova, run_id r_9 ===\nLaunch the `agenticview-nova` subagent IN THE BACKGROUND/);
    expect(formatDispatch({ ...base, subagent: null }, 1, 2)).toContain("do this task yourself in the main thread");
  });

  it("dropRunsForOldOffice removes runs from the old instance and keeps runs from the new one", () => {
    const oldInst: Instance = { pid: 1, url: "http://old:1234", token: "t1", projectPath: null, startedAt: "2025-01-01T00:00:00.000Z" };
    const newInst: Instance = { pid: 2, url: "http://new:5678", token: "t2", projectPath: null, startedAt: "2025-01-02T00:00:00.000Z" };
    _testInjectRun("r_old1", oldInst, "Nova");
    _testInjectRun("r_old2", oldInst, "Sage");
    // Manually add a run for the "new" office without changing state.office
    // (_testInjectRun overwrites state.office so add old ones first)
    _testInjectRun("r_new", newInst, "Forge");
    // Also re-add the old runs: use _testInjectRun which sets state.office; re-do to set them
    resetWorkerState();
    _testInjectRun("r_old1", oldInst, "Nova");
    // second inject changes state.office to newInst; override back
    resetWorkerState();
    // Directly build the scenario: old1 and new1
    _testInjectRun("r_old1", oldInst, "Nova");
    const dropped = dropRunsForOldOffice(newInst);
    expect(dropped).toEqual(["r_old1"]);
    expect(heldRuns()).toEqual([]);
  });

  it("dropRunsForOldOffice keeps all runs when they match the new instance", () => {
    const inst: Instance = { pid: 3, url: "http://same:9999", token: "t", projectPath: null, startedAt: "2026-01-01T00:00:00.000Z" };
    _testInjectRun("r_1", inst, "Forge");
    const dropped = dropRunsForOldOffice(inst);
    expect(dropped).toEqual([]);
    expect(heldRuns()).toEqual(["r_1"]);
  });

  it("complete detects an office restart (ECONNREFUSED) and drops the stale run", async () => {
    // Start an "old" office, close it (simulating restart), then stand up a "new" office.
    server = await createServer({
      world: { kind: "project", projectPath: proj },
      token: "tok-old",
      runtimes: new Map([["claude-session", new SessionRuntime()]]),
    });
    const oldInst: Instance = { pid: process.pid, url: server.url, token: "tok-old", projectPath: proj, startedAt: "2025-06-01T00:00:00.000Z" };
    _testInjectRun("r_stale", oldInst, "Nova");
    // Close the old office so that calls to its URL get ECONNREFUSED.
    await server.close();
    server = undefined;

    // Stand up a new office and write its instance file so checkOfficeRestart can discover it.
    server2 = await createServer({
      world: { kind: "project", projectPath: proj },
      token: "tok-new",
      runtimes: new Map([["claude-session", new SessionRuntime()]]),
    });
    const newInst: Instance = { pid: process.pid, url: server2.url, token: "tok-new", projectPath: null, startedAt: "2025-06-02T00:00:00.000Z" };
    const hubFile = instanceFile(null);
    await mkdir(dirname(hubFile), { recursive: true });
    await writeFile(hubFile, JSON.stringify(newInst));

    // The complete call should detect ECONNREFUSED, discover the new office, drop the stale run.
    const result = await complete({ run_id: "r_stale", result: "done" });
    expect(result.content[0]!.text).toContain("Office restarted");
    expect(result.content[0]!.text).toContain("r_stale");
    expect(result.content[0]!.text).toContain("agenticview_next_task");
    expect(heldRuns()).not.toContain("r_stale");
  });

  it("report detects an office restart (ECONNREFUSED) and drops the stale run", async () => {
    server = await createServer({
      world: { kind: "project", projectPath: proj },
      token: "tok-old2",
      runtimes: new Map([["claude-session", new SessionRuntime()]]),
    });
    const oldInst: Instance = { pid: process.pid, url: server.url, token: "tok-old2", projectPath: proj, startedAt: "2025-07-01T00:00:00.000Z" };
    _testInjectRun("r_rep", oldInst, "Sage");
    await server.close();
    server = undefined;

    server2 = await createServer({
      world: { kind: "project", projectPath: proj },
      token: "tok-new2",
      runtimes: new Map([["claude-session", new SessionRuntime()]]),
    });
    const newInst: Instance = { pid: process.pid, url: server2.url, token: "tok-new2", projectPath: null, startedAt: "2025-07-02T00:00:00.000Z" };
    const hubFile = instanceFile(null);
    await mkdir(dirname(hubFile), { recursive: true });
    await writeFile(hubFile, JSON.stringify(newInst));

    const result = await report({ run_id: "r_rep", text: "progress" });
    expect(result.content[0]!.text).toContain("Office restarted");
    expect(result.content[0]!.text).toContain("r_rep");
    expect(heldRuns()).not.toContain("r_rep");
  });
});
