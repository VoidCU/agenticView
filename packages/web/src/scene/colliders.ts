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
  const fromLeft = prevX <= ex.minX;
  const fromRight = prevX >= ex.maxX;
  const fromFront = prevZ <= ex.minZ;
  const fromBack = prevZ >= ex.maxZ;

  if (fromLeft && !fromFront && !fromBack) return { x: ex.minX, z: cz };
  if (fromRight && !fromFront && !fromBack) return { x: ex.maxX, z: cz };
  if (fromFront && !fromLeft && !fromRight) return { x: cx, z: ex.minZ };
  if (fromBack && !fromLeft && !fromRight) return { x: cx, z: ex.maxZ };

  const velX = cx - prevX;
  const velZ = cz - prevZ;
  if (Math.abs(velX) > Math.abs(velZ)) {
    // Entered primarily from the X direction.
    return { x: velX >= 0 ? ex.minX : ex.maxX, z: cz };
  } else if (Math.abs(velZ) > 1e-9) {
    // Entered primarily from the Z direction.
    return { x: cx, z: velZ >= 0 ? ex.minZ : ex.maxZ };
  }
  // No net movement: fall back to min-penetration.
  return resolveBox(cx, cz, box, r);
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
    if (s.kind === "circle") {
      if (Math.hypot(x - s.circle.cx, z - s.circle.cz) < s.circle.r + r) return true;
      continue;
    }
    const p = resolveSolid(s, x, z, x, z, r);
    if (Math.abs(p.x - x) > 1e-6 || Math.abs(p.z - z) > 1e-6) return true;
  }
  return false;
}

// ---- Sub-stepped move ----

/**
 * Move a player capsule from (x, z) by (dx, dz) resolving against `solids`.
 *
 * Algorithm:
 * 1. Divide (dx, dz) into `steps` sub-steps.
 * 2. After each sub-step, push the player out of any overlapping obstacle using
 *    a direction-aware algorithm that always pushes toward the entry face.
 * 3. Cancel velocity in any axis where a collision was detected (wall-sliding).
 *    This prevents re-entering the obstacle in subsequent sub-steps.
 *
 * The outer walkable boundary is enforced separately by isWalkable() in
 * walkPhysics.ts, so we don't need to worry about room edges here.
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
  const actualSteps = steps === DEFAULT_SUB_STEPS ? Math.max(DEFAULT_SUB_STEPS, Math.ceil(Math.hypot(dx, dz) / 0.15)) : steps;
  let sx = dx / actualSteps;
  let sz = dz / actualSteps;
  let cx = x;
  let cz = z;
  for (let i = 0; i < actualSteps; i++) {
    if (sx === 0 && sz === 0) break;
    const prevX = cx;
    const prevZ = cz;
    const nx = cx + sx;
    const nz = cz + sz;
    let rx = nx;
    let rz = nz;
    // Two passes: in a narrow gap the push out of one obstacle can land in its neighbour.
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (const s of solids) {
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
/** Obstacle kinds kept as axis-aligned boxes exactly as before (walls and glass partitions). */
const AABB_KINDS: ReadonlySet<string> = new Set(["wall", "partition"]);

export function buildColliders(layout?: OfficeLayout, opts: { excludeKinds?: readonly string[] } = {}): Solid[] {
  if (!layout) return [];
  const exclude = new Set(opts.excludeKinds ?? []);
  const obstacles = solidsForLayout(layout).filter((s) => !exclude.has(s.kind));
  return obstacles.map((s): Solid => {
    if ("r" in s) {
      return { kind: "circle", circle: { cx: s.x, cz: s.z, r: s.r } };
    }
    const { x, z, w, d, rot } = s;
    if (!AABB_KINDS.has(s.kind)) {
      // Furniture: the real (rotated) footprint.
      return { kind: "obox", obox: { cx: x, cz: z, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot) } };
    }
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const hx = Math.abs((w / 2) * c) + Math.abs((d / 2) * sn);
    const hz = Math.abs((w / 2) * sn) + Math.abs((d / 2) * c);
    return {
      kind: "box",
      box: { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz },
    };
  });
}
