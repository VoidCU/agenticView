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

export type Solid =
  | { kind: "box"; box: AABB }
  | { kind: "circle"; circle: Circle };

import { solidsForLayout } from "./solids";
import type { OfficeLayout } from "./layout";

// ---- Constants ----

/** Player capsule radius (world units). */
export const PLAYER_RADIUS = 0.28;

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
    for (const s of solids) {
      if (s.kind === "box") {
        const r = resolveBoxDir(prevX, prevZ, rx, rz, s.box, PLAYER_RADIUS);
        rx = r.x;
        rz = r.z;
      } else {
        const r = resolveCircle(rx, rz, s.circle, PLAYER_RADIUS);
        rx = r.x;
        rz = r.z;
      }
    }
    // Cancel sub-step in any corrected axis to slide along the obstacle.
    if (Math.abs(rx - nx) > 1e-6) sx = 0;
    if (Math.abs(rz - nz) > 1e-6) sz = 0;
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
export function buildColliders(layout?: OfficeLayout): Solid[] {
  if (!layout) return [];
  const obstacles = solidsForLayout(layout);
  return obstacles.map((s): Solid => {
    if ("r" in s) {
      return { kind: "circle", circle: { cx: s.x, cz: s.z, r: s.r } };
    }
    const { x, z, w, d, rot } = s;
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
