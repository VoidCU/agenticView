/**
 * Phantom-barrier audit: every collision solid must sit under furniture that is actually drawn, and
 * every visibly open patch of floor must be walkable.
 *
 * Forward check: the colliders (scene/solids.ts via buildColliders) are sampled on a fine grid; each
 * sample must lie inside the floor footprint of some visible kit item (scene/kit.ts) that stands up
 * from the floor (rugs and other flat floor decals do not count). Walls and glass partitions are
 * matched against the drawn partition panels. A sample that no drawn piece covers is a phantom
 * barrier: the walker would stop in thin air.
 *
 * Inverse check: a grid of floor points over every room (doorways and the corridors between rooms
 * included) that no drawn standing item comes near must not be inside any collider. This catches a
 * collider that happens to overlap *some* drawn item (so the forward check passes) while also
 * spilling over open floor, e.g. a solid that lines up with the wrong piece.
 *
 * Both checks run over: the default office (manager office, 4 pods, meeting room, lounge with its
 * game spots, scoreboard and counter, My Office with its wall screen, Production Room, Research Room),
 * a live re-layout of it (screen walls shared with the lounge, so no doorway there), a 30-worker office
 * (ring 2 exists), and a legacy explicit layout with extra rooms placed the way add_room placed them.
 */
import { describe, expect, it } from "vitest";
import { HEX_R, applyLayoutMoves, buildSpacesFromExplicit, defaultLayout, hexesForRing, spaceAt, validateLayout, type ExplicitRoom, type OfficeLayout as FloorPlan, type Space } from "@agenticview/shared";
import { buildColliders, type Solid } from "../src/scene/colliders";
import { Kit, buildWalls, furnishSpace, type Item } from "../src/scene/kit";
import { layoutFor, type OfficeLayout } from "../src/scene/layout";
import { agent, manager } from "./fixtures";

/** Items flatter than this are floor decals (rugs), never obstacles. */
const MIN_TOP = 0.03;
/** Tolerance (world units) for rounded corners and thin frames. */
const TOL = 0.03;
/** Inverse check: a point this far (or further) from every drawn standing item is visibly open floor. */
const OPEN_MARGIN = 0.12;

