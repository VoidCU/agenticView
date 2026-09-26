import { describe, it, expect } from "vitest";
import { HEX_R, HEX_APOTHEM } from "../src/office.js";
import { loungeSpots, assignLoungeSpots, rpsFacing } from "../src/lounge.js";

// ── loungeSpots ───────────────────────────────────────────────────────────────

describe("loungeSpots", () => {
  it("returns a layout object with spots and furniture", () => {
    const layout = loungeSpots();
    expect(layout.spots.length).toBeGreaterThan(0);
    expect(layout.furniture.length).toBeGreaterThan(0);
  });

  it("all spot ids are unique", () => {
    const { spots } = loungeSpots();
    const ids = spots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("base layout has at least 12 spots (enough for a full lounge roster)", () => {
    const { spots } = loungeSpots(0);
    expect(spots.filter((s) => !s.waiting).length).toBeGreaterThanOrEqual(12);
  });

  it("all non-waiting spots are inside the room (within HEX_R of centre)", () => {
    const { spots } = loungeSpots(0, HEX_R);
    for (const s of spots.filter((sp) => !sp.waiting)) {
      const dist = Math.hypot(s.x, s.z);
      expect(dist).toBeLessThan(HEX_R);
    }
  });

  it("12 agents produce 12 non-waiting spots (no overflow)", () => {
    const { spots } = loungeSpots(12, HEX_R);
    const inside = spots.filter((s) => !s.waiting);
    expect(inside.length).toBeGreaterThanOrEqual(12);
  });

  it("over-capacity: waiting spots are added and placed outside the room", () => {
    const baseSpots = loungeSpots(0, HEX_R).spots.filter((s) => !s.waiting).length;
    const overflow = 4;
    const { spots } = loungeSpots(baseSpots + overflow, HEX_R);
    const waiting = spots.filter((s) => s.waiting);
    expect(waiting.length).toBe(overflow);
    // Waiting spots are outside the room apothem.
    for (const w of waiting) {
      const dist = Math.hypot(w.x, w.z);
      expect(dist).toBeGreaterThan(HEX_APOTHEM * 0.9);
    }
  });

  it("waiting spots are all distinct positions", () => {
    const baseSpots = loungeSpots(0, HEX_R).spots.filter((s) => !s.waiting).length;
    const { spots } = loungeSpots(baseSpots + 6, HEX_R);
    const waiting = spots.filter((s) => s.waiting);
    const keys = waiting.map((s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("spots scale proportionally with hexR", () => {
    const bigR = 14;
    const { spots: small } = loungeSpots(0, HEX_R);
    const { spots: big } = loungeSpots(0, bigR);
    expect(small.length).toBe(big.length);
    // The big layout should be proportionally farther from centre.
    const avgSmall = small.filter((s) => !s.waiting).reduce((acc, s) => acc + Math.hypot(s.x, s.z), 0) / small.length;
    const avgBig = big.filter((s) => !s.waiting).reduce((acc, s) => acc + Math.hypot(s.x, s.z), 0) / big.length;
    expect(avgBig / avgSmall).toBeCloseTo(bigR / HEX_R, 1);
  });

  it("each spot has a valid facing vector (unit-ish, non-zero)", () => {
    const { spots } = loungeSpots(0, HEX_R);
    for (const s of spots) {
      const len = Math.hypot(s.facing.x, s.facing.z);
      expect(len).toBeGreaterThan(0.99);
      expect(len).toBeLessThan(1.01);
    }
  });

  it("furniture pieces cover all spot kinds", () => {
    const { furniture } = loungeSpots(0, HEX_R);
    const kinds = new Set(furniture.map((f) => f.kind));
    expect(kinds.has("sofa")).toBe(true);
    expect(kinds.has("armchair")).toBe(true);
    expect(kinds.has("counter")).toBe(true);
    expect(kinds.has("beanbag")).toBe(true);
  });
});

// ── assignLoungeSpots ─────────────────────────────────────────────────────────

describe("assignLoungeSpots", () => {
  const agentIds = (n: number) => Array.from({ length: n }, (_, i) => `agent-${i}`);

  it("12 agents all get unique spots", () => {
    const { spots } = loungeSpots(12);
    const assignment = assignLoungeSpots(agentIds(12), spots);
    const assigned = Object.values(assignment);
    expect(assigned.length).toBe(12);
    expect(new Set(assigned).size).toBe(12);
  });

  it("no two agents share a spot", () => {
    const { spots } = loungeSpots(8);
    const ids = agentIds(8);
    const assignment = assignLoungeSpots(ids, spots);
    const spotIds = Object.values(assignment);
    expect(new Set(spotIds).size).toBe(spotIds.length);
  });

  it("assigned spots actually exist in the spot list", () => {
    const { spots } = loungeSpots(10);
    const spotSet = new Set(spots.map((s) => s.id));
    const assignment = assignLoungeSpots(agentIds(10), spots);
    for (const spotId of Object.values(assignment)) {
      expect(spotSet.has(spotId)).toBe(true);
    }
  });

  it("excess agents beyond capacity are not assigned", () => {
    const { spots } = loungeSpots(0); // no waiting spots
    const n = spots.length + 3;
    const assignment = assignLoungeSpots(agentIds(n), spots);
    expect(Object.keys(assignment).length).toBeLessThanOrEqual(spots.length);
  });

  it("stability: agent keeps spot when one agent leaves", () => {
    const { spots } = loungeSpots(6);
    const ids = agentIds(6);
    const first = assignLoungeSpots(ids, spots);
    // Remove agent-2
    const remaining = ids.filter((id) => id !== "agent-2");
    const second = assignLoungeSpots(remaining, spots, first);
    // All agents still present should keep their spot.
    for (const id of remaining) {
      expect(second[id]).toBe(first[id]);
    }
  });

  it("stability: order independence — same agents produce same assignment", () => {
    const { spots } = loungeSpots(8);
    const ids = agentIds(8);
    const asc = assignLoungeSpots([...ids], spots);
    const desc = assignLoungeSpots([...ids].reverse(), spots);
    // Both should produce identical results (sorted determinism).
    for (const id of ids) {
      expect(asc[id]).toBe(desc[id]);
    }
  });

  it("all assigned positions are unique in world space (no stacking)", () => {
    const layout = loungeSpots(12);
    const assignment = assignLoungeSpots(agentIds(12), layout.spots);
    const spotById = new Map(layout.spots.map((s) => [s.id, s]));
    const positions = Object.values(assignment).map((id) => {
      const s = spotById.get(id)!;
      return `${s.x.toFixed(3)},${s.z.toFixed(3)}`;
    });
    expect(new Set(positions).size).toBe(positions.length);
  });
});

// ── rpsFacing ─────────────────────────────────────────────────────────────────

describe("rpsFacing", () => {
  it("players face each other: yawA points from a to b", () => {
    const a = { x: -1, z: 0 };
    const b = { x: 1, z: 0 };
    const { yawA, yawB } = rpsFacing(a, b);
    // a → b is +x direction; yaw in three.js: sin(yaw)=dx, cos(yaw)=dz → yaw = π/2
    expect(Math.sin(yawA)).toBeCloseTo(1, 5);
    expect(Math.cos(yawA)).toBeCloseTo(0, 5);
    // b → a is −x direction; yaw = -π/2
    expect(Math.sin(yawB)).toBeCloseTo(-1, 5);
    expect(Math.cos(yawB)).toBeCloseTo(0, 5);
  });

  it("yawA and yawB are exactly opposite (differ by π)", () => {
    const a = { x: 0, z: -2 };
    const b = { x: 0, z: 2 };
    const { yawA, yawB } = rpsFacing(a, b);
    const diff = Math.abs(yawA - yawB);
    const wrap = diff > Math.PI ? 2 * Math.PI - diff : diff;
    expect(wrap).toBeCloseTo(Math.PI, 5);
  });

  it("works for diagonal positions", () => {
    const a = { x: 1, z: 1 };
    const b = { x: -1, z: -1 };
    const { yawA, yawB } = rpsFacing(a, b);
    // They should face each other (directions are opposite)
    expect(Math.sin(yawA) + Math.sin(yawB)).toBeCloseTo(0, 5);
    expect(Math.cos(yawA) + Math.cos(yawB)).toBeCloseTo(0, 5);
  });
});
