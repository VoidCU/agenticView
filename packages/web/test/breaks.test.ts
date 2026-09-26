import { describe, expect, it } from "vitest";
import {
  BREAK_MAX_MS,
  BREAK_MIN_MS,
  LoungeBreak,
  agentRevivePhase,
  breakDuration,
  breakSeat,
  updateBreaks,
} from "../src/scene/breaks";
import { agent, manager, task } from "./fixtures";
import type { Agent, Task } from "@agenticview/shared";

// ---------- pure helpers ----------

describe("breakSeat", () => {
  it("returns a value in [0, 3]", () => {
    const seat = breakSeat("w_001", "t_001");
    expect(seat).toBeGreaterThanOrEqual(0);
    expect(seat).toBeLessThanOrEqual(3);
  });

  it("is deterministic – same inputs always give the same seat", () => {
    expect(breakSeat("w_abc", "t_xyz")).toBe(breakSeat("w_abc", "t_xyz"));
  });

  it("varies across different agent/task pairs", () => {
    const seats = new Set([
      breakSeat("w_001", "t_001"),
      breakSeat("w_002", "t_001"),
      breakSeat("w_001", "t_002"),
      breakSeat("w_003", "t_003"),
    ]);
    // At least two distinct values (very unlikely to all be equal)
    expect(seats.size).toBeGreaterThan(1);
  });
});

describe("breakDuration", () => {
  it("is in [BREAK_MIN_MS, BREAK_MAX_MS]", () => {
    for (const [a, t] of [["w_001", "t_001"], ["w_002", "t_002"], ["w_003", "t_003"]] as [string, string][]) {
      const d = breakDuration(a, t);
      expect(d).toBeGreaterThanOrEqual(BREAK_MIN_MS);
      expect(d).toBeLessThanOrEqual(BREAK_MAX_MS);
    }
  });

  it("is deterministic", () => {
    expect(breakDuration("w_abc", "t_xyz")).toBe(breakDuration("w_abc", "t_xyz"));
  });
});

describe("agentRevivePhase", () => {
  it("returns undefined when revive field is absent", () => {
    expect(agentRevivePhase(agent({ id: "w_1", name: "X" }))).toBeUndefined();
  });

  it("reads the phase when revive is present", () => {
    const fainted = { ...agent({ id: "w_2", name: "Y" }), revive: { phase: "fainted" as const } };
    expect(agentRevivePhase(fainted as Agent)).toBe("fainted");
    const reviving = { ...agent({ id: "w_3", name: "Z" }), revive: { phase: "reviving" as const } };
    expect(agentRevivePhase(reviving as Agent)).toBe("reviving");
  });
});

// ---------- updateBreaks ----------

const W = agent({ id: "w_001", name: "Alpha" });
const W2 = agent({ id: "w_002", name: "Beta" });
const NOW = 1_000_000;

function agents(...ws: Agent[]): Record<string, Agent> {
  const out: Record<string, Agent> = {};
  for (const w of ws) out[w.id] = w;
  return out;
}

function tasks(...ts: Task[]): Record<string, Task> {
  const out: Record<string, Task> = {};
  for (const t of ts) out[t.id] = t;
  return out;
}

