/**
 * Simple collision shapes for walk mode.
 *
 * Phase A: AABB + circle primitives with sub-stepped resolution.
 *   The outer walkable boundary is still enforced by isWalkable() in
 *   walkPhysics.ts; these solids handle interior obstacles (walls, partitions,
 *   furniture clusters).
 *
 * Phase B: buildColliders() will consume scene/solids.ts furniture list once
 *   Pixel lands that file.
 */

// ---- Shape types ----

/** Axis-aligned bounding box in the XZ plane. */
export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Circular obstacle (pillar, round desk, planter). */
export interface Circle {
  cx: number;
  cz: number;
  r: number;
}

/**
 * Oriented box: half extents `hw` along the local x axis (cos rot, -sin rot) and `hd` along local z
 * (sin rot, cos rot), the kit's frame convention. Furniture uses these so a rotated corner credenza
 * blocks its own footprint, not the (much larger) axis-aligned box around it.
 */
export interface OBox {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  cos: number;
  sin: number;
}

export type Solid =
  | { kind: "box"; box: AABB }
  | { kind: "circle"; circle: Circle }
  | { kind: "obox"; obox: OBox };

import { solidsForLayout } from "./solids";
import type { OfficeLayout } from "./layout";

// ---- Constants ----

/**
 * The walker's visible body radius. In walk mode you are the camera; your 'You' robot is not drawn,
 * so this is a slim person-sized footprint, never larger than what fits visibly through a gap.
 */
export const PLAYER_BODY_RADIUS = 0.25;
/** Small collision skin so the camera never clips into furniture faces. */
export const PLAYER_SKIN = 0.03;
/** Player capsule radius (world units): body + skin. */
export const PLAYER_RADIUS = PLAYER_BODY_RADIUS + PLAYER_SKIN;

/**
 * Default number of sub-steps.
 * Higher = finer anti-tunnel resolution; 8 prevents tunnelling for
 * player speeds up to WALK_SPEED (4.5 u/s) at 60 fps (dt≈0.017).
 */
export const DEFAULT_SUB_STEPS = 8;

// ---- Per-shape resolution (exported for unit tests) ----

/**
 * Resolve a point out of an AABB expanded by `r` using min-penetration push.
 * Returns unchanged coords if no overlap.
 * Used in unit tests; resolveMove uses the direction-aware variant internally.
 */
export function resolveBox(
  cx: number,
  cz: number,
  box: AABB,
  r: number,
): { x: number; z: number } {
  const ex = {
    minX: box.minX - r,
    maxX: box.maxX + r,
    minZ: box.minZ - r,
    maxZ: box.maxZ + r,
  };
  if (
    cx < ex.minX ||
    cx > ex.maxX ||
    cz < ex.minZ ||
    cz > ex.maxZ
  ) {
    return { x: cx, z: cz };
  }
  // Shallowest penetration axis → push out (good for static overlap correction).
  const oL = cx - ex.minX;
  const oR = ex.maxX - cx;
  const oF = cz - ex.minZ;
  const oB = ex.maxZ - cz;
  const min = Math.min(oL, oR, oF, oB);
  if (min === oL) return { x: ex.minX, z: cz };
  if (min === oR) return { x: ex.maxX, z: cz };
  if (min === oF) return { x: cx, z: ex.minZ };
  return { x: cx, z: ex.maxZ };
}

/**
 * Direction-aware AABB push-out for use inside sub-stepped movement.
 * Uses the pre-step position (prevX, prevZ) to determine which face was
 * entered, ensuring we always push out the correct side even when the player
 * moves quickly (more than half the obstacle width per sub-step).
 */
function resolveBoxDir(
  prevX: number,
  prevZ: number,
  cx: number,
  cz: number,
  box: AABB,
  r: number,
): { x: number; z: number } {
  const ex = {
    minX: box.minX - r,
    maxX: box.maxX + r,
    minZ: box.minZ - r,
    maxZ: box.maxZ + r,
  };
  // Use strict inequality so a player sitting exactly on the expanded face
  // (after a previous push-out) is treated as "outside" and slides freely.
  if (cx <= ex.minX || cx >= ex.maxX || cz <= ex.minZ || cz >= ex.maxZ) {
    return { x: cx, z: cz };
  }
  // A small tolerance: a walker sliding along a rotated face sits ON it up to float round-off, and
  // must count as outside. (Without it, a hair of "inside" skipped every entry face and the old
  // velocity fallback threw a walker sliding along a sofa to the sofa's far end: the teleport bug.)
  const fromLeft = prevX <= ex.minX + ENTRY_EPS;
  const fromRight = prevX >= ex.maxX - ENTRY_EPS;
  const fromFront = prevZ <= ex.minZ + ENTRY_EPS;
  const fromBack = prevZ >= ex.maxZ - ENTRY_EPS;
  // Started the step inside: nearest face (resolveMove eases genuinely deep overlaps separately).
  if (!fromLeft && !fromRight && !fromFront && !fromBack) return resolveBox(cx, cz, box, r);
  // Out through the shallowest of the faces the step came through: always the near side, also
  // when it entered across a corner.
  let best = Infinity;
  let ox = cx;
  let oz = cz;
  if (fromLeft && cx - ex.minX < best) { best = cx - ex.minX; ox = ex.minX; oz = cz; }
  if (fromRight && ex.maxX - cx < best) { best = ex.maxX - cx; ox = ex.maxX; oz = cz; }
  if (fromFront && cz - ex.minZ < best) { best = cz - ex.minZ; ox = cx; oz = ex.minZ; }
  if (fromBack && ex.maxZ - cz < best) { ox = cx; oz = ex.maxZ; }
  return { x: ox, z: oz };
}

