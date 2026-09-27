import { z } from "zod";
import type { Agent, Placement } from "./agent.js";

/**
 * Office layout — honeycomb of flat-top hexagonal rooms ("spaces").
 * Axial coordinates (q, r); world x/z on the floor plane (y up).
 * Angles are measured in the x/z plane: angle 0 points along +x, 90 degrees along +z.
 *
 * The floor plan is data (OfficeLayout: every room with its kind and hex, see "layout as data" below).
 * The default plan (defaultLayout) puts the lounge in the centre, the Manager's Office west of it, the
 * meeting room north, four pods on the rest of ring 1 and My Office / Production Room / Research Room on
 * the west of ring 2; pods grow outward (growLayout) up to MAX_RINGS. validateLayout holds the rules.
 *
 * Legacy (0.2.16 and earlier, kept for rooms.json migration and old call sites): the Manager's Office was
 * hard-wired to the origin, ring 1 = four pods + meeting + lounge, rings 2/3 whole shells of pods
 * (buildSpaces, hexesForRing, nextAddRoomHex, ExplicitRoom, buildSpacesFromExplicit).
 */

/** Circumradius of one hex room (center to corner). */
export const HEX_R = 7;
/** Center to the middle of a wall (where the doorway is). */
export const HEX_APOTHEM = (HEX_R * Math.sqrt(3)) / 2;
/** Everyone walks along this circle inside a room; furniture stays inside it or out in the corners. */
export const WALK_R = 3.99;
/** Widest honeycomb the office grows to. */
export const MAX_RINGS = 3;
/** Desks per pod (2 rows of 3). */
export const POD_SEATS = 6;

/** Every kind of room. "office" is the manager's office, "myoffice" the human user's own room. */
export const SPACE_KINDS = ["office", "pod", "meeting", "lounge", "myoffice", "production", "research"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];
export const SpaceKindSchema = z.enum(SPACE_KINDS);

/** Most hexes the honeycomb can hold (1 + 3·k·(k+1) for k = MAX_RINGS): 37. */
export const MAX_HEXES = 1 + 3 * MAX_RINGS * (MAX_RINGS + 1);

export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
  q: number;
  r: number;
  x: number;
  z: number;
  /** Ring index (0 for the manager's office). */
  ring: number;
  /** How many worker seats the space has (0 for the manager's office). */
  seats: number;
}

export interface Point {
  x: number;
  z: number;
}

export interface SeatPose extends Point {
  /** Direction the robot looks, radians around Y (three.js convention: 0 looks along +z). */
  yaw: number;
}

/** Neighbour offsets. Direction i points from a center toward the doorway at angle DOOR_ANGLES[i]. */
export const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const DEG = Math.PI / 180;
export const DOOR_ANGLES: readonly number[] = [30 * DEG, -30 * DEG, -90 * DEG, -150 * DEG, 150 * DEG, 90 * DEG];

export const SEATS_BY_KIND: Record<SpaceKind, number> = {
  office: 0,
  pod: POD_SEATS,
  meeting: 6,
  lounge: 4,
  myoffice: 0,
  production: 2,
  research: 4,
};

/** Default display name of each kind (pods get "Pod <letter>" from their id, see defaultRoomName). */
export const DEFAULT_ROOM_NAMES: Record<SpaceKind, string> = {
  office: "Manager's Office",
  pod: "Pod",
  meeting: "Meeting Room",
  lounge: "Lounge",
  myoffice: "My Office",
  production: "Production Room",
  research: "Research Room",
};

export function axialToWorld(q: number, r: number, size = HEX_R): Point {
  return { x: size * 1.5 * q, z: size * Math.sqrt(3) * (r + q / 2) };
}

export function worldToAxial(x: number, z: number, size = HEX_R): { q: number; r: number } {
  const qf = x / (1.5 * size);
  const rf = z / (Math.sqrt(3) * size) - qf / 2;
  // Cube rounding.
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

/** Hexes of ring k, walked in a fixed order. */
export function hexRing(k: number): { q: number; r: number }[] {
  if (k === 0) return [{ q: 0, r: 0 }];
  const out: { q: number; r: number }[] = [];
  let q = AXIAL_DIRS[4]![0] * k;
  let r = AXIAL_DIRS[4]![1] * k;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < k; j++) {
      out.push({ q, r });
      q += AXIAL_DIRS[i]![0];
      r += AXIAL_DIRS[i]![1];
    }
  }
  return out;
}

function podLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** The camera sits toward +x/+z; pods closest to that side fill first so the busy rooms face you. */
const VIEW_ANGLE = 45 * DEG;
function viewOrder(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const pa = axialToWorld(a.q, a.r);
  const pb = axialToWorld(b.q, b.r);
  const da = Math.abs(angleDiff(Math.atan2(pa.z, pa.x), VIEW_ANGLE));
  const db = Math.abs(angleDiff(Math.atan2(pb.z, pb.x), VIEW_ANGLE));
  return da - db || a.q - b.q || a.r - b.r;
}

/** Pods on ring 1 (the meeting room and lounge take the two back hexes). */
const RING1_PODS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, -1],
  [-1, 1],
];
const MEETING_HEX = [0, -1] as const;
const LOUNGE_HEX = [-1, 0] as const;

