import { beforeEach, describe, expect, it } from "vitest";
import { agentStatus, useStore } from "../src/state/store";
import { manager, worker, worker2, task, snapshot } from "./fixtures";

const fresh = () => useStore.getState();

beforeEach(() => {
  useStore.getState().reset();
});

describe("store.apply", () => {
  it("snapshot replaces world, agents (keyed by id), tasks, providers and settings", () => {
    fresh().apply(snapshot([manager, worker], [task({ id: "t_00000001" })]));
    const s = fresh();
    expect(s.world?.name).toBe("proj");
    expect(Object.keys(s.agents)).toEqual([manager.id, worker.id]);
    expect(s.agents[worker.id]?.name).toBe("Pixel");
    expect(s.tasks["t_00000001"]?.status).toBe("queued");
    expect(s.providers.map((p) => p.provider)).toEqual(["claude", "claude-session", "codex", "gemini"]);
    expect(s.settings?.maxConcurrentRuns).toBe(3);
  });

  it("agent.updated upserts and agent.removed deletes", () => {
    fresh().apply(snapshot([manager]));
    fresh().apply({ type: "agent.updated", agent: worker });
    expect(fresh().agents[worker.id]).toBeDefined();
    fresh().apply({ type: "agent.removed", id: worker.id });
    expect(fresh().agents[worker.id]).toBeUndefined();
  });

  it("run.event appends to the agent feed and sets a bubble", () => {
    fresh().apply(snapshot([manager, worker]));
    fresh().apply({ type: "run.event", taskId: "t_1", agentId: worker.id, event: { type: "tool_start", name: "Write", input: {} } });
    expect(fresh().feed[worker.id]).toHaveLength(1);
    expect(fresh().bubbles[worker.id]?.text).toBe("⚙ Write");
    expect(fresh().bubbles[worker.id]!.until).toBeGreaterThan(Date.now() + 3000);

    fresh().apply({
      type: "run.event",
      taskId: "t_1",
      agentId: worker.id,
      event: { type: "file_changed", path: "C:\\proj\\src\\app.tsx", kind: "modify" },
    });
    expect(fresh().bubbles[worker.id]?.text).toBe("✎ app.tsx");

    fresh().apply({ type: "run.event", taskId: "t_1", agentId: worker.id, event: { type: "text", text: "x".repeat(200) } });
    expect(fresh().bubbles[worker.id]?.text).toHaveLength(90);
    expect(fresh().feed[worker.id]).toHaveLength(3);
  });

  it("caps the feed at 200 entries per agent", () => {
    fresh().apply(snapshot([worker]));
    for (let i = 0; i < 250; i++) {
      fresh().apply({ type: "run.event", taskId: "t", agentId: worker.id, event: { type: "status", text: String(i) } });
    }
    const feed = fresh().feed[worker.id]!;
    expect(feed).toHaveLength(200);
    expect((feed[199] as { event: { text: string } }).event.text).toBe("249");
  });

  it("task.updated to assigned pushes one beam from the manager to the worker", () => {
    fresh().apply(snapshot([manager, worker]));
    fresh().apply({ type: "task.updated", task: task({ id: "t_2", status: "queued" }) });
    expect(fresh().beams).toHaveLength(0);
    fresh().apply({ type: "task.updated", task: task({ id: "t_2", status: "assigned" }) });
    fresh().apply({ type: "task.updated", task: task({ id: "t_2", status: "assigned" }) });
    expect(fresh().beams).toHaveLength(1);
    expect(fresh().beams[0]).toMatchObject({ from: manager.id, to: worker.id });
    expect(fresh().beams[0]!.until).toBeGreaterThan(Date.now() + 1000);
    expect(fresh().tasks["t_2"]?.status).toBe("assigned");
  });

  it("a request task becoming done pushes a celebration for the manager", () => {
    fresh().apply(snapshot([manager, worker]));
    const req = task({ id: "t_3", kind: "request", createdBy: "user", assigneeId: manager.id, status: "running" });
    fresh().apply({ type: "task.updated", task: req });
    expect(fresh().celebrations).toHaveLength(0);
    fresh().apply({ type: "task.updated", task: { ...req, status: "done" } });
    expect(fresh().celebrations).toEqual([{ agentId: manager.id, until: expect.any(Number) }]);
  });

  it("permission.request pushes and permission.resolved removes", () => {
    fresh().apply(snapshot([worker]));
    fresh().apply({ type: "permission.request", id: "p_1", agentId: worker.id, taskId: "t", tool: "Bash", input: { command: "rm -rf" } });
    expect(fresh().permissions).toHaveLength(1);
    fresh().apply({ type: "permission.resolved", id: "p_1" });
    expect(fresh().permissions).toHaveLength(0);
  });

  it("question.request pushes and question.resolved removes", () => {
    fresh().apply({ type: "question.request", id: "q_1", agentId: worker.id, taskId: "t", question: "Which db?" });
    expect(fresh().questions[0]?.question).toBe("Which db?");
    fresh().apply({ type: "question.resolved", id: "q_1" });
    expect(fresh().questions).toHaveLength(0);
  });

  it("mirror.event prepends and caps at 50", () => {
    for (let i = 0; i < 60; i++) fresh().apply({ type: "mirror.event", event: { kind: "prompt", text: String(i), ts: "now" } });
    expect(fresh().mirror).toHaveLength(50);
    expect(fresh().mirror[0]?.text).toBe("59");
  });

  it("error messages are kept with their ref, and opened urls are recorded", () => {
    fresh().apply({ type: "error", message: "nope", ref: "agent.create" });
    expect(fresh().errors[0]).toMatchObject({ message: "nope", ref: "agent.create" });
    fresh().apply({ type: "opened", url: "http://127.0.0.1:4311/#token=abc" });
    expect(fresh().opened).toBe("http://127.0.0.1:4311/#token=abc");
  });

  it("select toggles the selected agent and pushUser adds a user line", () => {
    fresh().select(worker.id);
    expect(fresh().selectedAgentId).toBe(worker.id);
    fresh().select(undefined);
    expect(fresh().selectedAgentId).toBeUndefined();
    fresh().pushUser(worker.id, "hi");
    expect(fresh().feed[worker.id]?.[0]).toMatchObject({ user: "hi" });
  });
});