function covers(it: Item, x: number, z: number, tol = TOL): boolean {
  if (it.y + it.sy / 2 < MIN_TOP) return false;
  const dx = x - it.x;
  const dz = z - it.z;
  const c = Math.cos(it.yaw);
  const s = Math.sin(it.yaw);
  // Kit frame: local x = (cos yaw, -sin yaw), local z = (sin yaw, cos yaw).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (it.prim === "box" || it.prim === "rbox") return Math.abs(lx) <= it.sx / 2 + tol && Math.abs(lz) <= it.sz / 2 + tol;
  // Cylinders, cones and foliage: an ellipse of the item's x/z size.
  const ex = it.sx / 2 + tol;
  const ez = it.sz / 2 + tol;
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

/** Is (x, z) strictly inside the solid (not merely touching its edge)? */
function blocks(s: Solid, x: number, z: number): boolean {
  const e = 1e-3;
  if (s.kind === "circle") return Math.hypot(x - s.circle.cx, z - s.circle.cz) < s.circle.r - e;
  if (s.kind === "box") return x > s.box.minX + e && x < s.box.maxX - e && z > s.box.minZ + e && z < s.box.maxZ - e;
  const o = s.obox;
  const dx = x - o.cx;
  const dz = z - o.cz;
  const lx = dx * o.cos - dz * o.sin;
  const lz = dx * o.sin + dz * o.cos;
  return Math.abs(lx) < o.hw - e && Math.abs(lz) < o.hd - e;
}

function describeSolid(s: Solid): string {
  if (s.kind === "circle") return `circle r=${s.circle.r.toFixed(2)} at (${s.circle.cx.toFixed(2)}, ${s.circle.cz.toFixed(2)})`;
  if (s.kind === "box") return `box ${(s.box.maxX - s.box.minX).toFixed(2)}x${(s.box.maxZ - s.box.minZ).toFixed(2)} at (${((s.box.minX + s.box.maxX) / 2).toFixed(2)}, ${((s.box.minZ + s.box.maxZ) / 2).toFixed(2)})`;
  return `obox ${(2 * s.obox.hw).toFixed(2)}x${(2 * s.obox.hd).toFixed(2)} at (${s.obox.cx.toFixed(2)}, ${s.obox.cz.toFixed(2)})`;
}

function roomOf(spaces: Space[], p: { x: number; z: number }): string {
  const s = spaceAt(spaces, p.x, p.z);
  return s ? `${s.kind} ${s.id} (ring ${s.ring})` : "outside";
}

interface Scenario {
  name: string;
  layout: OfficeLayout;
}

function furnished(layout: OfficeLayout) {
  const kit = new Kit();
  buildWalls(kit, layout.spaces);
  for (const s of layout.spaces) furnishSpace(kit, s, { seats: new Map([[0, "#fff"]]) });
  // Chairs are dynamic (pushChairs.ts), exactly as the scene builds its static colliders.
  const solids = buildColliders(layout, { excludeKinds: ["chair"] });
  const standing = kit.items.filter((it) => it.y + it.sy / 2 >= MIN_TOP);
  return { kit, solids, standing };
}

function workers(n: number) {
  return Array.from({ length: n }, (_, i) => agent({ id: `w${String(i).padStart(2, "0")}`, name: `W${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
}

/** Rooms placed the way world.addRoom places them: ring 1 in canonical order, then ring 2 hexes. */
function explicitRooms(): ExplicitRoom[] {
  const r1 = hexesForRing(1);
  const r2 = hexesForRing(2);
  const kinds1: ExplicitRoom["kind"][] = ["pod", "pod", "pod", "pod", "meeting", "lounge"];
  const rooms: ExplicitRoom[] = r1.map((h, i) => {
    const kind = kinds1[i]!;
    const id = kind === "pod" ? `pod-${"abcd"[i]}` : kind;
    return { id, kind, name: id, q: h.q, r: h.r };
  });
  // add_room meeting + lounge + pod in ring 2.
  rooms.push({ id: "meeting-2", kind: "meeting", name: "War Room", q: r2[0]!.q, r: r2[0]!.r });
  rooms.push({ id: "lounge-2", kind: "lounge", name: "Chill", q: r2[1]!.q, r: r2[1]!.r });
  rooms.push({ id: "pod-e", kind: "pod", name: "Pod E", q: r2[2]!.q, r: r2[2]!.r });
  return rooms;
}

/**
 * A re-laid-out plan (live re-layout): My Office and the Production Room swapped onto hexes where their
 * screen walls face the lounge (no doorway there), research and the meeting room trade places, and the
 * manager's office moves out to ring 2.
 */
function swappedPlan(): FloorPlan {
  const plan = applyLayoutMoves(defaultLayout(0), [
    { space: "myoffice", toHex: { q: 1, r: 0 } },
    { space: "production", toHex: { q: 0, r: 1 } },
    { space: "research", toHex: { q: 0, r: -1 } },
    { space: "office", toHex: { q: 1, r: -2 } },
  ]);
  const ok = validateLayout(plan);
  if (!ok.ok) throw new Error(ok.errors.join("; "));
  return plan;
}

/** Room kinds of the default plan (layout as data): My Office, Production and Research are always there. */
const ALL_KINDS = ["office", "pod", "meeting", "lounge", "myoffice", "production", "research"] as const;

const scenarios: Scenario[] = [
  { name: "default office (ring 1)", layout: layoutFor([manager, ...workers(9)]) },
  { name: "live re-layout: screen walls face the lounge, office in ring 2", layout: layoutFor([manager, ...workers(9)], undefined, swappedPlan()) },
  { name: "30 workers (ring 2)", layout: layoutFor([manager, ...workers(30)]) },
  {
    name: "explicit rooms via add_room (ring 2 meeting + lounge + pod)",
    layout: { spaces: buildSpacesFromExplicit(explicitRooms()), poses: {}, placements: {}, occupied: new Map() },
  },
];

describe.each(scenarios)("no phantom barriers: $name", ({ layout }) => {
  const { kit, solids, standing } = furnished(layout);

  it("covers the room kinds and rings it claims", () => {
    const kinds = new Set(layout.spaces.map((s) => s.kind));
    const expected = layout.spaces.some((s) => s.kind === "myoffice") ? ALL_KINDS : (["office", "pod", "meeting", "lounge"] as const);
    for (const k of expected) expect(kinds.has(k), `missing ${k}`).toBe(true);
    expect(solids.length).toBeGreaterThan(0);
  });

  it("no collider sample point is in open air", () => {
    const phantoms: string[] = [];
    for (const s of solids) {
      const pts = samples(s);
      const bad = pts.filter((p) => !kit.items.some((it) => covers(it, p.x, p.z)));
      // Allow a sliver (float edges at rounded corners), never a patch.
      if (bad.length > Math.max(2, pts.length * 0.02)) {
        phantoms.push(`${describeSolid(s)} in ${roomOf(layout.spaces, bad[0]!)}: ${bad.length}/${pts.length} samples uncovered, e.g. (${bad[0]!.x.toFixed(2)}, ${bad[0]!.z.toFixed(2)})`);
      }
    }
    expect(phantoms, phantoms.join("\n")).toEqual([]);
  });

  it("every visibly open floor point (rooms, doorways, corridors) is walkable", () => {
    const step = 0.2;
    const xs = layout.spaces.map((s) => s.x);
    const zs = layout.spaces.map((s) => s.z);
    const minX = Math.min(...xs) - HEX_R;
    const maxX = Math.max(...xs) + HEX_R;
    const minZ = Math.min(...zs) - HEX_R;
    const maxZ = Math.max(...zs) + HEX_R;
    const blocked: string[] = [];
    let open = 0;
    for (let x = minX; x <= maxX; x += step) {
      for (let z = minZ; z <= maxZ; z += step) {
        if (!spaceAt(layout.spaces, x, z)) continue;
        if (standing.some((it) => covers(it, x, z, OPEN_MARGIN))) continue;
        open++;
        const hit = solids.find((s) => blocks(s, x, z));
        if (hit) blocked.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) in ${roomOf(layout.spaces, { x, z })} blocked by ${describeSolid(hit)}`);
      }
    }
    // Sanity: the grid really sampled a lot of floor.
    expect(open).toBeGreaterThan(layout.spaces.length * 200);
    expect(blocked.slice(0, 20), `${blocked.length} open floor points blocked:\n${blocked.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("the inverse check would catch a phantom on open floor (self-test)", () => {
    // Find an open point in the lounge and put an invisible 0.3 m post there.
    const lounge = layout.spaces.find((s) => s.kind === "lounge")!;
    let spot: { x: number; z: number } | undefined;
    for (let a = 0; a < 360 && !spot; a += 7)
      for (const r of [3.0, 3.6, 4.4, 5.0]) {
        const p = { x: lounge.x + r * Math.cos((a * Math.PI) / 180), z: lounge.z + r * Math.sin((a * Math.PI) / 180) };
        if (!standing.some((it) => covers(it, p.x, p.z, 0.6)) && !solids.some((s) => blocks(s, p.x, p.z))) { spot = p; break; }
      }
    expect(spot).toBeDefined();
    const phantom: Solid = { kind: "circle", circle: { cx: spot!.x, cz: spot!.z, r: 0.3 } };
    expect(blocks(phantom, spot!.x, spot!.z)).toBe(true);
    expect(standing.some((it) => covers(it, spot!.x, spot!.z, OPEN_MARGIN))).toBe(false);
  });

  it("no duplicated colliders", () => {
    const keys = solids.map(describeSolid);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});