/** Every space of a honeycomb with `rings` rings around the manager's office (clamped to 1..MAX_RINGS). */
export function buildSpaces(rings: number): Space[] {
  const n = Math.max(1, Math.min(MAX_RINGS, Math.floor(rings)));
  const mk = (id: string, name: string, kind: SpaceKind, q: number, r: number, ring: number): Space => ({ id, name, kind, q, r, ring, ...axialToWorld(q, r), seats: SEATS_BY_KIND[kind] });
  const out: Space[] = [mk("office", "Manager's Office", "office", 0, 0, 0)];
  let pod = 0;
  const addPod = (q: number, r: number, ring: number) => {
    const letter = podLetter(pod++);
    out.push(mk(`pod-${letter.toLowerCase()}`, `Pod ${letter}`, "pod", q, r, ring));
  };
  for (const [q, r] of RING1_PODS) addPod(q, r, 1);
  out.push(mk("meeting", "Meeting Room", "meeting", MEETING_HEX[0], MEETING_HEX[1], 1));
  out.push(mk("lounge", "Lounge", "lounge", LOUNGE_HEX[0], LOUNGE_HEX[1], 1));
  for (let k = 2; k <= n; k++) {
    for (const h of hexRing(k).sort(viewOrder)) addPod(h.q, h.r, k);
  }
  return out;
}

export function podCount(rings: number): number {
  return buildSpaces(rings).filter((s) => s.kind === "pod").length;
}

/** Id of the pod with the given index (0 → pod-a), independent of ring count. */
export function podId(index: number): string {
  return `pod-${podLetter(index).toLowerCase()}`;
}

/** Rings needed to seat `workers` in pods with at least one desk to spare. */
export function ringsFor(workers: number): number {
  for (let k = 1; k <= MAX_RINGS; k++) {
    if (podCount(k) * SEATS_BY_KIND.pod > workers) return k;
  }
  return MAX_RINGS;
}

export function spaceAt(spaces: Space[], x: number, z: number): Space | undefined {
  const { q, r } = worldToAxial(x, z);
  return spaces.find((s) => s.q === q && s.r === r);
}

/** Rooms reachable through a doorway of `s` (walls carrying a screen have no doorway). */
export function neighbors(spaces: Space[], s: Space): { dir: number; space: Space }[] {
  const out: { dir: number; space: Space }[] = [];
  AXIAL_DIRS.forEach(([dq, dr], dir) => {
    const n = spaces.find((o) => o.q === s.q + dq && o.r === s.r + dr);
    if (n && wallIsOpen(s, n)) out.push({ dir, space: n });
  });
  return out;
}

/** World-space midpoint of the doorway in wall `dir` of space `s`. */
export function doorPoint(s: Space, dir: number): Point {
  const a = DOOR_ANGLES[dir]!;
  return { x: s.x + HEX_APOTHEM * Math.cos(a), z: s.z + HEX_APOTHEM * Math.sin(a) };
}

/** The six corners of a space, starting at angle 0 and going counter-clockwise in angle. */
export function hexCorners(s: Point, radius = HEX_R): Point[] {
  return Array.from({ length: 6 }, (_, i) => ({ x: s.x + radius * Math.cos(i * 60 * DEG), z: s.z + radius * Math.sin(i * 60 * DEG) }));
}

