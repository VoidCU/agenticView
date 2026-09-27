/**
 * Phantom-barrier audit: every collision solid must sit under furniture that is actually drawn.
 *
 * For every room kind, the colliders (scene/solids.ts via buildColliders) are sampled on a fine grid;
 * each sample must lie inside the floor footprint of some visible kit item (scene/kit.ts) that stands
 * up from the floor (rugs and other flat floor decals do not count). Walls and glass partitions are
 * matched against the drawn partition panels. A sample that no drawn piece covers is a phantom
 * barrier: the walker would stop in thin air.
 */
import { describe, expect, it } from "vitest";
import { buildColliders, type Solid } from "../src/scene/colliders";
import { Kit, buildWalls, furnishSpace, type Item } from "../src/scene/kit";
import { layoutFor } from "../src/scene/layout";
import { agent, manager } from "./fixtures";

/** Items flatter than this are floor decals (rugs), never obstacles. */
const MIN_TOP = 0.03;
/** Tolerance (world units) for rounded corners and thin frames. */
const TOL = 0.03;

function covers(it: Item, x: number, z: number): boolean {
  if (it.y + it.sy / 2 < MIN_TOP) return false;
  const dx = x - it.x;
  const dz = z - it.z;
  const c = Math.cos(it.yaw);
  const s = Math.sin(it.yaw);
  // Kit frame: local x = (cos yaw, -sin yaw), local z = (sin yaw, cos yaw).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (it.prim === "box" || it.prim === "rbox") return Math.abs(lx) <= it.sx / 2 + TOL && Math.abs(lz) <= it.sz / 2 + TOL;
  // Cylinders, cones and foliage: an ellipse of the item's x/z size.
  const ex = it.sx / 2 + TOL;
  const ez = it.sz / 2 + TOL;
  return (lx * lx) / (ex * ex) + (lz * lz) / (ez * ez) <= 1;
}

/** Sample points strictly inside a solid's footprint (a grid, 0.05 spacing, plus the centre). */
function samples(s: Solid): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const step = 0.05;
  if (s.kind === "circle") {
    const { cx, cz, r } = s.circle;
    for (let x = -r; x <= r; x += step) for (let z = -r; z <= r; z += step) if (x * x + z * z <= r * r * 0.98) out.push({ x: cx + x, z: cz + z });
    return out;
  }
  if (s.kind === "box") {
    const b = s.box;
    for (let x = b.minX + 0.01; x <= b.maxX - 0.01; x += step) for (let z = b.minZ + 0.01; z <= b.maxZ - 0.01; z += step) out.push({ x, z });
    return out;
  }
  const o = s.obox;
  for (let lx = -o.hw + 0.01; lx <= o.hw - 0.01; lx += step)
    for (let lz = -o.hd + 0.01; lz <= o.hd - 0.01; lz += step)
      out.push({ x: o.cx + lx * o.cos + lz * o.sin, z: o.cz - lx * o.sin + lz * o.cos });
  return out;
}

function describeSolid(s: Solid): string {
  if (s.kind === "circle") return `circle r=${s.circle.r.toFixed(2)} at (${s.circle.cx.toFixed(2)}, ${s.circle.cz.toFixed(2)})`;
  if (s.kind === "box") return `box ${(s.box.maxX - s.box.minX).toFixed(2)}x${(s.box.maxZ - s.box.minZ).toFixed(2)} at (${((s.box.minX + s.box.maxX) / 2).toFixed(2)}, ${((s.box.minZ + s.box.maxZ) / 2).toFixed(2)})`;
  return `obox ${(2 * s.obox.hw).toFixed(2)}x${(2 * s.obox.hd).toFixed(2)} at (${s.obox.cx.toFixed(2)}, ${s.obox.cz.toFixed(2)})`;
}

describe("no phantom barriers: every collider lies under drawn furniture", () => {
  // A full office: manager office, pods, meeting room and lounge, with some seats taken.
  const workers = Array.from({ length: 9 }, (_, i) => agent({ id: `w${i}`, name: `W${i}` }));
  const layout = layoutFor([manager, ...workers]);
  const kit = new Kit();
  buildWalls(kit, layout.spaces);
  for (const s of layout.spaces) furnishSpace(kit, s, { seats: new Map([[0, "#fff"]]) });
  const solids = buildColliders(layout, { excludeKinds: ["chair"] });

  it("the office has every room kind", () => {
    const kinds = new Set(layout.spaces.map((s) => s.kind));
    for (const k of ["office", "pod", "meeting", "lounge"]) expect(kinds.has(k as never)).toBe(true);
  });

  it("no collider sample point is in open air", () => {
    const phantoms: string[] = [];
    for (const s of solids) {
      const pts = samples(s);
      const bad = pts.filter((p) => !kit.items.some((it) => covers(it, p.x, p.z)));
      // Allow a sliver (float edges at rounded corners), never a patch.
      if (bad.length > Math.max(2, pts.length * 0.02)) {
        const room = layout.spaces.find((sp) => Math.hypot(sp.x - bad[0]!.x, sp.z - bad[0]!.z) < 7);
        phantoms.push(`${describeSolid(s)} in ${room?.kind ?? "?"}: ${bad.length}/${pts.length} samples uncovered, e.g. (${bad[0]!.x.toFixed(2)}, ${bad[0]!.z.toFixed(2)})`);
      }
    }
    expect(phantoms, phantoms.join("\n")).toEqual([]);
  });

  it("no duplicated colliders", () => {
    const keys = solids.map(describeSolid);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});
