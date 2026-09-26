import { describe, it, expect, beforeEach } from "vitest";
import { usePositions } from "../src/state/positions";
import type { AgentActivity } from "../src/state/positions";

describe("usePositions store", () => {
  beforeEach(() => {
    // Reset the store between tests.
    usePositions.getState().set({});
  });

  it("starts with an empty byAgent map", () => {
    expect(usePositions.getState().byAgent).toEqual({});
  });

  it("set() replaces the full snapshot", () => {
    const positions = {
      agent1: { x: 1.5, z: 2.5, spaceId: "pod-a", activity: "desk" as AgentActivity },
      agent2: { x: -3, z: 4, spaceId: "lounge", activity: "lounge" as AgentActivity },
    };
    usePositions.getState().set(positions);
    expect(usePositions.getState().byAgent).toEqual(positions);
  });

  it("overwrites previous snapshot on set()", () => {
    usePositions.getState().set({
      agent1: { x: 0, z: 0, spaceId: "office", activity: "desk" as AgentActivity },
    });
    usePositions.getState().set({
      agent2: { x: 5, z: 5, spaceId: "meeting", activity: "meeting" as AgentActivity },
    });
    const state = usePositions.getState().byAgent;
    expect(Object.keys(state)).toEqual(["agent2"]);
    expect(state["agent1"]).toBeUndefined();
  });

  it("accepts all valid activity types", () => {
    const activities: AgentActivity[] = [
      "desk", "lounge", "break", "fainted", "walking", "meeting", "waiting",
    ];
    for (const activity of activities) {
      usePositions.getState().set({ a: { x: 0, z: 0, spaceId: "office", activity } });
      expect(usePositions.getState().byAgent["a"]?.activity).toBe(activity);
    }
  });

  it("set() can hold many agents without losing any", () => {
    const batch: Record<string, { x: number; z: number; spaceId: string; activity: AgentActivity }> = {};
    for (let i = 0; i < 20; i++) {
      batch[`agent-${i}`] = { x: i * 0.5, z: i * -0.5, spaceId: "office", activity: "desk" };
    }
    usePositions.getState().set(batch);
    expect(Object.keys(usePositions.getState().byAgent).length).toBe(20);
  });
});