export function yawToward(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// ---------- room furniture footprints (local to the room centre) ----------
//
// One source of truth for the scene (kit.ts furniture), walk mode (solids/colliders) and the
// phantom-collider audit. All coordinates are local to the room centre, world units, angles in the
// x/z plane (0° = +x, 90° = +z = south on the minimap, -90° = north). Walls sit at 30°+60°·k with
// the doorway in the middle; corners at 60°·k. Everyone walks the WALK_R (3.99) circle, so seats
// and desks stay well inside it and big pieces hug a wall that has no doorway.
//
// MY OFFICE ("myoffice", 0 worker seats, the human user's room):
//   - WALL_SCREEN: big wall screen (social hub) on the -150° wall (north-west), inner face at
//     HEX_APOTHEM - 0.08 from the centre, 3.2 wide x 1.8 tall, centre 1.8 above the floor.
//   - Executive desk: centre polar(-150°, 1.6), 1.9 wide x 0.85 deep, long side parallel to the
//     screen wall, the user's side facing the room centre (+30°).
//   - userHome(): the user's chair at polar(-150°, 0.75), looking across the desk at the screen.
//   - Free for decoration: corners 180° / 240° (either side of the screen), nothing within 1.2 of
//     the 30°, -30° and 90° doorways (manager's office, production room, research room).
//
// PRODUCTION ROOM ("production", 2 seats):
//   - PRODUCTION_SCREEN: big screen on the -90° wall (north), same size/height as WALL_SCREEN.
//   - 2 edit desks: centres (±1.0, -0.6), each 1.6 wide (x) x 0.8 deep (z), front edge toward the
//     screen (-z); monitor on each desk.
//   - Seats 0/1 at (-1.0, 0.3) / (1.0, 0.3), yaw PI (looking -z at the desk and the screen).
//   - Doorways of the default plan: 30° (meeting), 90° (manager's office), 150° (my office).
//
// RESEARCH ROOM ("research", 4 seats):
//   - Reading table: centre (0, 0), 2.8 long (x) x 1.1 deep (z).
//   - Seats 0/1 at (-0.7, -1.0) / (0.7, -1.0) yaw 0 (looking +z); 2/3 at (-0.7, 1.0) / (0.7, 1.0)
//     yaw PI (looking -z).
//   - Bookshelves go in the 150°..210° corners (west, no doorway in the default plan); keep the
//     30°, -30° and -90° doorways (pod D, manager's office, my office) clear.
//
// Screen walls are never doorways: wallIsOpen() treats a wall carrying a screen as solid, so
// routes, contiguity and the scene's doorway cuts all agree.

export interface WallScreenAnchor {
  /** Wall-midpoint angle (radians, x/z plane, local to the room). */
  angle: number;
  angleDeg: number;
  /** AXIAL_DIRS index of that wall (the neighbour on the other side is never reached through it). */
  dir: number;
  /** Centre of the screen's inner face, local to the room centre. */
  x: number;
  z: number;
  /** Height of the screen centre above the floor. */
  y: number;
  width: number;
  height: number;
  /** The way the screen faces (into the room), three.js yaw. */
  yaw: number;
}

function screenAnchor(angleDeg: number): WallScreenAnchor {
  const angle = angleDeg * DEG;
  const d = HEX_APOTHEM - 0.08;
  const p = { x: d * Math.cos(angle), z: d * Math.sin(angle) };
  const dir = DOOR_ANGLES.findIndex((a) => Math.abs(angleDiff(a, angle)) < 1e-6);
  return { angle, angleDeg, dir, x: p.x, z: p.z, y: 1.8, width: 3.2, height: 1.8, yaw: yawToward(p, { x: 0, z: 0 }) };
}

/** My Office wall screen (social hub): the -150° (north-west) wall. */
export const WALL_SCREEN: WallScreenAnchor = screenAnchor(-150);
/** Production Room big screen: the -90° (north) wall. */
export const PRODUCTION_SCREEN: WallScreenAnchor = screenAnchor(-90);

/** The screen wall of a room kind, if it has one. */
export function screenWall(kind: SpaceKind): WallScreenAnchor | undefined {
  return kind === "myoffice" ? WALL_SCREEN : kind === "production" ? PRODUCTION_SCREEN : undefined;
}

export const MYOFFICE_FOOTPRINT = {
  desk: { x: 1.6 * Math.cos(-150 * DEG), z: 1.6 * Math.sin(-150 * DEG), w: 1.9, d: 0.85, yaw: yawToward({ x: 1.6 * Math.cos(-150 * DEG), z: 1.6 * Math.sin(-150 * DEG) }, { x: 0, z: 0 }) },
  chair: { x: 0.75 * Math.cos(-150 * DEG), z: 0.75 * Math.sin(-150 * DEG) },
} as const;

export const PRODUCTION_FOOTPRINT = {
  desks: [
    { x: -1.0, z: -0.6, w: 1.6, d: 0.8 },
    { x: 1.0, z: -0.6, w: 1.6, d: 0.8 },
  ],
  seats: [
    { x: -1.0, z: 0.3 },
    { x: 1.0, z: 0.3 },
  ],
} as const;

export const RESEARCH_FOOTPRINT = {
  table: { x: 0, z: 0, w: 2.8, d: 1.1 },
  seats: [
    { x: -0.7, z: -1.0 },
    { x: 0.7, z: -1.0 },
    { x: -0.7, z: 1.0 },
    { x: 0.7, z: 1.0 },
  ],
} as const;

/**
 * False when the wall between two adjacent rooms carries a screen on either side (no doorway there).
 * Non-adjacent rooms return false.
 */
export function wallIsOpen(a: { kind: SpaceKind; q: number; r: number }, b: { kind: SpaceKind; q: number; r: number }): boolean {
  const dirAB = AXIAL_DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
  if (dirAB < 0) return false;
  const dirBA = (dirAB + 3) % 6;
  if (screenWall(a.kind)?.dir === dirAB) return false;
  if (screenWall(b.kind)?.dir === dirBA) return false;
  return true;
}

/** Where the human user's "You" avatar spawns in My Office: at the executive desk, facing the wall screen. */
export function userHome(s: Point): SeatPose {
  const p = { x: s.x + MYOFFICE_FOOTPRINT.chair.x, z: s.z + MYOFFICE_FOOTPRINT.chair.z };
  return { ...p, yaw: yawToward(p, { x: s.x + WALL_SCREEN.x, z: s.z + WALL_SCREEN.z }) };
}

/** Local seat layout of each kind, relative to the space center. */
export function seatLocal(kind: SpaceKind, seat: number): SeatPose {
  switch (kind) {
    case "pod": {
      // 6-desk pod: 2 rows of 3, desks back to back; each robot sits outside facing its monitor.
      const col = seat % 3; // 0, 1, 2
      const row = seat < 3 ? 0 : 1;
      const sx = (col - 1) * 1.2; // -1.2, 0, +1.2
      const sz = row === 0 ? -1.4 : 1.4;
      return { x: sx, z: sz, yaw: sz < 0 ? 0 : Math.PI };
    }
    case "meeting": {
      const a = seat * 60 * DEG;
      const p = { x: 2.7 * Math.cos(a), z: 2.7 * Math.sin(a) };
      return { ...p, yaw: yawToward(p, { x: 0, z: 0 }) };
    }
    case "lounge": {
      const a = (45 + seat * 90) * DEG;
      const p = { x: 2.2 * Math.cos(a), z: 2.2 * Math.sin(a) };
      return { ...p, yaw: yawToward(p, { x: 0, z: 0 }) };
    }
    case "production": {
      // 2 edit desks side by side, both facing the big screen on the PRODUCTION_SCREEN wall (-z).
      const p = PRODUCTION_FOOTPRINT.seats[seat % 2]!;
      return { x: p.x, z: p.z, yaw: Math.PI };
    }
    case "research": {
      // Long reading table along x: seats 0-1 on the -z side (looking +z), 2-3 on the +z side (looking -z).
      const p = RESEARCH_FOOTPRINT.seats[seat % 4]!;
      return { x: p.x, z: p.z, yaw: p.z < 0 ? 0 : Math.PI };
    }
    default:
      return { x: 0, z: 0, yaw: 0 };
  }
}

export function seatPose(s: Space, seat: number): SeatPose {
  const l = seatLocal(s.kind, seat);
  return { x: s.x + l.x, z: s.z + l.z, yaw: l.yaw };
}

/** Where the manager stands in its own office: behind the desk, looking toward the camera. */
export function managerHome(s: Space): SeatPose {
  const a = 225 * DEG;
  return { x: s.x + 1.89 * Math.cos(a), z: s.z + 1.89 * Math.sin(a), yaw: Math.PI / 4 };
}

/** Where the manager stops to talk to whoever sits at `seat`: a step toward the walkway, facing them. */
export function visitPose(s: Space, seat: number): SeatPose {
  const l = seatLocal(s.kind, seat);
  const a = Math.atan2(l.z, l.x);
  const rr = Math.hypot(l.x, l.z) + 1.05;
  const p = { x: s.x + rr * Math.cos(a), z: s.z + rr * Math.sin(a) };
  return { ...p, yaw: yawToward(p, { x: s.x + l.x, z: s.z + l.z }) };
}

// ---------- routing ----------

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function ringPoint(s: Space, a: number, radius = WALK_R): Point {
  return { x: s.x + radius * Math.cos(a), z: s.z + radius * Math.sin(a) };
}

/** Walk the walkway circle from angle a to angle b the short way, in steps of at most 30 degrees. */
function arc(s: Space, a: number, b: number): Point[] {
  const d = angleDiff(b, a);
  const steps = Math.max(1, Math.ceil(Math.abs(d) / (30 * DEG) - 1e-9));
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) out.push(ringPoint(s, a + (d * i) / steps));
  return out;
}

