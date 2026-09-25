import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultAgent } from "@agenticview/shared";
import { discoverOffice, formatDispatch, formatTask } from "../src/worker-mcp.js";
import { instanceFile } from "../src/instances.js";
import { createServer, type RunningServer } from "../src/server.js";
import { SessionRuntime } from "../src/runtimes/session.js";

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
});
