import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider } from "@agenticview/shared";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";

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

async function boot() {
  const fake = new FakeRuntime(async function* () {
    yield { type: "text", text: "done" };
  });
  server = await createServer({
    world: { kind: "project", projectPath: proj },
    token: "tok",
    runtimes: new Map<Provider, any>([["claude", fake]]),
  });
  return server;
}

function apiPost(s: RunningServer, path: string, body: unknown) {
  return fetch(`${s.url}${path}`, {
    method: "POST",
    headers: { "x-agenticview-token": "tok", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function apiDelete(s: RunningServer, path: string) {
  return fetch(`${s.url}${path}`, {
    method: "DELETE",
    headers: { "x-agenticview-token": "tok" },
  });
}

async function makeFailedTask(s: RunningServer) {
  const task = await s.world.tasks.create({
    kind: "work",
    title: "failing task",
    description: "should fail",
    createdBy: "user",
    assigneeId: "w_test",
    projectPath: proj,
  });
  await s.world.tasks.transition(task.id, "assigned");
  await s.world.tasks.transition(task.id, "running");
  return s.world.tasks.transition(task.id, "failed", { error: "something went wrong" });
}

async function makeDoneTask(s: RunningServer) {
  const task = await s.world.tasks.create({
    kind: "work",
    title: "done task",
    description: "succeeds",
    createdBy: "user",
    assigneeId: "w_test",
    projectPath: proj,
  });
  await s.world.tasks.transition(task.id, "assigned");
  await s.world.tasks.transition(task.id, "running");
  return s.world.tasks.transition(task.id, "done", { result: "all good" });
}

describe("POST /api/tasks/:id/resolve", () => {
  it("returns 404 for unknown task", async () => {
    const s = await boot();
    const res = await apiPost(s, "/api/tasks/t_missing/resolve", { note: "fixed" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unknown task/);
  });

  it("returns 400 when task is not failed", async () => {
    const s = await boot();
    const task = await s.world.tasks.create({
      kind: "work", title: "t", description: "d",
      createdBy: "user", assigneeId: "w_x", projectPath: proj,
    });
    const res = await apiPost(s, `/api/tasks/${task.id}/resolve`, { note: "fixed" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/failed or cancelled/);
  });

  it("returns 400 when body is invalid", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    const res = await apiPost(s, `/api/tasks/${failed.id}/resolve`, { notNote: "oops" });
    expect(res.status).toBe(400);
  });

  it("resolves a failed task with just a note", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    const res = await apiPost(s, `/api/tasks/${failed.id}/resolve`, { note: "acceptable failure" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; task: any };
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("failed");
    expect(body.task.resolution.note).toBe("acceptable failure");
    expect(body.task.resolution.byTaskId).toBeUndefined();
    expect(typeof body.task.resolution.at).toBe("string");
  });

  it("resolves a failed task with a done byTaskId", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    const done = await makeDoneTask(s);
    const res = await apiPost(s, `/api/tasks/${failed.id}/resolve`, {
      note: "done by retry",
      byTaskId: done.id,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; task: any };
    expect(body.task.resolution.byTaskId).toBe(done.id);
  });

  it("returns 400 when byTaskId is not done", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    const other = await s.world.tasks.create({
      kind: "work", title: "t", description: "d",
      createdBy: "user", assigneeId: "w_x", projectPath: proj,
    });
    const res = await apiPost(s, `/api/tasks/${failed.id}/resolve`, {
      note: "not done",
      byTaskId: other.id,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not done/);
  });
});

describe("DELETE /api/tasks/:id/resolve", () => {
  it("returns 404 for unknown task", async () => {
    const s = await boot();
    const res = await apiDelete(s, "/api/tasks/t_missing/resolve");
    expect(res.status).toBe(404);
  });

  it("returns 400 when task has no resolution", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    const res = await apiDelete(s, `/api/tasks/${failed.id}/resolve`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no resolution/);
  });

  it("removes the resolution from a resolved task", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    await apiPost(s, `/api/tasks/${failed.id}/resolve`, { note: "fixed" });
    const res = await apiDelete(s, `/api/tasks/${failed.id}/resolve`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; task: any };
    expect(body.ok).toBe(true);
    expect(body.task.resolution).toBeUndefined();
    expect(body.task.status).toBe("failed");
  });
});

describe("retryTask clears resolution", () => {
  it("clears resolution when a resolved failed task is retried", async () => {
    const s = await boot();
    const failed = await makeFailedTask(s);
    await s.world.tasks.setResolution(failed.id, { note: "was resolved", at: new Date().toISOString() });
    const resolved = await s.world.tasks.get(failed.id);
    expect(resolved!.resolution).toBeDefined();
    // Retry via the world method (retryTask).
    const retried = await s.world.retryTask(failed.id);
    expect(retried.status).toBe("queued");
    expect(retried.resolution).toBeUndefined();
  });
});