/** Rooms people should not cut through when a corridor of pods goes round (everything but pods). */
const PRIVATE_KINDS: ReadonlySet<SpaceKind> = new Set<SpaceKind>(["office", "meeting", "lounge", "myoffice", "production", "research"]);

/**
 * Cheapest chain of spaces from a to b. Crossing a meeting room, lounge, office, my office, production or
 * research room costs more than going round through pods.
 */
export function spacePath(spaces: Space[], from: Space, to: Space): Space[] {
  const dist = new Map<string, number>([[from.id, 0]]);
  const prev = new Map<string, Space>();
  const open = new Set<string>([from.id]);
  const byId = new Map(spaces.map((s) => [s.id, s]));
  while (open.size) {
    let cur: Space | undefined;
    for (const id of open) if (!cur || dist.get(id)! < dist.get(cur.id)!) cur = byId.get(id);
    if (!cur) break;
    open.delete(cur.id);
    if (cur.id === to.id) break;
    for (const { space: n } of neighbors(spaces, cur)) {
      const step = n.id !== to.id && PRIVATE_KINDS.has(n.kind) ? 4 : 1;
      const nd = dist.get(cur.id)! + step;
      if (nd < (dist.get(n.id) ?? Infinity)) {
        dist.set(n.id, nd);
        prev.set(n.id, cur);
        open.add(n.id);
      }
    }
  }
  if (!dist.has(to.id)) return [from, to];
  const chain: Space[] = [to];
  while (chain[0]!.id !== from.id) chain.unshift(prev.get(chain[0]!.id)!);
  return chain;
}

function dirBetween(a: Space, b: Space): number {
  return AXIAL_DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

/**
 * Waypoints from `from` to `to`, never crossing a wall: step out to the room's walkway,
 * go round it to a doorway, through the doorway, and so on until the target room, then step in to the target.
 * The first point is `from` itself.
 */
export function route(spaces: Space[], from: Point, to: Point): Point[] {
  const a = spaceAt(spaces, from.x, from.z) ?? spaces[0]!;
  const b = spaceAt(spaces, to.x, to.z) ?? spaces[0]!;
  const pts: Point[] = [{ x: from.x, z: from.z }];
  const chain = spacePath(spaces, a, b);
  let angle = Math.atan2(from.z - a.z, from.x - a.x);
  pts.push(ringPoint(a, angle));
  for (let i = 0; i < chain.length - 1; i++) {
    const cur = chain[i]!;
    const next = chain[i + 1]!;
    const dir = dirBetween(cur, next);
    if (dir < 0) continue;
    const doorAngle = DOOR_ANGLES[dir]!;
    pts.push(...arc(cur, angle, doorAngle));
    pts.push(doorPoint(cur, dir));
    angle = doorAngle + Math.PI;
    pts.push(ringPoint(next, angle));
  }
  const targetAngle = Math.atan2(to.z - b.z, to.x - b.x);
  pts.push(...arc(b, angle, targetAngle));
  pts.push({ x: to.x, z: to.z });
  return dedupe(pts);
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1e-3) out.push(p);
  }
  return out;
}

export function pathLength(pts: Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  return n;
}

// ---------- seating ----------

function byCreation(a: Agent, b: Agent): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export interface OfficePlan {
  spaces: Space[];
  /** Resolved seat of every worker (persisted placement when valid, else auto-assigned). */
  placements: Record<string, Placement>;
}

/**
 * Resolve every worker's seat on `layout` (default: defaultLayout for the roster size). Workers keep a
 * valid persisted placement (first come by creation wins a contested seat); a seat that no longer exists
 * (unknown room, seat out of range, a kind without seats) and workers without one fill the first free pod
 * desk in layout order. Without a layout the plan grows a ring only when every pod desk is taken, so a
 * stale seat in a ring the roster does not need is ignored and that worker is reseated inside.
 */