/**
 * Resolve a point out of a circle obstacle expanded by `r`.
 * Returns unchanged coords if no overlap.
 */
export function resolveCircle(
  cx: number,
  cz: number,
  c: Circle,
  r: number,
): { x: number; z: number } {
  const dx = cx - c.cx;
  const dz = cz - c.cz;
  const dist = Math.hypot(dx, dz);
  const minDist = c.r + r;
  if (dist >= minDist || dist < 1e-6) return { x: cx, z: cz };
  const push = (minDist - dist) / dist;
  return { x: cx + dx * push, z: cz + dz * push };
}

/** Tolerance for "the previous position was outside this face". */
const ENTRY_EPS = 1e-7;

const LOCAL_BOX: AABB = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

/** Direction-aware push-out of a point from an oriented box expanded by `r` (same rules as boxes, in the box frame). */
function resolveOBoxDir(prevX: number, prevZ: number, cx: number, cz: number, o: OBox, r: number): { x: number; z: number } {
  const dx = cx - o.cx;
  const dz = cz - o.cz;
  const lx = dx * o.cos - dz * o.sin;
  const lz = dx * o.sin + dz * o.cos;
  // Cheap reject before any more work.
  if (Math.abs(lx) >= o.hw + r || Math.abs(lz) >= o.hd + r) return { x: cx, z: cz };
  const pdx = prevX - o.cx;
  const pdz = prevZ - o.cz;
  LOCAL_BOX.minX = -o.hw;
  LOCAL_BOX.maxX = o.hw;
  LOCAL_BOX.minZ = -o.hd;
  LOCAL_BOX.maxZ = o.hd;
  const p = resolveBoxDir(pdx * o.cos - pdz * o.sin, pdx * o.sin + pdz * o.cos, lx, lz, LOCAL_BOX, r);
  // Back to world: inverse rotation.
  return { x: o.cx + p.x * o.cos + p.z * o.sin, z: o.cz - p.x * o.sin + p.z * o.cos };
}

/** Push a point out of any one solid (expanded by r). */
export function resolveSolid(s: Solid, prevX: number, prevZ: number, x: number, z: number, r = PLAYER_RADIUS): { x: number; z: number } {
  if (s.kind === "box") return resolveBoxDir(prevX, prevZ, x, z, s.box, r);
  if (s.kind === "circle") return resolveCircle(x, z, s.circle, r);
  return resolveOBoxDir(prevX, prevZ, x, z, s.obox, r);
}

/** True when a circle of radius r at (x, z) overlaps any of the solids. */
export function overlapsAny(solids: readonly Solid[], x: number, z: number, r: number): boolean {
  for (const s of solids) {
    if (penetration(s, x, z, r, PEN_SCRATCH) > 0) return true;
  }
  return false;
}

// ---- Depenetration (walker already inside an obstacle) ----

/**
 * Most a walker that STARTS a frame inside an obstacle is pushed back out per frame (world units).
 * About one frame of walking (4.5 u/s at 60 fps = 0.075) plus the skin: a deep overlap (a chair
 * shoved the walker into a desk, a long frame) resolves over a few frames as a quick slide, never as a
 * visible jump.
 */
export const MAX_DEPEN_PER_FRAME = 0.075 + PLAYER_SKIN;

/** Unit exit direction written by penetration(). */
export interface ExitNormal { x: number; z: number }

const PEN_SCRATCH: ExitNormal = { x: 0, z: 0 };

/**
 * How deep a circle of radius r at (x, z) sits inside solid `s`, and the direction of the NEAREST way
 * out (written into `out` as a unit vector). Returns a depth <= 0 when there is no overlap (then `out`
 * is untouched). Boxes use the same square-expanded footprint as the push-out code; a point exactly
 * at a circle's centre exits along +x. Allocation-free.
 */
