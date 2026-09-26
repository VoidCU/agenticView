import { describe, expect, it } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { boardLines, BOARD_REFRESH_MS, BOARD_MAX_LINES } from "../src/scene/Whiteboard";
import { useWalk } from "../src/state/walk";
import { task, worker } from "./fixtures";

describe("whiteboard lines", () => {
  const podA = buildSpaces(1).find((s) => s.id === "pod-a")!;
  it("lists the pod's tasks with status, active work before done", () => {
    const lines = boardLines(podA, [worker], [
      task({ id: "d", title: "Done thing", status: "done", finishedAt: new Date(0).toISOString() }),
      task({ id: "r", title: "Running thing", status: "running" }),
      task({ id: "q", title: "Queued thing", status: "assigned" }),
    ]);
    expect(lines).toEqual([
      { title: "Running thing", status: "running" },
      { title: "Queued thing", status: "queued" },
      { title: "Done thing", status: "done" },
    ]);
  });
  it("throttles redraws to at most once a second and caps rows", () => {
    expect(BOARD_REFRESH_MS).toBeGreaterThanOrEqual(1000);
    expect(BOARD_MAX_LINES).toBeGreaterThan(3);
  });
});

describe("walk exit position", () => {
  it("records where the player stopped so the You robot can walk home", () => {
    useWalk.getState().setExitAt({ x: 3, z: -2 });
    expect(useWalk.getState().exitAt).toMatchObject({ x: 3, z: -2 });
  });
});
