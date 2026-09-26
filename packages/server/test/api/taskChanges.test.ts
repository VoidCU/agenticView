import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";

const execFile = promisify(execFileCb);

async function gitInit(dir: string): Promise<void> {
  await execFile("git", ["-C", dir, "init"]);
  await execFile("git", ["-C", dir, "config", "user.email", "test@test.com"]);
  await execFile("git", ["-C", dir, "config", "user.name", "Test"]);
  await execFile("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"]);
}

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

async function boot(projectPath: string) {
  const fake = new FakeRuntime(async function* () {
    yield { type: "text", text: "done" };
  });
  server = await createServer({
    world: { kind: "project", projectPath },
    token: "tok",
    runtimes: new Map<Provider, any>([["claude", fake]]),
  });
  return server;
}

function apiGet(s: RunningServer, path: string) {
  return fetch(`${s.url}${path}`, { headers: { "x-agenticview-token": "tok" } });
}

async function makeTask(s: RunningServer, projectPath: string, logEntries: Array<{ type: string; text: string }> = []) {
  const task = await s.world.tasks.create({
    kind: "work",
    title: "test",
    description: "test",
    createdBy: "test",
    assigneeId: "w_test",
    projectPath,
  });
  for (const e of logEntries) {
    await s.world.tasks.log(task.id, e.type, e.text);
  }
  return task;
}

describe("GET /api/tasks/:id/changes", () => {
  it("returns 404 for unknown task", async () => {
    const s = await boot(proj);
    const res = await apiGet(s, "/api/tasks/t_unknown/changes");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Unknown task/);
  });

  it("returns empty when task has no file_changed entries", async () => {
    const s = await boot(proj);
    const task = await makeTask(s, proj);
    const res = await apiGet(s, `/api/tasks/${task.id}/changes`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files).toEqual([]);
    expect(body.diff).toBe("");
    expect(body.truncated).toBe(false);
  });

  it("returns empty diff when project is not a git repo", async () => {
    const s = await boot(proj);
    const task = await makeTask(s, proj, [{ type: "file_changed", text: "create foo.ts" }]);
    const res = await apiGet(s, `/api/tasks/${task.id}/changes`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files).toEqual([{ path: "foo.ts", kind: "create" }]);
    expect(body.diff).toBe("");
    expect(body.truncated).toBe(false);
  });

  it("returns diff for a tracked modified file", async () => {
    await gitInit(proj);
    await writeFile(join(proj, "src.ts"), "const a = 1;\n");
    await execFile("git", ["-C", proj, "add", "src.ts"]);
    await execFile("git", ["-C", proj, "commit", "-m", "add src"]);
    await writeFile(join(proj, "src.ts"), "const a = 2;\n");

    const s = await boot(proj);
    const task = await makeTask(s, proj, [{ type: "file_changed", text: "modify src.ts" }]);
    const res = await apiGet(s, `/api/tasks/${task.id}/changes`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files).toEqual([{ path: "src.ts", kind: "modify" }]);
    expect(body.diff).toContain("-const a = 1;");
    expect(body.diff).toContain("+const a = 2;");
    expect(body.truncated).toBe(false);
  });

  it("returns new-file diff for an untracked created file", async () => {
    await gitInit(proj);
    await writeFile(join(proj, "new.ts"), "export const n = 42;\n");

    const s = await boot(proj);
    const task = await makeTask(s, proj, [{ type: "file_changed", text: "create new.ts" }]);
    const res = await apiGet(s, `/api/tasks/${task.id}/changes`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files).toEqual([{ path: "new.ts", kind: "create" }]);
    expect(body.diff).toContain("new file mode");
    expect(body.diff).toContain("+export const n = 42;");
    expect(body.truncated).toBe(false);
  });

  it("deduplicates file_changed entries, keeping last kind per path", async () => {
    await gitInit(proj);
    await writeFile(join(proj, "a.ts"), "v1\n");
    await execFile("git", ["-C", proj, "add", "a.ts"]);
    await execFile("git", ["-C", proj, "commit", "-m", "add a"]);
    await writeFile(join(proj, "a.ts"), "v2\n");

    const s = await boot(proj);
    // Two file_changed entries for the same path — last one wins
    const task = await makeTask(s, proj, [
      { type: "file_changed", text: "create a.ts" },
      { type: "file_changed", text: "modify a.ts" },
    ]);
    const res = await apiGet(s, `/api/tasks/${task.id}/changes`);
    const body = await res.json() as any;
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toEqual({ path: "a.ts", kind: "modify" });
    expect(body.diff).toContain("-v1");
    expect(body.diff).toContain("+v2");
  });

  it("silently ignores path traversal attempts", async () => {
    await gitInit(proj);
    const s = await boot(proj);
    const task = await makeTask(s, proj, [{ type: "file_changed", text: "create ../evil.ts" }]);
    const res = await apiGet(s, `/api/tasks/${task.id}/changes`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // File is listed but no diff (path rejected)
    expect(body.diff).toBe("");
  });
});
