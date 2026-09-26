import { describe, expect, it } from "vitest";
import { planOffice } from "@agenticview/shared";
import { PLAYER_BODY_RADIUS, PLAYER_RADIUS, buildColliders, overlapsAny, resolveMove, type Solid } from "../src/scene/colliders";
import { CHAIR_D, CHAIR_W, potRadius, solidsForLayout } from "../src/scene/solids";
import { layoutFor } from "../src/scene/layout";
import { agent, manager } from "./fixtures";

const STEP = 4.5 / 60; // one frame at walk speed

/** Walk frame by frame in direction (dx, dz); returns the path. */
function walk(solids: Solid[], x: number, z: number, dx: number, dz: number, frames: number) {
  const len = Math.hypot(dx, dz);
  const path: { x: number; z: number }[] = [];
  for (let i = 0; i < frames; i++) {
    const p = resolveMove(solids, x, z, (dx / len) * STEP, (dz / len) * STEP);
    x = p.x;
    z = p.z;
    path.push(p);
  }
  return path;
}

describe("walk collision footprints", () => {
  it("the walker's radius is its slim body plus a small skin", () => {
    expect(PLAYER_RADIUS).toBeLessThanOrEqual(PLAYER_BODY_RADIUS + 0.05);
    expect(PLAYER_RADIUS).toBeLessThan(0.3);
  });

  it("plants collide as their pot, chairs as their seat", () => {
    const layout = layoutFor([manager]);
    const solids = solidsForLayout(layout);
    for (const p of solids.filter((s) => s.kind === "plant")) {
      expect("r" in p && p.r).toBeLessThanOrEqual(potRadius(1.25) + 1e-9);
    }
    for (const c of solids.filter((s) => s.kind === "chair")) {
      expect("w" in c && [c.w, c.d]).toEqual([CHAIR_W, CHAIR_D]);
    }
  });

  it("rotated furniture blocks its own footprint, not its axis-aligned bounds", () => {
    const layout = layoutFor([manager]);
    const colliders = buildColliders(layout);
    const oboxes = colliders.filter((c) => c.kind === "obox");
    expect(oboxes.length).toBeGreaterThan(10);
    // A credenza turned 45 degrees: the AABB corner region is free now.
    const cred: Solid = { kind: "obox", obox: { cx: 0, cz: 0, hw: 0.8, hd: 0.23, cos: Math.cos(Math.PI / 4), sin: Math.sin(Math.PI / 4) } };
    expect(overlapsAny([cred], 0.55, 0.55, PLAYER_RADIUS)).toBe(false); // inside the old AABB (half 0.73 + r)
    expect(overlapsAny([cred], 0, 0, PLAYER_RADIUS)).toBe(true);
    expect(overlapsAny([cred], 0.5, -0.5, PLAYER_RADIUS)).toBe(true); // along its long axis
  });

  it("diagonal walls block only their own thin footprint, not their axis-aligned bounds", () => {
    const layout = layoutFor([manager]);
    const all = solidsForLayout(layout);
    const colliders = buildColliders(layout);
    // buildColliders maps solidsForLayout one to one, in order.
    const wallIdx = all.flatMap((s, i) => (s.kind === "wall" ? [i] : []));
    const wallColliders = wallIdx.map((i) => colliders[i]!);
    expect(wallIdx.length).toBeGreaterThan(6);
    let diagonal = 0;
    for (const i of wallIdx) {
      const w = all[i] as { x: number; z: number; rot: number };
      if (Math.abs(Math.sin(w.rot)) > 0.1 && Math.abs(Math.cos(w.rot)) > 0.1) diagonal++;
      // Half a metre off either face, at the wall's midpoint: open floor.
      const nx = Math.sin(w.rot), nz = Math.cos(w.rot);
      expect(overlapsAny(wallColliders, w.x + nx * 0.5, w.z + nz * 0.5, PLAYER_RADIUS)).toBe(false);
      expect(overlapsAny(wallColliders, w.x - nx * 0.5, w.z - nz * 0.5, PLAYER_RADIUS)).toBe(false);
      expect(overlapsAny(wallColliders, w.x, w.z, PLAYER_RADIUS)).toBe(true);
    }
    expect(diagonal).toBeGreaterThan(0);
  });

  describe("a corridor of avatar diameter + 0.15 between a chair and a plant pot is walkable", () => {
    const gap = 2 * PLAYER_RADIUS + 0.15;
    const potR = potRadius(1.1);
    // Chair seat (0.5 x 0.48) turned a little, its face at x = -gap/2; pot surface at x = +gap/2.
    const yaw = 0.3;
    const halfX = (CHAIR_W / 2) * Math.cos(yaw) + (CHAIR_D / 2) * Math.sin(yaw);
    const chairSolid: Solid = { kind: "obox", obox: { cx: -gap / 2 - halfX, cz: 0, hw: CHAIR_W / 2, hd: CHAIR_D / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) } };
    const plantSolid: Solid = { kind: "circle", circle: { cx: gap / 2 + potR, cz: 0, r: potR } };
    const solids = [chairSolid, plantSolid];

    for (const [label, x0, dx] of [
      ["straight down the middle", 0, 0],
      ["hugging the plant side (slides round the pot)", 0.35, 0],
      ["hugging the chair side", -0.35, 0],
      ["walking in at an angle", -0.6, 0.35],
      ["walking in at the other angle", 0.6, -0.35],
    ] as const) {
      it(label, () => {
        const path = walk(solids, x0, -2, dx, 1, 120);
        const end = path[path.length - 1]!;
        expect(end.z).toBeGreaterThan(1.5);
        // Never inside either obstacle along the way (small tolerance for the sub-step).
        for (const p of path) expect(overlapsAny(solids, p.x, p.z, PLAYER_RADIUS - 0.01)).toBe(false);
      });
    }

    it("a gap narrower than the avatar still blocks", () => {
      const narrow: Solid[] = [
        { kind: "obox", obox: { cx: -0.2 - 0.25, cz: 0, hw: 0.25, hd: 0.24, cos: 1, sin: 0 } },
        { kind: "circle", circle: { cx: 0.2 + potR, cz: 0, r: potR } },
      ];
      const end = walk(narrow, 0, -2, 0, 1, 120).at(-1)!;
      expect(end.z).toBeLessThan(0);
    });
  });

  it("every desk chair and plant in a real office leaves the aisles passable (no furniture overlaps the seat aisles)", () => {
    const agents = [manager, ...Array.from({ length: 8 }, (_, i) => agent({ id: `w_${i}`, name: `W${i}`, createdAt: `2026-09-25T00:00:0${i}.000Z` }))];
    const { placements } = planOffice(agents);
    expect(Object.keys(placements).length).toBe(8);
    const layout = layoutFor(agents);
    const colliders = buildColliders(layout, { excludeKinds: ["chair"] });
    // Each worker's seat pose is reachable ground (the walker can stand where a robot sits).
    for (const pose of Object.values(layout.poses)) if (pose.space !== "office") expect(overlapsAny(colliders, pose.x, pose.z, PLAYER_BODY_RADIUS)).toBe(false);
  });
});
