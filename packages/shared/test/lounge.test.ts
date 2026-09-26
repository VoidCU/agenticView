import { describe, it, expect } from "vitest";
import { HEX_R, HEX_APOTHEM } from "../src/office.js";
import {
  loungeSpots,
  assignLoungeSpots,
  rpsFacing,
  nearbyRpsPairs,
  loungeAssignmentFor,
  RPS_PAIR_MAX_DIST,
  type LoungeFurniturePiece,
} from "../src/lounge.js";

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

// ── Geometry: footprints, overlaps, walls, walkway, game spots ────────────────

type P = { x: number; z: number };
function corners(f: LoungeFurniturePiece): P[] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const lx = (sx! * f.w) / 2;
    const lz = (sz! * f.d) / 2;
    return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
  });
}
function inside(f: LoungeFurniturePiece, p: P): boolean {
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  const lx = dx * Math.cos(f.yaw) - dz * Math.sin(f.yaw);
  const lz = dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw);
  return Math.abs(lx) <= f.w / 2 && Math.abs(lz) <= f.d / 2;
}
function overlaps(a: LoungeFurniturePiece, b: LoungeFurniturePiece): boolean {
  const ca = corners(a);
  const cb = corners(b);
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2].map((t) => ({ x: Math.cos(t), z: -Math.sin(t) }));
  for (const ax of axes) {
    const pa = ca.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
function segDist(p: P, a: P, b: P): number {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(p.x - a.x - t * vx, p.z - a.z - t * vz);
}

describe.each([HEX_R, 14])("lounge geometry (hexR=%s)", (R) => {
  const layout = loungeSpots(0, R);
  const apothem = (R * Math.sqrt(3)) / 2;

  it("every furniture piece has a footprint and lies inside the hex walls", () => {
    for (const f of layout.furniture) {
      expect(f.w).toBeGreaterThan(0);
      expect(f.d).toBeGreaterThan(0);
      for (const p of corners(f)) {
        for (let k = 0; k < 6; k++) {
          const t = ((30 + 60 * k) * Math.PI) / 180;
          expect(p.x * Math.cos(t) + p.z * Math.sin(t)).toBeLessThan(apothem);
        }
      }
    }
  });

  it("no two furniture pieces overlap, nor the coffee table", () => {
    const fs = layout.furniture;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) expect(overlaps(fs[i]!, fs[j]!), `${fs[i]!.id} vs ${fs[j]!.id}`).toBe(false);
      for (const p of corners(fs[i]!)) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(layout.tableR);
    }
  });

  it.each([0, 1, 2, 3, 4, 5])("walkway from doorway %s to the centre is clear (0.9 half-width)", (k) => {
    const t = layout.doorAngle + (k * Math.PI) / 3;
    const door = { x: apothem * Math.cos(t), z: apothem * Math.sin(t) };
    const centre = { x: 0, z: 0 };
    for (const f of layout.furniture) {
      for (const p of corners(f)) expect(segDist(p, door, centre)).toBeGreaterThan(0.9);
      expect(segDist(f, door, centre)).toBeGreaterThan(0.9);
    }
  });

  it("every seat spot sits inside its piece's footprint, faces the table", () => {
    const seats = layout.spots.filter((s) => s.kind === "sofa" || s.kind === "armchair" || s.kind === "beanbag");
    for (const s of seats) {
      const host = layout.furniture.filter((f) => f.kind === s.kind && inside(f, s));
      expect(host.length, s.id).toBe(1);
      expect(s.seatHeight).toBeGreaterThan(0);
      // Facing points toward the table: dot(facing, -pos) > 0.
      expect(s.facing.x * -s.x + s.facing.z * -s.z).toBeGreaterThan(0);
    }
  });

  it("standing/counter spots are not inside any furniture", () => {
    for (const s of layout.spots.filter((sp) => sp.pose === "stand")) {
      for (const f of layout.furniture) expect(inside(f, s), `${s.id} in ${f.id}`).toBe(false);
    }
  });

  it("game spots are facing pairs across the table, clear of furniture", () => {
    expect(layout.gameSpots.length).toBeGreaterThan(0);
    for (const [a, b] of layout.gameSpots) {
      for (const g of [a, b]) {
        expect(Math.hypot(g.x, g.z)).toBeGreaterThan(layout.tableR);
        for (const f of layout.furniture) expect(inside(f, g)).toBe(false);
      }
      expect(Math.sin(a.yaw) * (b.x - a.x) + Math.cos(a.yaw) * (b.z - a.z)).toBeGreaterThan(0);
      expect(Math.sin(b.yaw) * (a.x - b.x) + Math.cos(b.yaw) * (a.z - b.z)).toBeGreaterThan(0);
    }
  });
});

describe("nearbyRpsPairs", () => {
  const { spots } = loungeSpots(0);
  const byId = new Map(spots.map((s) => [s.id, s]));

  it("pairs only agents within 1.5 units, never far ones", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `w${String(i).padStart(2, "0")}`);
    const assignment = assignLoungeSpots(ids, spots);
    const pairs = nearbyRpsPairs(assignment, spots);
    expect(pairs.length).toBeGreaterThan(0);
    const paired = new Set(pairs.map((p) => `${p.a}|${p.b}`));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = byId.get(assignment[ids[i]!]!)!;
        const b = byId.get(assignment[ids[j]!]!)!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(paired.has(`${ids[i]}|${ids[j]}`)).toBe(d <= RPS_PAIR_MAX_DIST);
      }
    }
  });

  it("returns no pairs for two far-apart agents", () => {
    expect(nearbyRpsPairs({ a: "sofa-0", b: "counter-2" }, spots)).toEqual([]);
    expect(nearbyRpsPairs({ a: "sofa-0", b: "sofa-1" }, spots)).toHaveLength(1);
  });

  it("loungeAssignmentFor matches the scene's call", () => {
    const { layout, assignment } = loungeAssignmentFor(["x", "y"]);
    expect(layout.spots.length).toBe(loungeSpots(16).spots.length);
    expect(assignment).toEqual({ x: "sofa-0", y: "sofa-1" });
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