export function planOffice(agents: Agent[], layout?: OfficeLayout | null, spaceNames?: Record<string, string>): OfficePlan {
  const workerCount = agents.filter((a) => a.role === "worker").length;
  const spaces = buildSpacesFromLayout(layout ?? defaultLayout(workerCount), spaceNames);
  return planOfficeWithSpaces(spaces, agents);
}

export function firstFreeSeat(spaces: Space[], taken: Set<string>): Placement | undefined {
  for (const s of spaces) {
    if (s.kind !== "pod") continue;
    for (let seat = 0; seat < s.seats; seat++) if (!taken.has(`${s.id}#${seat}`)) return { space: s.id, seat };
  }
  return undefined;
}

/** The seat a newly created worker would take: a pod desk nobody sits at and nobody has as their workSeat. */
export function nextPlacement(agents: Agent[], layout?: OfficeLayout | null): Placement | undefined {
  const plan = planOffice(agents, layout);
  const taken = new Set(Object.values(plan.placements).map(placementKey));
  for (const k of designatedSeats(agents).keys()) taken.add(k);
  const base = layout ?? defaultLayout(agents.filter((a) => a.role === "worker").length);
  return firstFreeSeat(plan.spaces, taken) ?? firstFreeSeat(buildSpacesFromLayout(growLayout(base, taken.size)), taken);
}

/** "pod-a#2": the key two placements share when they are the same desk. */
export function placementKey(p: Placement): string {
  return `${p.space}#${p.seat}`;
}

/** Every worker's designated desk (workSeat) by seat key, optionally leaving one agent out. */
export function designatedSeats(agents: readonly Agent[], exceptId?: string): Map<string, Agent> {
  const out = new Map<string, Agent>();
  for (const a of agents) {
    if (a.role !== "worker" || !a.workSeat || a.id === exceptId) continue;
    const k = placementKey(a.workSeat);
    if (!out.has(k)) out.set(k, a);
  }
  return out;
}

/**
 * Where a worker who must give up its desk goes (a squatter whose desk's owner starts working, or an idle
 * worker on a desk the Manager just designated to someone else): its own workSeat when nobody sits there,
 * else the first free desk of `seats` that is nobody's workSeat, else any free desk. Undefined = none is
 * free (the caller sends it to the lounge). `placements` must already hold the desk being taken.
 */
export function freeDeskFor(agentId: string, seats: readonly Placement[], placements: Record<string, Placement>, agents: readonly Agent[]): Placement | undefined {
  const taken = new Set(Object.entries(placements).filter(([id]) => id !== agentId).map(([, p]) => placementKey(p)));
  const own = agents.find((a) => a.id === agentId)?.workSeat;
  if (own && !taken.has(placementKey(own))) return { space: own.space, seat: own.seat };
  const designated = designatedSeats(agents, agentId);
  const free = seats.filter((s) => !taken.has(placementKey(s)));
  const pick = free.find((s) => !designated.has(placementKey(s))) ?? free[0];
  return pick && { space: pick.space, seat: pick.seat };
}

/** Human label of a desk for tool messages: "Seat 2 in Pod A". */
export function seatLabel(spaces: readonly Space[], p: Placement, spaceNames: Record<string, string> = {}): string {
  const s = spaces.find((x) => x.id === p.space);
  return `Seat ${p.seat} in ${spaceNames[p.space] ?? s?.name ?? p.space}`;
}

/** Find a space by id or (case-insensitive) name. */
export function findSpace(spaces: Space[], ref: string): Space | undefined {
  const k = ref.trim().toLowerCase();
  return spaces.find((s) => s.id === k || s.name.toLowerCase() === k) ?? spaces.find((s) => s.id === k.replace(/\s+/g, "-"));
}

/** Everywhere a worker could be moved to: every seat of the current honeycomb (it grows by itself when full). */
export function assignableSpaces(agents: Agent[], layout?: OfficeLayout | null): Space[] {
  return planOffice(agents, layout).spaces.filter((s) => s.seats > 0);
}

/**
 * Same as `planOffice` but uses a pre-built Space[] instead of deriving it from worker count.
 * Used when the world has an explicit room layout (addRoom/removeRoom).
 */
export function planOfficeWithSpaces(spaces: Space[], agents: Agent[]): OfficePlan {
  const workers = agents.filter((a) => a.role === "worker").sort(byCreation);
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const taken = new Set<string>();
  const placements: Record<string, Placement> = {};
  const key = (p: Placement) => `${p.space}#${p.seat}`;
  for (const w of workers) {
    const p = w.placement;
    const s = p && byId.get(p.space);
    if (!p || !s || p.seat < 0 || p.seat >= s.seats || taken.has(key(p))) continue;
    placements[w.id] = { space: p.space, seat: p.seat };
    taken.add(key(p));
  }
  // Auto-seated workers keep off other workers' designated desks while one is free.
  const designated = designatedSeats(workers);
  for (const w of workers) {
    if (placements[w.id]) continue;
    const own = w.workSeat && byId.get(w.workSeat.space);
    if (w.workSeat && own && w.workSeat.seat < own.seats && !taken.has(key(w.workSeat))) {
      placements[w.id] = { ...w.workSeat };
      taken.add(key(w.workSeat));
      continue;
    }
    const avoid = new Set(taken);
    for (const [k, owner] of designated) if (owner.id !== w.id) avoid.add(k);
    const free = firstFreeSeat(spaces, avoid) ?? firstFreeSeat(spaces, taken);
    if (!free) continue;
    placements[w.id] = free;
    taken.add(key(free));
  }
  return { spaces, placements };
}

/** Explicit room record persisted in rooms.json. */
export interface ExplicitRoom {
  id: string;
  kind: "pod" | "meeting" | "lounge";
  name: string;
  q: number;
  r: number;
}

