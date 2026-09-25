import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskService } from "../../src/tasks/taskService.js";
import { AgentRegistry } from "../../src/agents/registry.js";
import { IllegalTransitionError } from "../../src/tasks/transitions.js";

let dir: string;
const onChange = vi.fn();
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "av-tasks-"));
  process.env.AGENTICVIEW_HOME = dir;
  onChange.mockClear();
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const mk = (s: TaskService, extra: Record<string, unknown> = {}) =>
  s.create({ kind: "work", title: "t", description: "d", createdBy: "user", assigneeId: "w_1", projectPath: dir, ...extra });

describe("TaskService", () => {
  it("creates queued, transitions, stamps times, notifies", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const t = await mk(s);
    expect(t.status).toBe("queued");
    expect(t.id).toMatch(/^t_[0-9a-f]{8}$/);
    expect(onChange).toHaveBeenCalledTimes(1);
    await s.transition(t.id, "assigned");
    const r = await s.transition(t.id, "running");
    expect(r.startedAt).toBeDefined();
    const d = await s.transition(t.id, "done", { result: "ok" });
    expect(d.finishedAt).toBeDefined();
    expect(d.result).toBe("ok");
    expect(onChange).toHaveBeenCalledTimes(4);
    await expect(s.transition(t.id, "running")).rejects.toThrow(IllegalTransitionError);
    await expect(s.transition("t_missing", "running")).rejects.toThrow(/Unknown task/);
  });

  it("caps the log at 500 and serialises concurrent appends", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const t = await mk(s);
    await Promise.all(Array.from({ length: 510 }, (_, i) => s.log(t.id, "text", `line ${i}`)));
    const got = (await s.get(t.id))!;
    expect(got.log).toHaveLength(500);
    expect(got.log[0]!.text).toBe("line 10");
    expect(got.log[499]!.text).toBe("line 509");
  });

  it("ignores log for an unknown task", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    await expect(s.log("t_missing", "text", "x")).resolves.toBeUndefined();
  });

  it("recovers interrupted tasks on boot", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const a = await mk(s);
    const b = await mk(s);
    const c = await mk(s);
    await s.transition(a.id, "assigned");
    await s.transition(a.id, "running");
    await s.transition(b.id, "assigned");
    await s.transition(b.id, "running");
    await s.transition(b.id, "waiting");
    const s2 = new TaskService(join(dir, "tasks"), onChange);
    const fixed = await s2.recoverInterrupted();
    expect(fixed.map((t) => t.status)).toEqual(["failed", "failed"]);
    expect(fixed.every((t) => t.error === "interrupted")).toBe(true);
    expect((await s2.get(c.id))!.status).toBe("queued");
  });

  it("children and xp", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const reg = new AgentRegistry({ kind: "project", projectPath: dir });
    const w = await reg.create({ name: "N", specialty: "" });
    const root = await mk(s, { kind: "request", assigneeId: "m_1" });
    const c = await mk(s, { parentId: root.id, assigneeId: w.id });
    expect((await s.children(root.id)).map((t) => t.id)).toEqual([c.id]);
    await s.transition(c.id, "assigned");
    await s.transition(c.id, "running");
    const done = await s.transition(c.id, "done");
    await s.awardXp(reg, done);
    expect((await reg.get(w.id))!.stats).toEqual({ xp: 10, level: 1, tasksDone: 1, tasksFailed: 0 });
    const c2 = await mk(s, { parentId: root.id, assigneeId: w.id });
    await s.transition(c2.id, "assigned");
    await s.transition(c2.id, "running");
    await s.awardXp(reg, await s.transition(c2.id, "failed", { error: "boom" }));
    expect((await reg.get(w.id))!.stats).toEqual({ xp: 10, level: 1, tasksDone: 1, tasksFailed: 1 });
    await expect(s.awardXp(reg, { ...done, assigneeId: "w_missing" })).resolves.toBeUndefined();
  });
});

describe("TaskService.replaceLastLog", () => {
  it("replaces the last entry only and is a no-op without entries", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const t = await mk(s);
    await s.replaceLastLog(t.id, { ts: "x", type: "text", text: "nothing" });
    expect((await s.get(t.id))!.log).toEqual([]);
    await s.log(t.id, "text", "a");
    await s.log(t.id, "text", "b");
    await s.replaceLastLog(t.id, { ts: "x", type: "text", text: "bc" });
    expect((await s.get(t.id))!.log.map((l) => l.text)).toEqual(["a", "bc"]);
  });
});