export function penetration(s: Solid, x: number, z: number, r: number, out: ExitNormal): number {
  if (s.kind === "circle") {
    const dx = x - s.circle.cx;
    const dz = z - s.circle.cz;
    const dist = Math.hypot(dx, dz);
    const depth = s.circle.r + r - dist;
    if (depth <= 0) return depth;
    if (dist > 1e-9) {
      out.x = dx / dist;
      out.z = dz / dist;
    } else {
      out.x = 1;
      out.z = 0;
    }
    return depth;
  }
  let lx: number;
  let lz: number;
  let hw: number;
  let hd: number;
  let cos = 1;
  let sin = 0;
  if (s.kind === "box") {
    const b = s.box;
    hw = (b.maxX - b.minX) / 2;
    hd = (b.maxZ - b.minZ) / 2;
    lx = x - (b.minX + b.maxX) / 2;
    lz = z - (b.minZ + b.maxZ) / 2;
  } else {
    const o = s.obox;
    const dx = x - o.cx;
    const dz = z - o.cz;
    cos = o.cos;
    sin = o.sin;
    lx = dx * cos - dz * sin;
    lz = dx * sin + dz * cos;
    hw = o.hw;
    hd = o.hd;
  }
  const px = hw + r - Math.abs(lx);
  const pz = hd + r - Math.abs(lz);
  if (px <= 0 || pz <= 0) return Math.min(px, pz);
  let nx = 0;
  let nz = 0;
  let depth: number;
  if (px <= pz) {
    nx = lx >= 0 ? 1 : -1;
    depth = px;
  } else {
    nz = lz >= 0 ? 1 : -1;
    depth = pz;
  }
  // Local normal back to world (inverse rotation; identity for axis-aligned boxes).
  out.x = nx * cos + nz * sin;
  out.z = -nx * sin + nz * cos;
  return depth;
}

// ---- Sub-stepped move ----

/** Bounding radius of a solid around its centre (cheap broad phase). */
function solidReach(s: Solid): number {
  if (s.kind === "circle") return s.circle.r;
  if (s.kind === "obox") return Math.hypot(s.obox.hw, s.obox.hd);
  return Math.hypot((s.box.maxX - s.box.minX) / 2, (s.box.maxZ - s.box.minZ) / 2);
}

function solidCentre(s: Solid, out: ExitNormal): void {
  if (s.kind === "circle") {
    out.x = s.circle.cx;
    out.z = s.circle.cz;
  } else if (s.kind === "obox") {
    out.x = s.obox.cx;
    out.z = s.obox.cz;
  } else {
    out.x = (s.box.minX + s.box.maxX) / 2;
    out.z = (s.box.minZ + s.box.maxZ) / 2;
  }
}

/** Reused broad-phase buffers: the solids near this frame's path, and how deep the walker started in each. */
const NEAR: Solid[] = [];
const CENTRE: ExitNormal = { x: 0, z: 0 };
const NORMAL: ExitNormal = { x: 0, z: 0 };

/**
 * Collect the solids that can possibly touch a walker moving from (x, z) by (dx, dz) (bounding circles
 * within reach of the path). Keeps collision work O(nearby obstacles) instead of O(whole office).
 */
export function nearbySolids(solids: readonly Solid[], x: number, z: number, dx: number, dz: number, r: number, out: Solid[] = []): Solid[] {
  out.length = 0;
  const mx = x + dx / 2;
  const mz = z + dz / 2;
  const pad = Math.hypot(dx, dz) / 2 + r + MAX_DEPEN_PER_FRAME + 0.05;
  for (const s of solids) {
    solidCentre(s, CENTRE);
    const reach = solidReach(s) + pad;
    const ox = CENTRE.x - mx;
    const oz = CENTRE.z - mz;
    if (ox * ox + oz * oz <= reach * reach) out.push(s);
  }
  return out;
}

/**
 * Move a player capsule from (x, z) by (dx, dz) resolving against `solids`.
 *
 * Algorithm:
 * 1. Broad phase: only solids whose bounds reach the frame's path are considered.
 * 2. Divide (dx, dz) into sub-steps (one step when standing still, so a walker left overlapping an
 *    obstacle — a shoved chair, a long frame — still gets eased back out).
 * 3. Per sub-step and solid:
 *    - Entered this step from outside: direction-aware push back out through the entry face (the
 *      overlap is at most one sub-step deep, so this is always the near side).
 *    - Already inside at the start of the step: never let the walker go deeper, and ease it out
 *      through the NEAREST face by at most MAX_DEPEN_PER_FRAME per call. It is never pushed across
 *      the obstacle, and never jumps.
 * 4. Drop the part of the step that goes into the obstacle (wall sliding).
 *
 * The outer walkable boundary is enforced separately by isWalkable() in walkPhysics.ts.
 */
