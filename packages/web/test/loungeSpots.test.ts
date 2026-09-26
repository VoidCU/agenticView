/**
 * Tests for loungeSpots / assignLoungeSpots / rpsFacing from @agenticview/shared.
 *
 * Covers:
 *  - Base layout capacity (16 spots, no waiting)
 *  - Overflow: extra agents get waiting spots outside the door
 *  - Stable re-assignment: prior spot kept when still free
 *  - Pose mapping: seatHeight values by kind
 *  - rpsFacing: players face each other
 */

import { describe, it, expect } from "vitest";
import { loungeSpots, assignLoungeSpots, rpsFacing } from "@agenticview/shared";

describe("loungeSpots base layout", () => {
  const layout = loungeSpots();

  it("returns exactly 16 base spots", () => {
    const nonWaiting = layout.spots.filter((s) => !s.waiting);
    expect(nonWaiting.length).toBe(16);
  });

  it("includes sofas, armchairs, counter, beanbag, standing kinds", () => {
    const kinds = new Set(layout.spots.map((s) => s.kind));
    expect(kinds.has("sofa")).toBe(true);
    expect(kinds.has("armchair")).toBe(true);
    expect(kinds.has("counter")).toBe(true);
    expect(kinds.has("beanbag")).toBe(true);
    expect(kinds.has("standing")).toBe(true);
  });

  it("has 6 sofa spots (2 sofas x 3 seats)", () => {
    const sofaSpots = layout.spots.filter((s) => s.kind === "sofa");
    expect(sofaSpots.length).toBe(6);
  });

  it("has positive seatHeight for sofa, armchair, and beanbag spots", () => {
    for (const spot of layout.spots) {
      if (spot.kind === "sofa" || spot.kind === "armchair" || spot.kind === "beanbag") {
        expect(spot.seatHeight).toBeGreaterThan(0);
      }
    }
  });

  it("has zero seatHeight for counter and standing spots", () => {
    for (const spot of layout.spots) {
      if (spot.kind === "counter" || spot.kind === "standing") {
        expect(spot.seatHeight).toBe(0);
      }
    }
  });

  it("spot ids are unique", () => {
    const ids = layout.spots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all spots have valid facing vectors derived from yaw", () => {
    for (const spot of layout.spots) {
      const len = Math.hypot(spot.facing.x, spot.facing.z);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it("returns furniture pieces matching the spot kinds", () => {
    const furnitureKinds = new Set(layout.furniture.map((f) => f.kind));
    expect(furnitureKinds.has("sofa")).toBe(true);
    expect(furnitureKinds.has("armchair")).toBe(true);
    expect(furnitureKinds.has("counter")).toBe(true);
    expect(furnitureKinds.has("beanbag")).toBe(true);
  });
});

describe("loungeSpots overflow", () => {
  it("appends waiting spots when capacityHint > 16", () => {
    const layout = loungeSpots(20);
    const waiting = layout.spots.filter((s) => s.waiting === true);
    expect(waiting.length).toBe(4); // 20 - 16 = 4 waiting spots
  });

  it("waiting spots are outside the room (larger distance from center)", () => {
    const layout = loungeSpots(18);
    const waiting = layout.spots.filter((s) => s.waiting);
    expect(waiting.length).toBe(2);
    for (const spot of waiting) {
      const dist = Math.hypot(spot.x, spot.z);
      // Waiting spots are beyond the apothem (~6.06 for HEX_R=7)
      // They are placed just outside the door, so dist > 5
      expect(dist).toBeGreaterThan(4);
    }
  });

  it("no waiting spots when capacityHint <= 16", () => {
    const layout = loungeSpots(10);
    const waiting = layout.spots.filter((s) => s.waiting);
    expect(waiting.length).toBe(0);
  });
});

describe("assignLoungeSpots", () => {
  const layout = loungeSpots();

  it("assigns each agent to a unique spot", () => {
    const agentIds = ["a1", "a2", "a3", "a4", "a5"];
    const result = assignLoungeSpots(agentIds, layout.spots);
    expect(Object.keys(result).length).toBe(5);
    const spots = Object.values(result);
    expect(new Set(spots).size).toBe(5); // all unique
  });

  it("all assigned spots are valid spot ids", () => {
    const spotIds = new Set(layout.spots.map((s) => s.id));
    const agentIds = ["x1", "x2", "x3"];
    const result = assignLoungeSpots(agentIds, layout.spots);
    for (const spotId of Object.values(result)) {
      expect(spotIds.has(spotId)).toBe(true);
    }
  });

  it("stable: prior spot is kept when still free", () => {
    const agentIds = ["b1", "b2"];
    const first = assignLoungeSpots(agentIds, layout.spots);
    // Re-assign with prior: agent b1 should keep its spot
    const second = assignLoungeSpots(agentIds, layout.spots, first);
    expect(second["b1"]).toBe(first["b1"]);
    expect(second["b2"]).toBe(first["b2"]);
  });

  it("overflow: agents beyond 16 get waiting spots when layout has them", () => {
    const bigLayout = loungeSpots(22);
    const agentIds = Array.from({ length: 20 }, (_, i) => `agent-${i}`);
    const result = assignLoungeSpots(agentIds, bigLayout.spots);
    expect(Object.keys(result).length).toBe(20);
  });

  it("excess agents beyond all spots are unassigned", () => {
    const agentIds = Array.from({ length: 20 }, (_, i) => `z${i}`);
    // Base layout only has 16 spots
    const result = assignLoungeSpots(agentIds, layout.spots);
    expect(Object.keys(result).length).toBe(16); // only 16 can be assigned
  });

  it("is deterministic (same input → same output)", () => {
    const agentIds = ["d1", "d2", "d3"];
    const r1 = assignLoungeSpots(agentIds, layout.spots);
    const r2 = assignLoungeSpots(agentIds, layout.spots);
    expect(r1).toEqual(r2);
  });
});

describe("rpsFacing", () => {
  it("players face each other", () => {
    const a = { x: -1, z: 0 };
    const b = { x: 1, z: 0 };
    const { yawA, yawB } = rpsFacing(a, b);
    // A is at -1, B is at +1. A should face +x (yaw=PI/2) and B should face -x (yaw=-PI/2)
    expect(yawA).toBeCloseTo(Math.PI / 2, 4);
    expect(yawB).toBeCloseTo(-Math.PI / 2, 4);
  });

  it("yawA and yawB are opposite directions", () => {
    const a = { x: 0, z: -2 };
    const b = { x: 0, z: 2 };
    const { yawA, yawB } = rpsFacing(a, b);
    // The facing angles should differ by ~PI
    const diff = Math.abs(yawA - yawB);
    expect(diff).toBeCloseTo(Math.PI, 3);
  });
});
