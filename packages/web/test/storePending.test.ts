import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../src/state/store";
import type { ServerMessage } from "@agenticview/shared";

const snapshot = (extra: Partial<Extract<ServerMessage, { type: "snapshot" }>> = {}): ServerMessage => ({
  type: "snapshot",
  world: { kind: "project", name: "demo", projectPath: "C:/demo", knownProjects: [] },
  agents: [],
  tasks: [],
  providers: [],
  settings: { defaultProvider: null, defaultModel: null, maxConcurrentRuns: 3, limitPolicy: "ask" as const, failoverOrder: [], loungeBreaks: true, preferCheapModels: true, idleLoungeMinutes: 3 },
  permissions: [],
  questions: [],
  ...extra,
});

describe("snapshot carries pending prompts", () => {
  beforeEach(() => useStore.getState().reset());

  it("restores permissions and questions from a snapshot (reconnect / reload)", () => {
    useStore.getState().apply(snapshot({
      permissions: [{ id: "p1", agentId: "w_1", taskId: "t_1", tool: "Bash", input: { command: "rm" } }],
      questions: [{ id: "q1", agentId: "m_1", taskId: "t_2", question: "Colour?" }],
    }));
    expect(useStore.getState().permissions).toEqual([{ id: "p1", agentId: "w_1", taskId: "t_1", tool: "Bash", input: { command: "rm" } }]);
    expect(useStore.getState().questions).toEqual([{ id: "q1", agentId: "m_1", taskId: "t_2", question: "Colour?" }]);
  });

  it("a later snapshot replaces stale prompts", () => {
    useStore.getState().apply({ type: "permission.request", id: "p1", agentId: "w_1", taskId: "t_1", tool: "Bash", input: {} });
    useStore.getState().apply(snapshot());
    expect(useStore.getState().permissions).toEqual([]);
  });
});
