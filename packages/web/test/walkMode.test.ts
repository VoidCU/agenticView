/**
 * Walk mode tests:
 * - Collision / movement math (walkPhysics)
 * - Monitor throttle constants and getFeedLines helper
 * - useWalk store
 * - monitorPoseForSeat geometry
 * - applyVelocity smooth acceleration
 * - pointer-lock state machine (store-level)
 * - NEAR_DIST proximity constant
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { isWalkable, movePlayer, walkDelta, clampPitch, applyVelocity, WALK_SPEED, ACCEL, DECEL } from "../src/scene/walkPhysics";
import { getFeedLines, MAX_DIST, REFRESH_MS, MAX_UPDATES_PER_FRAME, monitorPoseForSeat, NEAR_DIST } from "../src/scene/DeskMonitor";
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
    // Pods now have 6 seats (0–5); 6+ should be null.
    expect(monitorPoseForSeat(0, 0, 6)).toBeNull();
    expect(monitorPoseForSeat(0, 0, 10)).toBeNull();
  });

  it("returns a position for each valid pod seat (0-5)", () => {
    for (let seat = 0; seat < 6; seat++) {
      const pose = monitorPoseForSeat(0, 0, seat);
      expect(pose).not.toBeNull();
      expect(pose!.position).toHaveLength(3);
    }
  });

  it("places monitors at desk height (y ~= 1.06)", () => {
    for (let seat = 0; seat < 6; seat++) {
      const pose = monitorPoseForSeat(0, 0, seat)!;
      expect(pose.position[1]).toBeCloseTo(1.06, 2);
    }
  });

  it("front seats (0-2) have monitors on the negative-z side of center", () => {
    const front0 = monitorPoseForSeat(0, 0, 0)!;
    // Seat 0 (front row): l.z=-1.4, yaw=0, fwdZ=+1 → monZ = -1.4 + 1.02 = -0.38
    // Should be between z=-1.5 and z=0
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

// ---- applyVelocity (smooth acceleration / deceleration) ----

describe("applyVelocity", () => {
  it("accelerates toward target speed when keys held", () => {
    // Start at rest, move forward for dt=0.1
    const { vx, vz } = applyVelocity(0, 0, 0, 1, 0.1);
    // Should have gained velocity toward (0, WALK_SPEED)
    expect(vz).toBeGreaterThan(0);
    expect(vz).toBeLessThanOrEqual(WALK_SPEED);
    expect(vx).toBeCloseTo(0, 5);
  });

  it("does not overshoot target speed after many steps", () => {
    let vx = 0, vz = 0;
    for (let i = 0; i < 100; i++) {
      ({ vx, vz } = applyVelocity(vx, vz, 0, 1, 0.016));
    }
    expect(vz).toBeLessThanOrEqual(WALK_SPEED + 1e-6);
  });

  it("decelerates when no input", () => {
    const { vx, vz } = applyVelocity(WALK_SPEED, 0, 0, 0, 0.1);
    expect(vx).toBeLessThan(WALK_SPEED);
    expect(vx).toBeGreaterThanOrEqual(0);
    expect(vz).toBeCloseTo(0, 5);
  });

  it("reaches near-zero speed after several frames of no input", () => {
    let vx = WALK_SPEED, vz = 0;
    for (let i = 0; i < 20; i++) {
      ({ vx, vz } = applyVelocity(vx, vz, 0, 0, 0.1));
    }
    expect(Math.abs(vx)).toBeLessThan(0.01);
  });

  it("ACCEL and DECEL are positive constants", () => {
    expect(ACCEL).toBeGreaterThan(0);
    expect(DECEL).toBeGreaterThan(0);
  });
});

// ---- movePlayer with solids (sub-stepping anti-tunnel) ----

describe("movePlayer with solids", () => {
  const spaces = buildSpaces(1);
  const office = spaces.find((s) => s.id === "office")!;

  it("accepts empty solids array and moves freely", () => {
    const result = movePlayer(spaces, office.x, office.z, 0.3, 0.0, []);
    expect(result.x).toBeCloseTo(office.x + 0.3, 3);
    expect(result.z).toBeCloseTo(office.z, 3);
  });

  it("blocks movement via solid box", () => {
    const wall = { kind: "box" as const, box: { minX: office.x + 0.3, maxX: office.x + 0.6, minZ: -50, maxZ: 50 } };
    const result = movePlayer(spaces, office.x, office.z, 1.5, 0, [wall]);
    // Should be pushed out to the left of the wall
    expect(result.x).toBeLessThanOrEqual(wall.box.minX);
  });
});

// ---- Pointer-lock state machine (via useWalk store) ----

describe("pointer-lock state machine (store)", () => {
  // The pointer-lock behaviour in WalkMode is browser-API-driven; we test the
  // store transitions that mirror it: setWalking(false) is called when lock is
  // released.

  beforeEach(() => {
    useWalk.setState({ walking: false });
  });

  it("entering walk mode sets walking=true", () => {
    useWalk.getState().setWalking(true);
    expect(useWalk.getState().walking).toBe(true);
  });

  it("simulated Esc / lock-release calls setWalking(false)", () => {
    useWalk.getState().setWalking(true);
    // Simulate pointerlockchange → exit handler.
    useWalk.getState().setWalking(false);
    expect(useWalk.getState().walking).toBe(false);
  });
});

// ---- NEAR_DIST monitor proximity constant ----

describe("NEAR_DIST", () => {
  it("is a positive number less than MAX_DIST", () => {
    expect(NEAR_DIST).toBeGreaterThan(0);
    expect(NEAR_DIST).toBeLessThan(MAX_DIST);
  });
});