export const ExplicitRoomSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["pod", "meeting", "lounge"]),
  name: z.string(),
  q: z.number().int(),
  r: z.number().int(),
});

export const ExplicitRoomsSchema = z.array(ExplicitRoomSchema);

// ---------- ring-by-ring layout helpers (used by world.addRoom) ----------

/**
 * All hexes for a given ring in the canonical addRoom order.
 * Ring 1: RING1_PODS (4) then MEETING_HEX then LOUNGE_HEX.
 * Rings 2+: hexRing(k) sorted by viewOrder (closest to camera first).
 */
export function hexesForRing(ring: number): readonly { q: number; r: number }[] {
  if (ring === 1) {
    return [
      ...RING1_PODS.map(([q, r]) => ({ q, r })),
      { q: MEETING_HEX[0], r: MEETING_HEX[1] },
      { q: LOUNGE_HEX[0], r: LOUNGE_HEX[1] },
    ];
  }
  return hexRing(ring).sort(viewOrder);
}

/**
 * Returns the current maximum ring in use (0 = only manager's office).
 */
export function currentOfficeRings(rooms: { q: number; r: number }[]): number {
  if (rooms.length === 0) return 0;
  return Math.max(...rooms.map((r) => hexDistance(r, { q: 0, r: 0 })));
}

/**
 * Returns the next hex to use for addRoom (ring-by-ring order).
 * Returns null when all MAX_RINGS rings are full.
 * The ring-fill rule is enforced implicitly: ring k is only considered when ring k-1 is completely full.
 */
export function nextAddRoomHex(rooms: { q: number; r: number }[]): { q: number; r: number; ring: number } | null {
  const occupied = new Set(rooms.map((r) => `${r.q},${r.r}`));
  occupied.add("0,0"); // manager's office is always present
  for (let k = 1; k <= MAX_RINGS; k++) {
    const hexes = hexesForRing(k);
    const free = hexes.find((h) => !occupied.has(`${h.q},${h.r}`));
    if (free !== undefined) return { ...free, ring: k };
  }
  return null; // all MAX_RINGS rings are full
}

/** Generate a unique room ID for the next room of the given kind. */
export function nextRoomId(kind: Exclude<SpaceKind, "office">, rooms: ExplicitRoom[]): string {
  if (kind === "pod") {
    const count = rooms.filter((r) => r.kind === "pod").length;
    return `pod-${podLetter(count).toLowerCase()}`;
  }
  const count = rooms.filter((r) => r.kind === kind).length;
  if (count === 0) return kind; // 'meeting' or 'lounge'
  return `${kind}-${count + 1}`;
}

/** Builds a Space[] from an explicit room list (always prepends the Manager's Office at ring 0). */
export function buildSpacesFromExplicit(rooms: ExplicitRoom[]): Space[] {
  const mk = (id: string, name: string, kind: SpaceKind, q: number, r: number): Space => ({
    id,
    name,
    kind,
    q,
    r,
    ring: hexDistance({ q, r }, { q: 0, r: 0 }),
    ...axialToWorld(q, r),
    seats: SEATS_BY_KIND[kind],
  });
  return [
    mk("office", "Manager's Office", "office", 0, 0),
    ...rooms.map((r) => mk(r.id, r.name, r.kind, r.q, r.r)),
  ];
}

// ---------- layout as data ----------

export const LayoutRoomSchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: SpaceKindSchema,
  /** Custom name stored with the room (renames in office.json / spaceNames still win). */
  name: z.string().trim().min(1).max(40).optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type LayoutRoom = z.infer<typeof LayoutRoomSchema>;

/** The floor plan: every room, including the manager's office and My Office, on its hex. */
export const OfficeLayoutSchema = z.object({
  version: z.literal(1),
  rooms: z.array(LayoutRoomSchema).max(MAX_HEXES),
});
export type OfficeLayout = z.infer<typeof OfficeLayoutSchema>;

export interface Hex {
  q: number;
  r: number;
}

export interface LayoutMove {
  /** Room id to move. */
  space: string;
  toHex: Hex;
}

/**
 * Hexes of the default plan (the user's sketch; minimap: world x to the right, world z downward,
 * so west = -x, north = -z). The lounge takes the centre, the manager's office sits west of it,
 * the meeting room north, and the three new rooms fill the west side of ring 2.
 */
export const DEFAULT_HEXES = {
  lounge: { q: 0, r: 0 },
  office: { q: -1, r: 0 },
  meeting: { q: 0, r: -1 },
  myoffice: { q: -2, r: 0 },
  production: { q: -1, r: -1 },
  research: { q: -2, r: 1 },
} as const satisfies Record<string, Hex>;

/** Ring-1 pods of the default plan, in pod-a.. order. */
export const DEFAULT_RING1_PODS: readonly Hex[] = RING1_PODS.map(([q, r]) => ({ q, r }));

const ORIGIN: Hex = { q: 0, r: 0 };
const hexKey = (h: Hex) => `${h.q},${h.r}`;

/** Default display name of a room: "Pod C" for pod-c, "Meeting Room 2" for meeting-2, else the kind's name. */
export function defaultRoomName(kind: SpaceKind, id: string): string {
  if (kind === "pod") {
    const m = /^pod-([a-z]+)$/.exec(id);
    return m ? `Pod ${m[1]!.toUpperCase()}` : DEFAULT_ROOM_NAMES.pod;
  }
  const m = /-(\d+)$/.exec(id);
  return m && id === `${kind}-${m[1]}` ? `${DEFAULT_ROOM_NAMES[kind]} ${m[1]}` : DEFAULT_ROOM_NAMES[kind];
}

