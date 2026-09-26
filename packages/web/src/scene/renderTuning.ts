import type * as THREE from "three";

/** Minimal shape of three's internal render-list item (WebGLRenderLists RenderItem). */
export interface SortItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: { id: number; type: string };
}

/**
 * Opaque sort that groups by material TYPE before material id.
 *
 * three r169 sorts opaque items by material.id only, so each robot's own MeshPhysical / MeshStandard /
 * MeshBasic materials interleave and the renderer switches shader program on almost every draw
 * (measured: ~153 useProgram calls per frame for 13 robots, with the uniform refresh that comes with
 * each switch). Materials of one type share a program here (same lights, fog and shadow defines), so
 * grouping by type first cuts the switches to a handful per frame. Opaque draw order has no visual
 * effect (depth-tested); within a material we keep three's front-to-back z order for early-z.
 */
export function opaqueSortByMaterialType(a: SortItem, b: SortItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.material.type !== b.material.type) return a.material.type < b.material.type ? -1 : 1;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}

export function applyRenderTuning(gl: THREE.WebGLRenderer): void {
  gl.setOpaqueSort(opaqueSortByMaterialType as unknown as (a: unknown, b: unknown) => number);
}

/** Shadow map refresh while nothing walks: robots only breathe (a few cm), invisible at this rate. */
export const SHADOW_IDLE_MS = 200;
/** Keep refreshing every frame this long after the last movement (seat hop, settling). */
export const SHADOW_GRACE_MS = 1000;
/** A robot counts as moving when it shifted more than this (world units) since the previous frame. */
const MOVE_EPS = 1e-4;

/**
 * Decides per frame whether the (fixed, directional) shadow map needs re-rendering. The shadow camera
 * does not follow the view camera, so orbiting / walking never needs it; only moving casters do.
 * Measured: the shadow pass was ~91 draw calls and ~40 ms/s of main-thread time at idle.
 */
export class ShadowScheduler {
  private last = new Map<string, { x: number; z: number }>();
  private lastMotion = -Infinity;
  private lastUpdate = -Infinity;

  /** Returns true when the shadow map should be rendered this frame. No allocations once warmed up. */
  tick(now: number, live: ReadonlyMap<string, { x: number; z: number }>, forceMotion = false): boolean {
    let moved = forceMotion;
    for (const [id, p] of live) {
      const prev = this.last.get(id);
      if (!prev) {
        this.last.set(id, { x: p.x, z: p.z });
        moved = true;
      } else if (Math.abs(prev.x - p.x) > MOVE_EPS || Math.abs(prev.z - p.z) > MOVE_EPS) {
        prev.x = p.x;
        prev.z = p.z;
        moved = true;
      }
    }
    if (this.last.size > live.size) for (const id of this.last.keys()) if (!live.has(id)) { this.last.delete(id); moved = true; }
    if (moved) this.lastMotion = now;
    if (now - this.lastMotion < SHADOW_GRACE_MS || now - this.lastUpdate >= SHADOW_IDLE_MS) {
      this.lastUpdate = now;
      return true;
    }
    return false;
  }

  /** Something structural changed (furniture rebuilt, theme): refresh on the next frame. */
  poke(): void {
    this.lastUpdate = -Infinity;
  }
}
