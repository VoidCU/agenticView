/**
 * Pushable chairs (walk mode). Pure math plus a small state holder; no React / three imports.
 *
 * Unoccupied chairs (and a stepped-away owner's swivelled chair) slide away when the walker bumps into
 * them: a simple kinematic push along the overlap normal, clamped so a chair never enters a wall,
 * desk, other furniture or another chair, with a short damped glide afterwards. A chair whose owner
 * sits at it is fixed and blocks like any furniture. Pushed poses are visual-only client state:
 * agents keep routing to their canonical seats, and a chair snaps home when its owner sits down.
 */
import { CHAIR_D, CHAIR_W } from "./solids";
import { overlapsAny, type Solid } from "./colliders";
import type { ChairInfo } from "./kit";

export const CHAIR_HW = CHAIR_W / 2;
export const CHAIR_HD = CHAIR_D / 2;
/** Circle used to keep a sliding chair out of other solids (its seat footprint, a little generous). */
export const CHAIR_CLAMP_R = 0.26;
/** Only chairs whose centre is within this distance of the walker are considered (O(nearby chairs)). */
export const PUSH_NEAR = 1.2;
/** Glide damping (1/s): after a shove the chair coasts roughly speed / DAMPING metres. */
export const CHAIR_DAMPING = 16;
/** Max glide speed (world units / s). */
export const CHAIR_MAX_SPEED = 3;
const STOP_SPEED = 0.03;

/** Scratch vector (no allocations in the per-frame path). */
export interface Vec2 { x: number; z: number }

/**
 * Circle (walker) vs oriented box (chair seat). Writes into `out` the vector that moves the CIRCLE out
 * of the box and returns true on overlap. Box frame follows the kit: local x = (cos yaw, -sin yaw),
 * local z = (sin yaw, cos yaw).
 */
export function circleVsChair(px: number, pz: number, r: number, cx: number, cz: number, yaw: number, out: Vec2, hw = CHAIR_HW, hd = CHAIR_HD): boolean {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = px - cx;
  const dz = pz - cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (Math.abs(lx) >= hw + r || Math.abs(lz) >= hd + r) return false;
  let nx: number;
  let nz: number;
  let depth: number;
  const qx = Math.max(-hw, Math.min(hw, lx));
  const qz = Math.max(-hd, Math.min(hd, lz));
  const ox = lx - qx;
  const oz = lz - qz;
  const d = Math.hypot(ox, oz);
  if (d > 1e-9) {
    if (d >= r) return false;
    nx = ox / d;
    nz = oz / d;
    depth = r - d;
  } else {
    // Centre inside the box: out through the nearest face.
    const px2 = hw - Math.abs(lx);
    const pz2 = hd - Math.abs(lz);
    if (px2 < pz2) {
      nx = lx >= 0 ? 1 : -1;
      nz = 0;
      depth = px2 + r;
    } else {
      nx = 0;
      nz = lz >= 0 ? 1 : -1;
      depth = pz2 + r;
    }
  }
  // Local normal back to world (inverse rotation).
  out.x = (nx * c + nz * s) * depth;
  out.z = (-nx * s + nz * c) * depth;
  return true;
}

export interface ChairState {
  id: string;
  baseX: number;
  baseZ: number;
  yaw: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  pushable: boolean;
  first: number;
  count: number;
  /** Pose changed since the renderer last applied it. */
  dirty: boolean;
}

/** Can a chair move to (x, z)? Not into static solids, other chairs, or outside the rooms. */
export type ChairClearFn = (chair: ChairState, x: number, z: number) => boolean;

/**
 * Move a chair by (dx, dz), clamped: the full move if clear, else the x-only or z-only part (slide
 * along an obstacle), else nothing. Returns the distance actually moved.
 */
export function moveChairClamped(chair: ChairState, dx: number, dz: number, clear: ChairClearFn): number {
  if (dx === 0 && dz === 0) return 0;
  if (clear(chair, chair.x + dx, chair.z + dz)) {
    chair.x += dx;
    chair.z += dz;
    return Math.hypot(dx, dz);
  }
  if (dx !== 0 && clear(chair, chair.x + dx, chair.z)) {
    chair.x += dx;
    return Math.abs(dx);
  }
  if (dz !== 0 && clear(chair, chair.x, chair.z + dz)) {
    chair.z += dz;
    return Math.abs(dz);
  }
  return 0;
}

const scratch: Vec2 = { x: 0, z: 0 };

/**
 * All chairs of the office. `sync` takes the chairs as drawn (after every furniture rebuild), `interact`
 * runs once per walk-mode frame. Offsets survive rebuilds while a chair stays pushable at the same base
 * pose; a chair that becomes fixed (owner sat down) or changes base snaps home.
 */
