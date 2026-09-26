/**
 * Pure movement and collision math for walk mode.
 * No React or Three.js imports — safe to test in Node.
 */
import { spaceAt, type Point, type Space } from "@agenticview/shared";

/** Returns true when the given position lies inside a known office space. */
export function isWalkable(spaces: Space[], x: number, z: number): boolean {
  return spaceAt(spaces, x, z) !== undefined;
}

/**
 * Attempt to move a player from (x, z) by (dx, dz).
 * Returns the new position, sliding along walls when blocked.
 * dx/dz should already be scaled by dt * speed.
 */
export function movePlayer(
  spaces: Space[],
  x: number,
  z: number,
  dx: number,
  dz: number,
): Point {
  const nx = x + dx;
  const nz = z + dz;
  // Try full move first
  if (isWalkable(spaces, nx, nz)) return { x: nx, z: nz };
  // Try sliding along each axis independently
  if (isWalkable(spaces, nx, z)) return { x: nx, z };
  if (isWalkable(spaces, x, nz)) return { x, z: nz };
  // Completely blocked
  return { x, z };
}

/**
 * Compute WASD/arrow-key movement delta given key state and yaw (radians).
 * yaw: camera facing direction (0 = +z, increasing CW around Y).
 * Returns the unscaled direction vector (unit length or zero).
 */
export function walkDelta(
  keys: Set<string>,
  yaw: number,
): { dx: number; dz: number } {
  let fwd = 0;
  let right = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) fwd += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) fwd -= 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) right -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) right += 1;
  if (fwd === 0 && right === 0) return { dx: 0, dz: 0 };
  const len = Math.hypot(fwd, right);
  const nf = fwd / len;
  const nr = right / len;
  // yaw=0 means facing +z, yaw=π/2 means facing +x
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    dx: nf * sin + nr * cos,
    dz: nf * cos - nr * sin,
  };
}

/** Camera pitch clamped to safe range (looking 80 deg down to 80 deg up). */
export function clampPitch(pitch: number): number {
  const MAX = (80 * Math.PI) / 180;
  return Math.max(-MAX, Math.min(MAX, pitch));
}