function cloneLayout(layout: OfficeLayout): OfficeLayout {
  return { version: 1, rooms: layout.rooms.map((r) => ({ ...r })) };
}

/** A fresh id for a new room of `kind`: the first unused pod-<letter>, else the kind, then kind-2, kind-3... */
export function newRoomId(layout: OfficeLayout, kind: SpaceKind): string {
  const used = new Set(layout.rooms.map((r) => r.id));
  if (kind === "pod") {
    for (let i = 0; ; i++) if (!used.has(podId(i))) return podId(i);
  }
  if (!used.has(kind)) return kind;
  for (let n = 2; ; n++) if (!used.has(`${kind}-${n}`)) return `${kind}-${n}`;
}

function inBounds(h: Hex): boolean {
  return hexDistance(h, ORIGIN) <= MAX_RINGS;
}

/**
 * Next hex a new room of `kind` would take: free, within MAX_RINGS, sharing an open wall (doorway)
 * with an existing room; nearest ring first, then the side facing the camera (viewOrder).
 */
export function nextGrowthHex(layout: OfficeLayout, kind: SpaceKind = "pod"): Hex | null {
  const occupied = new Map(layout.rooms.map((r) => [hexKey(r), r]));
  const candidates: Hex[] = [];
  for (let k = 0; k <= MAX_RINGS; k++) {
    for (const h of hexRing(k)) {
      if (occupied.has(hexKey(h))) continue;
      const touches = AXIAL_DIRS.some(([dq, dr]) => {
        const n = occupied.get(hexKey({ q: h.q + dq, r: h.r + dr }));
        return n !== undefined && wallIsOpen({ kind, ...h }, n);
      });
      if (touches) candidates.push(h);
    }
  }
  candidates.sort((a, b) => hexDistance(a, ORIGIN) - hexDistance(b, ORIGIN) || viewOrder(a, b));
  return candidates[0] ?? null;
}

function podSeatCount(layout: OfficeLayout): number {
  return layout.rooms.filter((r) => r.kind === "pod").length * SEATS_BY_KIND.pod;
}

/**
 * Append pods (fresh pod ids) on free hexes that share a doorway with the plan until the pods have at
 * least one desk to spare for `workerCount` workers, or the honeycomb is full. Nearest ring first, then
 * the camera-facing side. Returns the same layout object when nothing needs to grow.
 */
export function growLayout(layout: OfficeLayout, workerCount: number): OfficeLayout {
  if (podSeatCount(layout) > workerCount) return layout;
  const out = cloneLayout(layout);
  while (podSeatCount(out) <= workerCount) {
    const h = nextGrowthHex(out, "pod");
    if (!h) break;
    out.rooms.push({ id: newRoomId(out, "pod"), kind: "pod", q: h.q, r: h.r });
  }
  return out;
}

/** The default plan with `rings` rings: fixed rooms and ring-1 pods, then rings 2+ of pods in viewOrder around the fixed rooms. */
function defaultPlanRooms(rings: number): LayoutRoom[] {
  const n = Math.max(1, Math.min(MAX_RINGS, Math.floor(rings)));
  const rooms: LayoutRoom[] = [{ id: "office", kind: "office", ...DEFAULT_HEXES.office }];
  let pod = 0;
  for (const h of DEFAULT_RING1_PODS) rooms.push({ id: podId(pod++), kind: "pod", q: h.q, r: h.r });
  rooms.push({ id: "meeting", kind: "meeting", ...DEFAULT_HEXES.meeting });
  rooms.push({ id: "lounge", kind: "lounge", ...DEFAULT_HEXES.lounge });
  rooms.push({ id: "myoffice", kind: "myoffice", ...DEFAULT_HEXES.myoffice });
  rooms.push({ id: "production", kind: "production", ...DEFAULT_HEXES.production });
  rooms.push({ id: "research", kind: "research", ...DEFAULT_HEXES.research });
  const taken = new Set(rooms.map(hexKey));
  for (let k = 2; k <= n; k++) {
    for (const h of hexRing(k).sort(viewOrder)) if (!taken.has(hexKey(h))) rooms.push({ id: podId(pod++), kind: "pod", q: h.q, r: h.r });
  }
  return rooms;
}

/**
 * The default floor plan for `workerCount` workers: lounge in the centre, manager's office west of it,
 * meeting room north, ring-1 pods pod-a..pod-d as always, My Office / Production Room / Research Room on
 * the west side of ring 2, and whole rings of pods (like ringsFor) until the pods have a desk to spare.
 */
export function defaultLayout(workerCount = 0): OfficeLayout {
  for (let k = 1; k < MAX_RINGS; k++) {
    const rooms = defaultPlanRooms(k);
    if (rooms.filter((r) => r.kind === "pod").length * SEATS_BY_KIND.pod > workerCount) return { version: 1, rooms };
  }
  return { version: 1, rooms: defaultPlanRooms(MAX_RINGS) };
}

/** Spaces of a layout (manager's office first, then layout order). Names: spaceNames > room.name > default. */
export function buildSpacesFromLayout(layout: OfficeLayout, spaceNames: Record<string, string> = {}): Space[] {
  const rooms = [...layout.rooms.filter((r) => r.kind === "office"), ...layout.rooms.filter((r) => r.kind !== "office")];
  return rooms.map((r) => ({
    id: r.id,
    name: spaceNames[r.id] ?? r.name ?? defaultRoomName(r.kind, r.id),
    kind: r.kind,
    q: r.q,
    r: r.r,
    ...axialToWorld(r.q, r.r),
    ring: hexDistance(r, ORIGIN),
    seats: SEATS_BY_KIND[r.kind],
  }));
}