export class ChairField {
  chairs: ChairState[] = [];
  /** performance.now() of the last frame a chair moved (the shadow scheduler reads it). */
  lastMove = -Infinity;
  private byId = new Map<string, ChairState>();

  sync(infos: readonly ChairInfo[]): void {
    const next: ChairState[] = [];
    const nextById = new Map<string, ChairState>();
    for (const c of infos) {
      const prev = this.byId.get(c.id);
      const keep = prev && prev.pushable && c.pushable && Math.abs(prev.baseX - c.x) < 1e-6 && Math.abs(prev.baseZ - c.z) < 1e-6 && Math.abs(prev.yaw - c.yaw) < 1e-6;
      const st: ChairState = keep
        ? { ...prev!, first: c.first, count: c.count, dirty: true }
        : { id: c.id, baseX: c.x, baseZ: c.z, yaw: c.yaw, x: c.x, z: c.z, vx: 0, vz: 0, pushable: c.pushable, first: c.first, count: c.count, dirty: false };
      next.push(st);
      nextById.set(c.id, st);
    }
    this.chairs = next;
    this.byId = nextById;
  }

  get(id: string): ChairState | undefined {
    return this.byId.get(id);
  }

  /** Default clearance: no static solid, no other chair (circle approximation), inside a room. */
  clearFn(statics: readonly Solid[], inside: (x: number, z: number) => boolean): ChairClearFn {
    return (chair, x, z) => {
      if (!inside(x, z)) return false;
      for (const o of this.chairs) {
        if (o === chair) continue;
        const dx = o.x - x;
        const dz = o.z - z;
        if (dx * dx + dz * dz < (2 * CHAIR_CLAMP_R) * (2 * CHAIR_CLAMP_R)) return false;
      }
      return !overlapsAny(statics, x, z, CHAIR_CLAMP_R);
    };
  }

  /**
   * One walk-mode frame: glide moving chairs, push nearby pushable chairs the walker overlaps, then push
   * the walker out of any chair (fixed or blocked). Mutates and returns `player` (no allocation).
   */
  interact(player: Vec2, r: number, dt: number, clear: ChairClearFn, now: number, maxPush = Infinity): Vec2 {
    let moved = false;
    const decay = Math.exp(-CHAIR_DAMPING * dt);
    for (const c of this.chairs) {
      if (c.vx === 0 && c.vz === 0) continue;
      const want = Math.hypot(c.vx, c.vz) * dt;
      const got = moveChairClamped(c, c.vx * dt, c.vz * dt, clear);
      if (got > 0) {
        c.dirty = true;
        moved = true;
      }
      if (got < want * 0.5) {
        c.vx = 0;
        c.vz = 0;
      } else {
        c.vx *= decay;
        c.vz *= decay;
        if (Math.hypot(c.vx, c.vz) < STOP_SPEED) c.vx = c.vz = 0;
      }
    }
    for (const c of this.chairs) {
      const dx = c.x - player.x;
      const dz = c.z - player.z;
      if (dx > PUSH_NEAR || dx < -PUSH_NEAR || dz > PUSH_NEAR || dz < -PUSH_NEAR) continue;
      if (!circleVsChair(player.x, player.z, r, c.x, c.z, c.yaw, scratch)) continue;
      if (c.pushable) {
        // The chair takes the whole overlap (it moves opposite to the walker's push-out vector).
        const got = moveChairClamped(c, -scratch.x, -scratch.z, clear);
        if (got > 0) {
          c.dirty = true;
          moved = true;
          if (dt > 0) {
            const k = Math.min(1, CHAIR_MAX_SPEED / (Math.hypot(scratch.x, scratch.z) / dt || 1));
            c.vx = (-scratch.x / dt) * k * 0.6;
            c.vz = (-scratch.z / dt) * k * 0.6;
          }
          // Whatever the chair could not absorb (blocked), the walker keeps.
          if (!circleVsChair(player.x, player.z, r, c.x, c.z, c.yaw, scratch)) continue;
        }
      }
      // Ease the walker out (at most maxPush per frame): a chair gliding into a standing walker must
      // not shove them a whole seat-width in one frame.
      const len = Math.hypot(scratch.x, scratch.z);
      const k = len > maxPush ? maxPush / len : 1;
      player.x += scratch.x * k;
      player.z += scratch.z * k;
    }
    if (moved) this.lastMove = now;
    return player;
  }

  /** Offset of a chair from its canonical pose (for rendering). */
  offset(c: ChairState, out: Vec2): Vec2 {
    out.x = c.x - c.baseX;
    out.z = c.z - c.baseZ;
    return out;
  }
}

/** The office's chairs: one field shared by the furniture renderer and the walk controller. */
export const chairField = new ChairField();