describe("updateBreaks", () => {
  it("adds a break when a task transitions to done", () => {
    const breaks = new Map<string, LoungeBreak>();
    const prev = new Map([["t_1", "running" as Task["status"]]]);
    const t = task({ id: "t_1", status: "done", assigneeId: W.id });
    updateBreaks(breaks, agents(W), tasks(t), prev, true, NOW);
    expect(breaks.has(W.id)).toBe(true);
    const b = breaks.get(W.id)!;
    expect(b.spaceId).toBe("lounge");
    expect(b.seat).toBeGreaterThanOrEqual(0);
    expect(b.seat).toBeLessThanOrEqual(3);
    expect(b.until).toBeGreaterThan(NOW + BREAK_MIN_MS - 1);
    expect(b.until).toBeLessThanOrEqual(NOW + BREAK_MAX_MS);
  });

  it("adds a break when a task transitions to failed", () => {
    const breaks = new Map<string, LoungeBreak>();
    const prev = new Map([["t_2", "running" as Task["status"]]]);
    const t = task({ id: "t_2", status: "failed", assigneeId: W.id });
    updateBreaks(breaks, agents(W), tasks(t), prev, true, NOW);
    expect(breaks.has(W.id)).toBe(true);
  });

  it("does not add a break when loungeEnabled is false", () => {
    const breaks = new Map<string, LoungeBreak>();
    const prev = new Map([["t_3", "running" as Task["status"]]]);
    const t = task({ id: "t_3", status: "done", assigneeId: W.id });
    updateBreaks(breaks, agents(W), tasks(t), prev, false, NOW);
    expect(breaks.has(W.id)).toBe(false);
  });

  it("does not re-add a break for an already-terminal task", () => {
    const breaks = new Map<string, LoungeBreak>();
    const prev = new Map([["t_4", "done" as Task["status"]]]);
    const t = task({ id: "t_4", status: "done", assigneeId: W.id });
    updateBreaks(breaks, agents(W), tasks(t), prev, true, NOW);
    expect(breaks.has(W.id)).toBe(false);
  });

  it("removes a break when the agent gets a new active task", () => {
    const breaks = new Map<string, LoungeBreak>([
      [W.id, { spaceId: "lounge", seat: 1, until: NOW + 60_000, taskId: "t_old" }],
    ]);
    const prev = new Map([["t_new", "assigned" as Task["status"]]]);
    const t = task({ id: "t_new", status: "running", assigneeId: W.id });
    updateBreaks(breaks, agents(W), tasks(t), prev, true, NOW);
    expect(breaks.has(W.id)).toBe(false);
  });

  it("removes an expired break", () => {
    const breaks = new Map<string, LoungeBreak>([
      [W.id, { spaceId: "lounge", seat: 2, until: NOW - 1, taskId: "t_old" }],
    ]);
    const prev = new Map<string, Task["status"]>();
    updateBreaks(breaks, agents(W), {}, prev, true, NOW);
    expect(breaks.has(W.id)).toBe(false);
  });

  it("resolves seat collisions: two agents finishing concurrently get different seats", () => {
    const breaks = new Map<string, LoungeBreak>();
    const prev = new Map([["t_a", "running" as Task["status"]], ["t_b", "running" as Task["status"]]]);
    const tA = task({ id: "t_a", status: "done", assigneeId: W.id });
    const tB = task({ id: "t_b", status: "done", assigneeId: W2.id });
    updateBreaks(breaks, agents(W, W2), tasks(tA, tB), prev, true, NOW);
    if (breaks.has(W.id) && breaks.has(W2.id)) {
      expect(breaks.get(W.id)!.seat).not.toBe(breaks.get(W2.id)!.seat);
    }
  });

  it("does not add a break for a manager", () => {
    const breaks = new Map<string, LoungeBreak>();
    const m = { ...manager, id: "m_001" } as Agent;
    const prev = new Map([["t_mgr", "running" as Task["status"]]]);
    const t = task({ id: "t_mgr", status: "done", assigneeId: m.id });
    updateBreaks(breaks, { [m.id]: m }, tasks(t), prev, true, NOW);
    expect(breaks.has(m.id)).toBe(false);
  });

  it("does not add a break for a fainted agent", () => {
    const breaks = new Map<string, LoungeBreak>();
    const fainted = { ...W, revive: { phase: "fainted" as const } } as Agent;
    const prev = new Map([["t_f", "running" as Task["status"]]]);
    const t = task({ id: "t_f", status: "done", assigneeId: W.id });
    updateBreaks(breaks, { [W.id]: fainted }, tasks(t), prev, true, NOW);
    expect(breaks.has(W.id)).toBe(false);
  });

  it("removes a fainted agent's existing break", () => {
    const breaks = new Map<string, LoungeBreak>([
      [W.id, { spaceId: "lounge", seat: 0, until: NOW + 60_000, taskId: "t_old" }],
    ]);
    const fainted = { ...W, revive: { phase: "fainted" as const } } as Agent;
    const prev = new Map<string, Task["status"]>();
    updateBreaks(breaks, { [W.id]: fainted }, {}, prev, true, NOW);
    expect(breaks.has(W.id)).toBe(false);
  });

  it("updates prevStatuses so the next call sees the diff correctly", () => {
    const breaks = new Map<string, LoungeBreak>();
    const prev = new Map<string, Task["status"]>();
    const t = task({ id: "t_5", status: "running", assigneeId: W.id });
    // First call: task is running, prev is empty (no prior knowledge)
    updateBreaks(breaks, agents(W), tasks(t), prev, true, NOW);
    // prev should now have t_5 → running
    expect(prev.get("t_5")).toBe("running");
    // Second call: task still running, no break should appear
    updateBreaks(breaks, agents(W), tasks(t), prev, true, NOW + 100);
    expect(breaks.has(W.id)).toBe(false);
  });
});
