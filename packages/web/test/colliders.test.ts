/**
 * Tests for scene/colliders.ts
 *
 * Covers:
 *  - resolveBox: AABB push-out on all four sides
 *  - resolveCircle: circular obstacle push-out
 *  - resolveMove: sub-stepped movement, sliding, no tunnelling
 *  - buildColliders: returns empty list in phase A
 */
import { describe, it, expect } from "vitest";
import {
  resolveBox,
  resolveCircle,
  resolveMove,
  buildColliders,
  PLAYER_RADIUS,
  type AABB,
  type Circle,
  type Solid,
} from "../src/scene/colliders";

// ---- resolveBox ----

describe("resolveBox", () => {
  const box: AABB = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const r = PLAYER_RADIUS;

  it("passes through a point outside the box", () => {
    const result = resolveBox(5, 5, box, r);
    expect(result.x).toBe(5);
    expect(result.z).toBe(5);
  });

  it("pushes out from the left face", () => {
    // Point just inside the left expanded face
    const cx = box.minX - r / 2; // inside expanded box
    const result = resolveBox(cx, 0, box, r);
    expect(result.x).toBeCloseTo(box.minX - r, 5);
    expect(result.z).toBe(0);
  });

  it("pushes out from the right face", () => {
    const cx = box.maxX + r / 2;
    const result = resolveBox(cx, 0, box, r);
    expect(result.x).toBeCloseTo(box.maxX + r, 5);
    expect(result.z).toBe(0);
  });

  it("pushes out from the front face (Z)", () => {
    const result = resolveBox(0, box.minZ - r / 2, box, r);
    expect(result.z).toBeCloseTo(box.minZ - r, 5);
    expect(result.x).toBe(0);
  });

  it("pushes out from the back face (Z)", () => {
    const result = resolveBox(0, box.maxZ + r / 2, box, r);
    expect(result.z).toBeCloseTo(box.maxZ + r, 5);
    expect(result.x).toBe(0);
  });

  it("leaves position unchanged for a point exactly on the expanded edge", () => {
    // At exactly the expanded boundary → no overlap
    const result = resolveBox(box.maxX + r, 0, box, r);
    expect(result.x).toBe(box.maxX + r);
  });
});

// ---- resolveCircle ----

describe("resolveCircle", () => {
  const c: Circle = { cx: 0, cz: 0, r: 1 };
  const r = PLAYER_RADIUS;

  it("passes through a point outside the circle", () => {
    const result = resolveCircle(5, 0, c, r);
    expect(result.x).toBe(5);
    expect(result.z).toBe(0);
  });

  it("pushes out radially when inside", () => {
    // point 0.5 from centre — inside (c.r + r = 1.28)
    const result = resolveCircle(0.5, 0, c, r);
    const dist = Math.hypot(result.x - c.cx, result.z - c.cz);
    expect(dist).toBeCloseTo(c.r + r, 4);
  });

  it("pushes out in the correct direction", () => {
    // point along +x
    const result = resolveCircle(0.8, 0, c, r);
    expect(result.x).toBeGreaterThan(0);
    expect(result.z).toBeCloseTo(0, 4);
  });

  it("handles point at centre gracefully (no NaN)", () => {
    const result = resolveCircle(0, 0, c, r);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.z)).toBe(true);
  });
});

// ---- resolveMove ----

describe("resolveMove: sliding collision", () => {
  const wall: Solid = {
    kind: "box",
    box: { minX: 1.5, maxX: 1.8, minZ: -10, maxZ: 10 },
  };

  it("moves freely with no solids", () => {
    const result = resolveMove([], 0, 0, 2, 0);
    expect(result.x).toBeCloseTo(2, 4);
    expect(result.z).toBeCloseTo(0, 4);
  });

  it("stops short of a wall when moving directly into it", () => {
    // Moving from x=0 toward +x into a wall at x≈1.5–1.8
    const result = resolveMove([wall], 0, 0, 3, 0);
    // Should be pushed out to left of expanded wall face
    expect(result.x).toBeLessThan(wall.box.minX);
  });

  it("slides along a wall when moving diagonally", () => {
    // Move diagonally: mostly +x (blocked) + small +z (free)
    const result = resolveMove([wall], 0, 0, 3, 0.3);
    // X should be blocked; Z movement should survive
    expect(result.x).toBeLessThan(wall.box.minX);
    expect(result.z).toBeGreaterThan(0);
  });

  it("sub-steps: reaches a box correctly with steps=1 vs steps=8", () => {
    // Small movement that ends inside the wall — both step counts should resolve
    const r1 = resolveMove([wall], 1.0, 0, 1.0, 0, 1);
    const r8 = resolveMove([wall], 1.0, 0, 1.0, 0, 8);
    // Both should be blocked from entering the wall
    expect(r1.x).toBeLessThan(wall.box.minX);
    expect(r8.x).toBeLessThan(wall.box.minX);
  });

  it("resolves multiple overlapping solids", () => {
    const wallA: Solid = { kind: "box", box: { minX: 0.5, maxX: 0.8, minZ: -5, maxZ: 5 } };
    const wallB: Solid = { kind: "box", box: { minX: 1.5, maxX: 1.8, minZ: -5, maxZ: 5 } };
    const result = resolveMove([wallA, wallB], 0, 0, 5, 0);
    // Should be blocked by the first wall
    expect(result.x).toBeLessThan(wallA.box.minX);
  });
});

// ---- buildColliders (phase A) ----

describe("buildColliders", () => {
  it("returns an empty array in phase A", () => {
    const colliders = buildColliders();
    expect(Array.isArray(colliders)).toBe(true);
    expect(colliders).toHaveLength(0);
  });
});

// ---- PLAYER_RADIUS ----

describe("PLAYER_RADIUS", () => {
  it("is a positive number less than 1 unit", () => {
    expect(PLAYER_RADIUS).toBeGreaterThan(0);
    expect(PLAYER_RADIUS).toBeLessThan(1);
  });
});
