/**
 * "Engaged" pause: while the user plays rock-paper-scissors with an agent, that agent's robot stops
 * where it is and faces the player, then resumes exactly what it was doing when the popup closes.
 *
 * Client-side only. The server keeps its own timers (lounging, visiting); if one lapses mid-game the
 * robot simply heads for its new target once the game is over (the target change is noticed on the
 * first unpaused frame because the path's destination is left untouched while paused).
 */
import { create } from "zustand";
import type { Point } from "@agenticview/shared";

interface EngageState {
  /** Agent the user is currently playing with (the open PlayRps modal's agentId). */
  agentId?: string;
  engage(agentId: string | undefined): void;
}

export const useEngage = create<EngageState>((set) => ({
  engage: (agentId) => set({ agentId }),
}));

/** Path-following state of a robot (the part of its motion that engaging pauses). */
export interface PathMotion {
  x: number;
  z: number;
  path: Point[];
  /** Destination the current path leads to (NaN = none yet). */
  tx: number;
  tz: number;
  vx: number;
  vz: number;
}

export interface StepResult {
  /** Still has path left to walk (and is not paused). */
  walking: boolean;
  /** Direction of travel this frame, if moving. */
  heading?: number;
}

/**
 * Advance a robot along its path toward `target` by `speed * dt`.
 *
 * - A new target (re)routes from the current position via `route` (which returns the waypoints
 *   after the start point).
 * - `engaged`: frozen in place. The path and its destination are kept as they are, so on release
 *   the robot continues the same walk, or, if the target moved meanwhile, reroutes to the new one.
 *
 * Pure (apart from mutating `st` and calling `onArrive`), so it is unit tested without three.js.
 */
export function stepPath(
  st: PathMotion,
  target: Point,
  opts: { dt: number; speed: number; engaged: boolean; route: (from: Point, to: Point) => Point[]; onArrive?: () => void },
): StepResult {
  const { dt, speed, engaged } = opts;
  if (engaged) {
    st.vx *= Math.max(0, 1 - dt * 12);
    st.vz *= Math.max(0, 1 - dt * 12);
    return { walking: false };
  }
  if (!(Math.abs(target.x - st.tx) < 5e-4 && Math.abs(target.z - st.tz) < 5e-4)) {
    st.tx = target.x;
    st.tz = target.z;
    if (Math.hypot(target.x - st.x, target.z - st.z) < 0.05) {
      st.path = [];
      opts.onArrive?.();
    } else {
      st.path = opts.route({ x: st.x, z: st.z }, target);
    }
  }
  let heading: number | undefined;
  if (st.path.length) {
    const next = st.path[0]!;
    const dx = next.x - st.x;
    const dz = next.z - st.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      heading = Math.atan2(dx, dz);
      const blend = Math.min(1, dt * 10);
      st.vx += ((dx / d) * speed - st.vx) * blend;
      st.vz += ((dz / d) * speed - st.vz) * blend;
    }
    let budget = speed * dt;
    while (budget > 0 && st.path.length) {
      const wp = st.path[0]!;
      const wdx = wp.x - st.x;
      const wdz = wp.z - st.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd <= budget) {
        st.x = wp.x;
        st.z = wp.z;
        budget -= wd;
        st.path.shift();
        if (!st.path.length) opts.onArrive?.();
      } else {
        st.x += (wdx / wd) * budget;
        st.z += (wdz / wd) * budget;
        budget = 0;
      }
    }
  } else {
    st.vx *= Math.max(0, 1 - dt * 12);
    st.vz *= Math.max(0, 1 - dt * 12);
  }
  return { walking: st.path.length > 0, heading };
}

/** Yaw that faces from (x, z) toward the viewer at (vx, vz): the walk-mode player or the overview camera. */
export function yawToViewer(x: number, z: number, vx: number, vz: number): number {
  return Math.atan2(vx - x, vz - z);
}
