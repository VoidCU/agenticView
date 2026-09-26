/**
 * Lounge spot model and assignment for the AgenticView lounge room.
 *
 * `loungeSpots(capacityHint, hexR)` returns a deterministic, scale-aware set of
 * physical spots inside (and optionally outside) the lounge room.  Pixel reads
 * the companion `furniture` array to place meshes at the same positions.
 *
 * `assignLoungeSpots(agentIds, spots, prior?)` assigns each agent to a unique
 * spot and is stable: agents in `prior` keep their spot when it is still free.
 *
 * `rpsFacing(a, b)` returns yaw angles so two players look at each other.
 */

import { HEX_APOTHEM, HEX_R, WALK_R } from "./office.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoungeSpotKind = "sofa" | "armchair" | "counter" | "beanbag" | "standing";

export interface LoungeSpot {
  /** Unique within one `LoungeLayout`; format: "kind-N" (e.g. "sofa-0"). */
  id: string;
  kind: LoungeSpotKind;
  /** X position relative to the lounge room centre. */
  x: number;
  /** Z position relative to the lounge room centre. */
  z: number;
  /** Yaw (radians) the occupant faces — three.js convention: 0 along +z. */
  yaw: number;
  pose: "sit" | "stand" | "floor";
  /** Eye/hip height in world units (0 = floor, 0.5 = low seat, 1.0 = standing). */
  seatHeight: number;
  /** Convenience unit-vector derived from yaw. */
  facing: { x: number; z: number };
  /** True for overflow spots placed just outside the doorway. */
  waiting?: boolean;
}

export interface LoungeFurniturePiece {
  /** Stable id, e.g. "sofa-0". */
  id: string;
  kind: LoungeSpotKind;
  /** Centre of the furniture piece, relative to the lounge room centre. */
  x: number;
  z: number;
  /** Yaw of the whole piece: its front (local +z) faces this way (three.js convention). */
  yaw: number;
  /** Number of seats this piece provides. */
  seats: number;
  /** Footprint width along the piece's local x axis (world units). */
  w: number;
  /** Footprint depth along the piece's local z axis (world units). */
  d: number;
}

/** Standing spot used while two agents play rock-paper-scissors. */
export interface LoungeGameSpot {
  /** "game-<pair>-a" / "game-<pair>-b". */
  id: string;
  x: number;
  z: number;
  /** Faces the partner spot of the same pair. */
  yaw: number;
}

export interface LoungeLayout {
  /** All spots, ordered: sofas → armchairs → counter → beanbags → standing → waiting. */
  spots: LoungeSpot[];
  /** Furniture pieces Pixel uses to render meshes and colliders (same footprints). */
  furniture: LoungeFurniturePiece[];
  /** Facing pairs of standing spots across the coffee table: [a, b] per pair. */
  gameSpots: [LoungeGameSpot, LoungeGameSpot][];
  /** Coffee table radius (table at the room centre). */
  tableR: number;
  /** Doorway direction (radians, local) whose walkway to the centre is kept clear. */
  doorAngle: number;
}

/** Max distance (world units) between two lounging agents' spots for an auto RPS match. */
export const RPS_PAIR_MAX_DIST = 1.5;

// ─── Internals ────────────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;

function facingFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Yaw so a point at `from` looks toward `to`. */
function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function spot(
  idx: number,
  kind: LoungeSpotKind,
  x: number,
  z: number,
  yaw: number,
  pose: "sit" | "stand" | "floor",
  seatHeight: number,
  waiting = false,
): LoungeSpot {
  const norm = ((yaw % TWO_PI) + TWO_PI) % TWO_PI;
  return { id: `${kind}-${idx}`, kind, x, z, yaw: norm, pose, seatHeight, facing: facingFromYaw(norm), ...(waiting ? { waiting: true } : {}) };
}

// ─── Spot generation ──────────────────────────────────────────────────────────

/**
 * Generate a full lounge layout scaled to `hexR` (default `HEX_R`).
 *
 * Base capacity (no waiting spots): 16 spots.
 * When `capacityHint > 16`, additional waiting spots are appended (distinct
 * positions just outside the main doorway).
 *
 * All positions are **local to the lounge room centre** so the caller can add
 * the room's world (x, z) to get world coordinates.
 */