export function resolveMove(
  solids: Solid[],
  x: number,
  z: number,
  dx: number,
  dz: number,
  steps = DEFAULT_SUB_STEPS,
): { x: number; z: number } {
  if (solids.length === 0) return { x: x + dx, z: z + dz };
  const near = nearbySolids(solids, x, z, dx, dz, PLAYER_RADIUS, NEAR);
  if (near.length === 0) return { x: x + dx, z: z + dz };
  const still = dx === 0 && dz === 0;
  const actualSteps = still ? 1 : steps === DEFAULT_SUB_STEPS ? Math.max(DEFAULT_SUB_STEPS, Math.ceil(Math.hypot(dx, dz) / 0.15)) : steps;
  let sx = dx / actualSteps;
  let sz = dz / actualSteps;
  let cx = x;
  let cz = z;
  let budget = MAX_DEPEN_PER_FRAME;
  for (let i = 0; i < actualSteps; i++) {
    if (sx === 0 && sz === 0 && !(still && i === 0)) break;
    const prevX = cx;
    const prevZ = cz;
    const nx = cx + sx;
    const nz = cz + sz;
    let rx = nx;
    let rz = nz;
    // Two passes: in a narrow gap the push out of one obstacle can land in its neighbour.
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (let k = 0; k < near.length; k++) {
        const s = near[k]!;
        const dPrev = penetration(s, prevX, prevZ, PLAYER_RADIUS, NORMAL);
        if (dPrev > ENTRY_EPS) {
          // Started this step inside: allowed depth = where we started, minus this frame's easing.
          const take = pass === 0 ? Math.min(dPrev, budget) : 0;
          budget -= take;
          const dNew = penetration(s, rx, rz, PLAYER_RADIUS, NORMAL);
          const push = dNew - (dPrev - take);
          if (push > 1e-9) {
            rx += NORMAL.x * push;
            rz += NORMAL.z * push;
            any = true;
          }
          continue;
        }
        const r = resolveSolid(s, prevX, prevZ, rx, rz);
        if (r.x !== rx || r.z !== rz) any = true;
        rx = r.x;
        rz = r.z;
      }
      if (!any) break;
    }
    // Slide: drop only the part of the step that goes INTO the obstacle (along the correction normal)
    // and keep the tangential part. For box faces that is the old "cancel this axis"; for round
    // obstacles (plants, tables) and rotated furniture it slides around instead of stopping dead,
    // which is what wedged the walker between a chair and a plant pot.
    const nX = rx - nx;
    const nZ = rz - nz;
    const nLen = Math.hypot(nX, nZ);
    if (nLen > 1e-6) {
      const ux = nX / nLen;
      const uz = nZ / nLen;
      const into = sx * ux + sz * uz;
      if (into < 0) {
        sx -= into * ux;
        sz -= into * uz;
      }
      if (Math.abs(sx) < 1e-9) sx = 0;
      if (Math.abs(sz) < 1e-9) sz = 0;
    }
    cx = rx;
    cz = rz;
  }
  return { x: cx, z: cz };
}

/**
 * Build collision solids for the current layout.
 *
 * Phase A: returns an empty list if layout is omitted.
 * Phase B: builds AABB and circle shapes from scene/solids.ts for desks,
 *   partitions, planters, credenzas, tables and other furniture.
 *
 * Call this once per layout change and pass the result to resolveMove().
 */
export function buildColliders(layout?: OfficeLayout, opts: { excludeKinds?: readonly string[] } = {}): Solid[] {
  if (!layout) return [];
  const exclude = new Set(opts.excludeKinds ?? []);
  const obstacles = solidsForLayout(layout).filter((s) => !exclude.has(s.kind));
  return obstacles.map((s): Solid => {
    if ("r" in s) {
      return { kind: "circle", circle: { cx: s.x, cz: s.z, r: s.r } };
    }
    const { x, z, w, d, rot } = s;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    // Axis-aligned pieces (the horizontal hex walls, the pod privacy screens, ...) are exact as plain
    // boxes. Everything else keeps its real rotated footprint. Diagonal hex walls used to be turned
    // into their axis-aligned bounds: 1.4 x 2.3 blocks beside every doorway and 3.6 x 6.1 blocks along
    // every outer wall, i.e. invisible barriers far out on the floor.
    if (Math.abs(sn) < 1e-9 || Math.abs(c) < 1e-9) {
      const hx = Math.abs((w / 2) * c) + Math.abs((d / 2) * sn);
      const hz = Math.abs((w / 2) * sn) + Math.abs((d / 2) * c);
      return { kind: "box", box: { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz } };
    }
    return { kind: "obox", obox: { cx: x, cz: z, hw: w / 2, hd: d / 2, cos: c, sin: sn } };
  });
}