/** Ids of rooms reachable from the manager's office through doorways (screen walls are solid). */
export function reachableRooms(layout: OfficeLayout): Set<string> {
  const byHex = new Map(layout.rooms.map((r) => [hexKey(r), r]));
  const start = layout.rooms.find((r) => r.kind === "office");
  const seen = new Set<string>();
  if (!start) return seen;
  const queue: LayoutRoom[] = [start];
  seen.add(start.id);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dq, dr] of AXIAL_DIRS) {
      const n = byHex.get(hexKey({ q: cur.q + dq, r: cur.r + dr }));
      if (n && !seen.has(n.id) && wallIsOpen(cur, n)) {
        seen.add(n.id);
        queue.push(n);
      }
    }
  }
  return seen;
}

export interface ValidateLayoutContext {
  /** Seated workers (persisted placements): a room holding one may not disappear or lose that seat. */
  placements?: Record<string, Placement> | Placement[];
  /** The layout being replaced: only rooms that existed there count as "removed". */
  previous?: OfficeLayout | null;
}

export type LayoutValidation = { ok: true } | { ok: false; errors: string[] };

/**
 * Check a layout: schema; exactly one manager's office and one My Office (lounge / meeting / pod /
 * production / research are free); unique ids and hexes; every hex within MAX_RINGS of the centre
 * (so at most MAX_HEXES rooms); every room reachable from the manager's office through doorways; and,
 * with `ctx.placements`, no seated worker losing their room or seat.
 */
export function validateLayout(layout: OfficeLayout, ctx: ValidateLayoutContext = {}): LayoutValidation {
  const parsed = OfficeLayoutSchema.safeParse(layout);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "layout"}: ${i.message}`) };
  const rooms = parsed.data.rooms;
  const errors: string[] = [];
  const count = (k: SpaceKind) => rooms.filter((r) => r.kind === k).length;
  if (count("office") !== 1) errors.push(`exactly one manager's office required (found ${count("office")})`);
  if (count("myoffice") !== 1) errors.push(`exactly one My Office required (found ${count("myoffice")})`);
  const ids = new Set<string>();
  const hexes = new Map<string, string>();
  for (const r of rooms) {
    if (ids.has(r.id)) errors.push(`duplicate room id "${r.id}"`);
    ids.add(r.id);
    const k = hexKey(r);
    if (hexes.has(k)) errors.push(`rooms "${hexes.get(k)}" and "${r.id}" share hex ${k}`);
    else hexes.set(k, r.id);
    if (!inBounds(r)) errors.push(`room "${r.id}" at ${k} is outside the office (more than ${MAX_RINGS} rings from the centre)`);
  }
  if (count("office") === 1) {
    const reach = reachableRooms(parsed.data);
    for (const r of rooms) if (!reach.has(r.id)) errors.push(`room "${r.id}" at ${hexKey(r)} is not connected to the manager's office through a doorway`);
  }
  const placements = Array.isArray(ctx.placements) ? ctx.placements : Object.values(ctx.placements ?? {});
  if (placements.length) {
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const before = ctx.previous ? new Set(ctx.previous.rooms.map((r) => r.id)) : null;
    const reported = new Set<string>();
    for (const p of placements) {
      const room = byId.get(p.space);
      if (reported.has(p.space)) continue;
      if (!room) {
        if (!before || before.has(p.space)) {
          errors.push(`room "${p.space}" has seated workers and cannot be removed`);
          reported.add(p.space);
        }
      } else if (p.seat >= SEATS_BY_KIND[room.kind]) {
        errors.push(`room "${room.id}" (${room.kind}) has no seat ${p.seat} for a seated worker`);
        reported.add(p.space);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Move rooms to other hexes, in order. A move onto an occupied hex swaps the two rooms.
 * Throws on an unknown room id; the result is not validated (call validateLayout).
 */
export function applyLayoutMoves(layout: OfficeLayout, moves: LayoutMove[]): OfficeLayout {
  const out = cloneLayout(layout);
  for (const m of moves) {
    const room = out.rooms.find((r) => r.id === m.space);
    if (!room) throw new Error(`unknown room "${m.space}"`);
    if (room.q === m.toHex.q && room.r === m.toHex.r) continue;
    const other = out.rooms.find((r) => r.q === m.toHex.q && r.r === m.toHex.r);
    if (other) {
      other.q = room.q;
      other.r = room.r;
    }
    room.q = m.toHex.q;
    room.r = m.toHex.r;
  }
  return out;
}

/**
 * Change what the hex holds: a different kind replaces the room there with a fresh room of that kind
 * (new id, custom name dropped); an empty hex gets a new room; `null` removes the room; the same kind
 * is a no-op. The result is not validated (call validateLayout).
 */
export function setRoomKind(layout: OfficeLayout, hex: Hex, kind: SpaceKind | null): OfficeLayout {
  const out = cloneLayout(layout);
  const idx = out.rooms.findIndex((r) => r.q === hex.q && r.r === hex.r);
  const cur = idx >= 0 ? out.rooms[idx]! : undefined;
  if (cur?.kind === kind || (!cur && kind === null)) return out;
  if (kind === null) {
    out.rooms.splice(idx, 1);
    return out;
  }
  const rest: OfficeLayout = { version: 1, rooms: out.rooms.filter((_, i) => i !== idx) };
  const room: LayoutRoom = { id: newRoomId(rest, kind), kind, q: hex.q, r: hex.r };
  if (cur) out.rooms[idx] = room;
  else out.rooms.push(room);
  return out;
}