export function loungeSpots(capacityHint = 0, hexR = HEX_R): LoungeLayout {
  const s = hexR / 7; // scale factor (1.0 at default HEX_R=7)
  const apothem = (hexR * Math.sqrt(3)) / 2;
  const spots: LoungeSpot[] = [];
  const furniture: LoungeFurniturePiece[] = [];
  const D = Math.PI / 180;
  const polar = (deg: number, r: number) => ({ x: r * Math.cos(deg * D), z: r * Math.sin(deg * D) });
  /** Local (lx along the piece's width, lz toward its front) → room coords. */
  const local = (p: { x: number; z: number }, yaw: number, lx: number, lz: number) => ({
    x: p.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    z: p.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  });

  let sofaIdx = 0;
  let armIdx = 0;
  let ctrIdx = 0;
  let beanIdx = 0;
  let standIdx = 0;

  // The coffee table sits at the centre (radius tableR). Every wall midpoint
  // (30° + k·60°) can hold a doorway, so all six walkways door→centre stay
  // clear and furniture lives in the six corner sectors (0°, 60°, …, 300°):
  //   180° sofa A · 300° sofa B · 240° two armchairs · 60° counter ·
  //   0° / 120° beanbags (in front of the corner plants/lamp).

  // ── Sofas: 3-seaters in the 180° and 300° corners, facing the table ──────
  for (const deg of [180, 300]) {
    const c = polar(deg, 4.6 * s);
    const yaw = yawToward(c, { x: 0, z: 0 });
    furniture.push({ id: `sofa-${sofaIdx / 3}`, kind: "sofa", x: c.x, z: c.z, yaw, seats: 3, w: 2.6 * s, d: 0.9 * s });
    for (const lx of [-0.85, 0, 0.85]) {
      const p = local(c, yaw, lx * s, 0.1 * s);
      spots.push(spot(sofaIdx++, "sofa", p.x, p.z, yaw, "sit", 0.45 * s));
    }
  }

  // ── Armchairs: a side-by-side pair in the 240° corner ─────────────────────
  {
    const c = polar(240, 4.5 * s);
    const yaw = yawToward(c, { x: 0, z: 0 });
    for (const lx of [-0.55, 0.55]) {
      const a = local(c, yaw, lx * s, 0);
      furniture.push({ id: `armchair-${armIdx}`, kind: "armchair", x: a.x, z: a.z, yaw, seats: 1, w: 1.0 * s, d: 0.9 * s });
      const p = local(a, yaw, 0, 0.1 * s);
      spots.push(spot(armIdx++, "armchair", p.x, p.z, yaw, "sit", 0.5 * s));
    }
  }

  // ── Coffee counter in the 60° corner; people stand in front facing it ────
  {
    const d = 0.7 * s;
    const c = polar(60, 5.0 * s);
    const yaw = yawToward(c, { x: 0, z: 0 }); // counter front faces the room
    furniture.push({ id: "counter-0", kind: "counter", x: c.x, z: c.z, yaw, seats: 3, w: 2.4 * s, d });
    for (const lx of [-0.75, 0, 0.75]) {
      const p = local(c, yaw, lx * s, d / 2 + 0.45 * s);
      spots.push(spot(ctrIdx++, "counter", p.x, p.z, yaw + Math.PI, "stand", 0));
    }
  }

  // ── Beanbags: 0° and 120° corners, in front of the decor ─────────────────
  for (const deg of [0, 120]) {
    const c = polar(deg, 4.0 * s);
    const yaw = yawToward(c, { x: 0, z: 0 });
    furniture.push({ id: `beanbag-${beanIdx}`, kind: "beanbag", x: c.x, z: c.z, yaw, seats: 1, w: 0.64 * s, d: 0.64 * s });
    spots.push(spot(beanIdx++, "beanbag", c.x, c.z, yaw, "floor", 0.2 * s));
  }

  // ── Standing spots: open floor between the corners and the table ─────────
  for (const deg of [0, 120, 240]) {
    const p = polar(deg, 3.0 * s);
    spots.push(spot(standIdx++, "standing", p.x, p.z, yawToward(p, { x: 0, z: 0 }), "stand", 0));
  }

  // Base count: 3+3+2+3+2+3 = 16
  const baseCapacity = spots.length;

  // ── Waiting spots (overflow) outside the main doorway ─────────────────────
  // The lounge hex is at axial (-1,0).  Its doorway toward hex (0,0) — the
  // manager's office — is at DOOR_ANGLES[0] = 30° (local to the lounge room).
  // Waiting agents queue just outside, fanning outward from the doorway.
  const needed = Math.max(0, capacityHint - baseCapacity);
  if (needed > 0) {
    // Doorway local position (at the wall).
    const doorAngle = Math.PI / 6; // 30°
    const doorX = HEX_APOTHEM * Math.cos(doorAngle) * s;
    const doorZ = HEX_APOTHEM * Math.sin(doorAngle) * s;    // Place waiting spots in a small arc just beyond the door.
    // Continue the standIdx so waiting spot IDs don't collide with the 3 regular standing spots.
    const outwardStep = 1.2 * s;
    for (let i = 0; i < needed; i++) {
      const spread = (i - (needed - 1) / 2) * 0.8 * s;
      const perpAngle = doorAngle + Math.PI / 2;
      const wx = doorX + (i + 1) * outwardStep * Math.cos(doorAngle) + spread * Math.cos(perpAngle);
      const wz = doorZ + (i + 1) * outwardStep * Math.sin(doorAngle) + spread * Math.sin(perpAngle);
      // Face back toward the room.
      const yaw = yawToward({ x: wx, z: wz }, { x: 0, z: 0 });
      spots.push(spot(standIdx + i, "standing", wx, wz, yaw, "stand", 0, true));
    }
  }

  // ── Game spots: facing pairs across the coffee table, perpendicular to the walkway ──
  const gameSpots: [LoungeGameSpot, LoungeGameSpot][] = [];
  [[0, 180]].forEach(([da, db], i) => {
    const a = polar(da!, 1.35 * s);
    const b = polar(db!, 1.35 * s);
    const f = rpsFacing(a, b);
    gameSpots.push([
      { id: `game-${i}-a`, x: a.x, z: a.z, yaw: f.yawA },
      { id: `game-${i}-b`, x: b.x, z: b.z, yaw: f.yawB },
    ]);
  });

  return { spots, furniture, gameSpots, tableR: 0.75 * s, doorAngle: 30 * D };
}

