/**
 * Pure movement and collision math for walk mode.
 * No React or Three.js imports — safe to test in Node.
 */
import { spaceAt, type Point, type Space } from "@agenticview/shared";
import { resolveMove, type Solid } from "./colliders";

/** Returns true when the given position lies inside a known office space. */
export function isWalkable(spaces: Space[], x: number, z: number): boolean {
  return spaceAt(spaces, x, z) !== undefined;
}

/**
 * Attempt to move a player from (x, z) by (dx, dz).
 *
 * Two-phase collision:
 * 1. Interior solid obstacles resolved via sub-stepped AABB/circle push-out
 *    (prevents tunnelling through furniture).
 * 2. Outer walkable boundary enforced by isWalkable axis-slide (wall sliding).
 *
 * dx/dz should already be scaled by dt * speed.
 */
export function movePlayer(
  spaces: Space[],
  x: number,
  z: number,
  dx: number,
  dz: number,
  solids: Solid[] = [],
): Point {
  // Phase 1: resolve against interior solid obstacles (sub-stepped).
  const moved = resolveMove(solids, x, z, dx, dz);
  const nx = moved.x;
  const nz = moved.z;

  // Phase 2: outer wall guard — axis-slide so player slides along room edges.
  if (isWalkable(spaces, nx, nz)) return { x: nx, z: nz };
  if (isWalkable(spaces, nx, z)) return { x: nx, z };
  if (isWalkable(spaces, x, nz)) return { x, z: nz };
  return { x, z };
}

/**
 * Compute WASD/arrow-key movement direction given key state and yaw (radians).
 * yaw: camera Y rotation (0 = looking toward -z, π/2 = looking toward -x),
 * so W always moves where the camera looks.
 * Returns the unscaled unit-direction vector (or zero).
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
  // Matches the three.js camera (Euler YXZ): yaw=0 looks down -z, yaw=π/2 looks down -x.
  // forward = (-sin, -cos), right = (cos, -sin).
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    dx: -nf * sin + nr * cos,
    dz: -nf * cos - nr * sin,
  };
}

/** Camera pitch clamped to safe range (looking 80 deg down to 80 deg up). */
export function clampPitch(pitch: number): number {
  const MAX = (80 * Math.PI) / 180;
  return Math.max(-MAX, Math.min(MAX, pitch));
}

/** Walk speed (world units per second). */
export const WALK_SPEED = 4.5;
/** Acceleration factor for smooth start/stop (higher = snappier). */
export const ACCEL = 12;
/** Deceleration factor (applied when no key pressed). */
export const DECEL = 14;

/**
 * Apply smooth acceleration / deceleration to the player velocity.
 *
 * @param vx  current x velocity
 * @param vz  current z velocity
 * @param dirX  desired direction x (unit or zero)
 * @param dirZ  desired direction z (unit or zero)
 * @param dt  delta time in seconds
 * @param speed  target speed (default WALK_SPEED)
 */
export function applyVelocity(
  vx: number,
  vz: number,
  dirX: number,
  dirZ: number,
  dt: number,
  speed = WALK_SPEED,
): { vx: number; vz: number } {
  const hasInput = dirX !== 0 || dirZ !== 0;
  if (hasInput) {
    const targetVx = dirX * speed;
    const targetVz = dirZ * speed;
    const t = Math.min(1, dt * ACCEL);
    return {
      vx: vx + (targetVx - vx) * t,
      vz: vz + (targetVz - vz) * t,
    };
  } else {
    // Decelerate toward zero.
    const t = Math.min(1, dt * DECEL);
    return { vx: vx * (1 - t), vz: vz * (1 - t) };
  }
}

// ---- Head-bob (tuned to be felt, not seen) ----

/** Vertical bob amplitude in world units (~6 mm at 1.7 m eye height). Was 55 mm: far too strong. */
export const BOB_AMP_Y = 0.006;
/** Sideways sway amplitude along the camera's right vector (~3 mm). */
export const BOB_AMP_X = 0.003;
/**
 * Bob phase advance per world unit walked. Vertical bob is sin(2 * phase), so at full WALK_SPEED
 * that is BOB_FREQ * WALK_SPEED / PI ≈ 1.9 Hz: about two footsteps a second.
 */
export const BOB_FREQ = 1.3;
/** How fast the bob fades in when starting to walk and out when stopping (1/s). */
export const BOB_EASE = 5;

/** Ease the bob weight toward the current speed fraction; exactly 0 bob once standing still. */
export function bobWeightStep(weight: number, speed: number, dt: number): number {
  const goal = Math.min(1, speed / WALK_SPEED);
  const next = weight + (goal - weight) * Math.min(1, dt * BOB_EASE);
  return next < 1e-4 && goal === 0 ? 0 : next;
}

/** Vertical camera offset for the bob (allocation-free). */
export function headBobY(phase: number, weight: number): number {
  return Math.sin(phase * 2) * BOB_AMP_Y * weight;
}

/** Sideways offset (to apply along the camera's right vector). */
export function headBobSide(phase: number, weight: number): number {
  return Math.cos(phase) * BOB_AMP_X * weight;
}
