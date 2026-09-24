import { describe, it, expect } from "vitest";
import { AgentSchema, TaskSchema, TRANSITIONS, newId, defaultAgent, ClientMessageSchema } from "../src/index.js";

describe("ids", () => {
  it("prefixes and is 8 hex", () => {
    expect(newId("w")).toMatch(/^w_[0-9a-f]{8}$/);
    expect(newId("t")).not.toEqual(newId("t"));
  });
});

describe("AgentSchema", () => {
  it("round-trips a default worker", () => {
    const a = defaultAgent({ name: "Nova", role: "worker", scope: "project", specialty: "frontend" });
    expect(AgentSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(a.provider).toBeNull();
    expect(a.id).toMatch(/^w_/);
    expect(a.stats).toEqual({ xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 });
  });
  it("gives managers an m_ id and no edit tools", () => {
    const m = defaultAgent({ name: "Atlas", role: "manager", scope: "project", specialty: "manager" });
    expect(m.id).toMatch(/^m_/);
    expect(m.tools).toEqual({ edit: false, shell: false, web: false, screenshot: false });
  });
  it("rejects a bad role", () => {
    const a = defaultAgent({ name: "x", role: "worker", scope: "project", specialty: "" });
    expect(() => AgentSchema.parse({ ...a, role: "boss" })).toThrow();
  });
});

describe("TaskSchema", () => {
  it("has the exact transition table", () => {
    expect(TRANSITIONS).toEqual({
      queued: ["assigned", "cancelled"],
      assigned: ["running", "cancelled"],
      running: ["waiting", "done", "failed", "cancelled"],
      waiting: ["running", "failed", "cancelled"],
      done: [],
      failed: [],
      cancelled: [],
    });
  });
  it("parses a minimal task", () => {
    const t = TaskSchema.parse({
      id: "t_00000001", kind: "work", title: "x", description: "y", status: "queued",
      createdBy: "user", assigneeId: "w_00000001", projectPath: "C:/p", images: [], log: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(t.parentId).toBeUndefined();
  });
});

describe("ClientMessageSchema", () => {
  it("defaults images on chat.send and rejects unknown types", () => {
    const m = ClientMessageSchema.parse({ type: "chat.send", agentId: "m_1", text: "hi" });
    expect(m).toEqual({ type: "chat.send", agentId: "m_1", text: "hi", images: [] });
    expect(ClientMessageSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});