// ─── RPS pairing ──────────────────────────────────────────────────────────────

/**
 * Pairs of lounging agents whose assigned spots are within `maxDist` of each
 * other (default RPS_PAIR_MAX_DIST). Waiting (overflow) spots never pair.
 * Deterministic: sorted by distance, then agent ids. Each pair is [a, b] with a < b.
 */
export function nearbyRpsPairs(
  assignment: Record<string, string>,
  spots: LoungeSpot[],
  maxDist = RPS_PAIR_MAX_DIST,
): { a: string; b: string; dist: number }[] {
  const byId = new Map(spots.map((sp) => [sp.id, sp]));
  const ids = Object.keys(assignment).sort();
  const out: { a: string; b: string; dist: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const sa = byId.get(assignment[ids[i]!]!);
    if (!sa || sa.waiting) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const sb = byId.get(assignment[ids[j]!]!);
      if (!sb || sb.waiting) continue;
      const dist = Math.hypot(sa.x - sb.x, sa.z - sb.z);
      if (dist <= maxDist) out.push({ a: ids[i]!, b: ids[j]!, dist });
    }
  }
  out.sort((p, q) => p.dist - q.dist || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
  return out;
}

/** The layout + assignment the scene uses for a set of lounging agents (same call as Office.tsx). */
export function loungeAssignmentFor(
  agentIds: string[],
  prior: Record<string, string> = {},
): { layout: LoungeLayout; assignment: Record<string, string> } {
  const layout = loungeSpots(Math.max(16, agentIds.length + 2));
  return { layout, assignment: assignLoungeSpots(agentIds, layout.spots, prior) };
}

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * Deterministically assign each agentId to a unique LoungeSpot.
 *
 * Rules:
 * 1. Agents present in `prior` keep their spot when the spot still exists.
 * 2. Unassigned agents are given the next free spot in `spots` order, sorted by agentId.
 * 3. If there are more agents than spots the excess agents remain unassigned.
 *
 * Returns a map `agentId → spotId`.
 */
export function assignLoungeSpots(
  agentIds: string[],
  spots: LoungeSpot[],
  prior: Record<string, string> = {},
): Record<string, string> {
  const spotById = new Map(spots.map((s) => [s.id, s]));
  const taken = new Set<string>();
  const result: Record<string, string> = {};

  // Pass 1: honour prior assignments for agents still present.
  for (const id of agentIds) {
    const prevSpot = prior[id];
    if (prevSpot && spotById.has(prevSpot) && !taken.has(prevSpot)) {
      result[id] = prevSpot;
      taken.add(prevSpot);
    }
  }

  // Pass 2: assign remaining agents in sorted order (deterministic).
  const unassigned = [...agentIds].filter((id) => !result[id]).sort();
  let spotIdx = 0;
  for (const id of unassigned) {
    while (spotIdx < spots.length && taken.has(spots[spotIdx]!.id)) spotIdx++;
    if (spotIdx >= spots.length) break;
    result[id] = spots[spotIdx]!.id;
    taken.add(spots[spotIdx]!.id);
    spotIdx++;
  }

  return result;
}

// ─── RPS facing ───────────────────────────────────────────────────────────────

/**
 * Given the positions of two RPS players (local to any common origin), return
 * the yaw each should use so they look directly at each other.
 */
export function rpsFacing(
  a: { x: number; z: number },
  b: { x: number; z: number },
): { yawA: number; yawB: number } {
  return {
    yawA: yawToward(a, b),
    yawB: yawToward(b, a),
  };
}