describe("agentStatus", () => {
  const now = Date.now();
  it("is idle with nothing going on", () => {
    expect(agentStatus(worker, [], [], [], [], now)).toBe("idle");
  });
  it("is waiting when a permission or question is pending", () => {
    const perm = [{ id: "p", agentId: worker.id, taskId: "t", tool: "Bash", input: {} }];
    expect(agentStatus(worker, [task({ id: "t", status: "running" })], perm, [], [], now)).toBe("waiting");
    expect(agentStatus(worker, [], [], [{ id: "q", agentId: worker.id, taskId: "t", question: "?" }], [], now)).toBe("waiting");
  });
  it("is thinking with a running task and editing right after a file change", () => {
    const running = task({ id: "t", status: "running" });
    expect(agentStatus(worker, [running], [], [], [], now)).toBe("thinking");
    const feed = [{ ts: now - 1000, taskId: "t", event: { type: "file_changed" as const, path: "a.ts", kind: "modify" as const } }];
    expect(agentStatus(worker, [running], [], [], feed, now)).toBe("editing");
    expect(agentStatus(worker, [running], [], [], feed, now + 5000)).toBe("thinking");
  });
  it("is error for 10 s after a failure, then idle", () => {
    const failed = task({ id: "t", status: "failed", finishedAt: new Date(now - 2000).toISOString() });
    expect(agentStatus(worker, [failed], [], [], [], now)).toBe("error");
    expect(agentStatus(worker, [failed], [], [], [], now + 20000)).toBe("idle");
  });
  it("ignores other agents' tasks", () => {
    expect(agentStatus(worker2, [task({ id: "t", status: "running" })], [], [], [], now)).toBe("idle");
  });
});

describe("providers.updated", () => {
  it("replaces provider statuses and the Automatic choice", () => {
    useStore.getState().apply({ type: "providers.updated", providers: [{ provider: "claude-session", ok: true, version: "1 worker" }], autoProvider: "claude-session" });
    expect(useStore.getState().providers).toEqual([{ provider: "claude-session", ok: true, version: "1 worker" }]);
    expect(useStore.getState().autoProvider).toBe("claude-session");
  });
});
