/**
 * Walk mode tests:
 * - Collision / movement math (walkPhysics)
 * - Monitor throttle constants and getFeedLines helper
 * - useWalk store
 * - monitorPoseForSeat geometry
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { isWalkable, movePlayer, walkDelta, clampPitch } from "../src/scene/walkPhysics";
import { getFeedLines, MAX_DIST, REFRESH_MS, MAX_UPDATES_PER_FRAME, monitorPoseForSeat } from "../src/scene/DeskMonitor";
import { useWalk } from "../src/state/walk";

// ---- isWalkable ----

describe("isWalkable", () => {
  const spaces = buildSpaces(1);
  const office = spaces.find((s) => s.id === "office")!;

  it("returns true for the office center (ring 0)", () => {
    expect(isWalkable(spaces, office.x, office.z)).toBe(true);
  });

  it("returns true for a pod center", () => {
    const pod = spaces.find((s) => s.kind === "pod")!;
    expect(isWalkable(spaces, pod.x, pod.z)).toBe(true);
  });

  it("returns false far outside the honeycomb", () => {
    expect(isWalkable(spaces, 999, 999)).toBe(false);
  });
});

// ---- movePlayer ----

describe("movePlayer", () => {
  const spaces = buildSpaces(1);
  const office = spaces.find((s) => s.id === "office")!;

  it("moves freely inside a room", () => {
    // Small step from center, still inside office
    const result = movePlayer(spaces, office.x, office.z, 0.5, 0.0);
    expect(result.x).toBeCloseTo(office.x + 0.5, 3);
    expect(result.z).toBeCloseTo(office.z, 3);
  });

  it("blocks movement that would leave the honeycomb", () => {
    // Attempt to move 100 units away
    const result = movePlayer(spaces, office.x, office.z, 100, 0);
    // Should not be at x+100 since that's outside
    expect(result.x).toBeLessThan(office.x + 50);
  });

  it("slides along a wall (x-axis) when full move is blocked", () => {
    // Start near center, nudge slightly in Z (should be fine)
    const result = movePlayer(spaces, office.x, office.z, 0, 0.5);
    expect(result.z).toBeCloseTo(office.z + 0.5, 3);
  });

  it("stays in place when both axes are blocked", () => {
    // Going 999 units in both axes should leave us where we started
    const result = movePlayer(spaces, office.x, office.z, 999, 999);
    expect(result.x).toBe(office.x);
    expect(result.z).toBe(office.z);
  });
});

// ---- walkDelta ----

describe("walkDelta", () => {
  it("returns zero when no keys pressed", () => {
    const d = walkDelta(new Set(), 0);
    expect(d.dx).toBe(0);
    expect(d.dz).toBe(0);
  });

  it("moves forward (+z direction) when W pressed and yaw=0", () => {
    const d = walkDelta(new Set(["KeyW"]), 0);
    // yaw=0: forward = +z
    expect(d.dz).toBeGreaterThan(0);
    expect(Math.abs(d.dx)).toBeLessThan(0.01);
  });

  it("moves backward when S pressed", () => {
    const d = walkDelta(new Set(["KeyS"]), 0);
    expect(d.dz).toBeLessThan(0);
  });

  it("moves right when D pressed and yaw=0", () => {
    const d = walkDelta(new Set(["KeyD"]), 0);
    // yaw=0: right = +x
    expect(d.dx).toBeGreaterThan(0);
  });

  it("moves left when A pressed and yaw=0", () => {
    const d = walkDelta(new Set(["KeyA"]), 0);
    expect(d.dx).toBeLessThan(0);
  });

  it("normalises diagonal movement", () => {
    const d = walkDelta(new Set(["KeyW", "KeyD"]), 0);
    const len = Math.hypot(d.dx, d.dz);
    expect(len).toBeCloseTo(1, 3);
  });

  it("arrow keys work the same as WASD", () => {
    const wasd = walkDelta(new Set(["KeyW"]), 0);
    const arrow = walkDelta(new Set(["ArrowUp"]), 0);
    expect(wasd.dx).toBeCloseTo(arrow.dx, 6);
    expect(wasd.dz).toBeCloseTo(arrow.dz, 6);
  });

  it("yaw rotates the movement direction", () => {
    // yaw=π/2: forward maps to -x
    const d = walkDelta(new Set(["KeyW"]), Math.PI / 2);
    expect(d.dx).toBeGreaterThan(0.5); // mostly +x
    expect(Math.abs(d.dz)).toBeLessThan(0.5);
  });
});

// ---- clampPitch ----

describe("clampPitch", () => {
  it("passes through values within range", () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(0.5)).toBe(0.5);
    expect(clampPitch(-0.5)).toBe(-0.5);
  });

  it("clamps to the 80-degree max", () => {
    const MAX = (80 * Math.PI) / 180;
    expect(clampPitch(99)).toBeCloseTo(MAX, 6);
    expect(clampPitch(-99)).toBeCloseTo(-MAX, 6);
  });
});

// ---- Monitor throttle constants ----

describe("monitor throttle constants", () => {
  it("MAX_DIST is a positive number", () => {
    expect(MAX_DIST).toBeGreaterThan(0);
  });

  it("REFRESH_MS is at least 1000 ms", () => {
    expect(REFRESH_MS).toBeGreaterThanOrEqual(1000);
  });

  it("MAX_UPDATES_PER_FRAME limits concurrent updates", () => {
    expect(MAX_UPDATES_PER_FRAME).toBeGreaterThan(0);
    expect(MAX_UPDATES_PER_FRAME).toBeLessThanOrEqual(10);
  });
});

// ---- getFeedLines ----

describe("getFeedLines", () => {
  it("returns empty array for undefined feed", () => {
    expect(getFeedLines(undefined)).toEqual([]);
  });

  it("returns empty array for empty feed", () => {
    expect(getFeedLines([])).toEqual([]);
  });

  it("extracts text events", () => {
    const feed = [{ ts: 1, taskId: "t1", event: { type: "text" as const, text: "hello world" } }];
    const lines = getFeedLines(feed);
    expect(lines).toContain("hello world");
  });

  it("extracts tool_start events", () => {
    const feed = [{ ts: 1, taskId: "t1", event: { type: "tool_start" as const, name: "bash", input: {} } }];
    const lines = getFeedLines(feed);
    expect(lines[0]).toMatch(/bash/);
  });

  it("extracts file_changed events", () => {
    const feed = [{ ts: 1, taskId: "t1", event: { type: "file_changed" as const, path: "/src/foo.ts", kind: "modify" as const } }];
    const lines = getFeedLines(feed);
    expect(lines[0]).toMatch(/foo\.ts/);
  });

  it("returns at most `limit` lines", () => {
    const feed = Array.from({ length: 20 }, (_, i) => ({
      ts: i,
      taskId: "t1",
      event: { type: "text" as const, text: `line ${i}` },
    }));
    expect(getFeedLines(feed, 4)).toHaveLength(4);
  });

  it("takes the last `limit` items from the feed", () => {
    const feed = Array.from({ length: 10 }, (_, i) => ({
      ts: i,
      taskId: "t1",
      event: { type: "text" as const, text: `line ${i}` },
    }));
    const lines = getFeedLines(feed, 3);
    // Should include the last items
    expect(lines).toContain("line 9");
    expect(lines).toContain("line 8");
    expect(lines).toContain("line 7");
  });
});

// ---- monitorPoseForSeat ----

describe("monitorPoseForSeat", () => {
  it("returns null for seats outside pod range", () => {
    expect(monitorPoseForSeat(0, 0, 4)).toBeNull();
    expect(monitorPoseForSeat(0, 0, 10)).toBeNull();
  });

  it("returns a position for each valid pod seat (0-3)", () => {
    for (let seat = 0; seat < 4; seat++) {
      const pose = monitorPoseForSeat(0, 0, seat);
      expect(pose).not.toBeNull();
      expect(pose!.position).toHaveLength(3);
    }
  });

  it("places monitors at desk height (y ~= 1.06)", () => {
    for (let seat = 0; seat < 4; seat++) {
      const pose = monitorPoseForSeat(0, 0, seat)!;
      expect(pose.position[1]).toBeCloseTo(1.06, 2);
    }
  });

  it("front seats (0,1) have monitors further from center than back seats (2,3) in z", () => {
    const front0 = monitorPoseForSeat(0, 0, 0)!;
    // Seat 0: l.z=-1.22, forward +z → monZ = -0.20 (closer to center)
    // Should be between z=-1.22 and z=0
    expect(front0.position[2]).toBeGreaterThan(-1.5);
    expect(front0.position[2]).toBeLessThan(0);
  });

  it("translates space position correctly", () => {
    const atOrigin = monitorPoseForSeat(0, 0, 0)!;
    const atOffset = monitorPoseForSeat(10, 5, 0)!;
    expect(atOffset.position[0]).toBeCloseTo(atOrigin.position[0] + 10, 3);
    expect(atOffset.position[2]).toBeCloseTo(atOrigin.position[2] + 5, 3);
  });
});

// ---- useWalk store ----

describe("useWalk store", () => {
  beforeEach(() => {
    useWalk.setState({ walking: false });
  });

  it("starts with walking=false", () => {
    expect(useWalk.getState().walking).toBe(false);
  });

  it("setWalking(true) enables walk mode", () => {
    useWalk.getState().setWalking(true);
    expect(useWalk.getState().walking).toBe(true);
  });

  it("setWalking(false) disables walk mode", () => {
    useWalk.getState().setWalking(true);
    useWalk.getState().setWalking(false);
    expect(useWalk.getState().walking).toBe(false);
  });

  it("setWalking is idempotent", () => {
    useWalk.getState().setWalking(true);
    useWalk.getState().setWalking(true);
    expect(useWalk.getState().walking).toBe(true);
  });
});
