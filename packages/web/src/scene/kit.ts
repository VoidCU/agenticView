import {
  AXIAL_DIRS,
  DOOR_ANGLES,
  HEX_R,
  MYOFFICE_FOOTPRINT,
  PRODUCTION_FOOTPRINT,
  PRODUCTION_SCREEN,
  RESEARCH_FOOTPRINT,
  WALL_SCREEN,
  seatLocal,
  userHome,
  wallIsOpen,
  yawToward,
  managerHome,
  loungeSpots,
  type Space,
  type WallScreenAnchor,
} from "@agenticview/shared";

/**
 * The static office is described as a flat list of primitives (box, rounded box, cylinder, ...)
 * grouped by material, then drawn with one InstancedMesh per (primitive, material) pair.
 * A few hundred pieces of furniture cost a couple of dozen draw calls.
 */
export type Prim = "box" | "rbox" | "cyl" | "sphere" | "ico" | "cone";
export type Mat =
  | "wallBase"
  | "glass"
  | "alu"
  | "deskTop"
  | "deskLeg"
  | "felt"
  | "bezel"
  | "screen"
  | "keyboard"
  | "chair"
  | "chairBase"
  | "pot"
  | "potDark"
  | "leaf"
  | "leaf2"
  | "shelf"
  | "walnut"
  | "book"
  | "sofa"
  | "sofa2"
  | "cushion"
  | "rugOffice"
  | "rugLounge"
  | "rugLounge2"
  | "whiteboard"
  | "lampGlow"
  | "accent"
  /** My Office warm rug. */
  | "rugMine"
  /** Studio acoustic fabric (production screen wall). */
  | "acoustic"
  /** Plain white matte fabric/paint, always tinted per instance (green screen, cork, globe...). */
  | "fabric";

export interface Item {
  prim: Prim;
  mat: Mat;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  rx: number;
  rz: number;
  /** Per-instance tint (multiplied with the material colour). */
  color?: string;
}

interface Frame {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

type V3 = [number, number, number];

/**
 * A desk / meeting / visitor chair as drawn: world pose, its item range in Kit.items, and whether a
 * walker may push it (walk mode). Only chairs whose owner is at the seat are fixed.
 */
export interface ChairInfo {
  /** Stable id: "space#seat" for seats, "space#v<i>" for visitor chairs. */
  id: string;
  x: number;
  z: number;
  yaw: number;
  pushable: boolean;
  /** Index of the chair's first item in Kit.items; it spans `count` items. */
  first: number;
  count: number;
}

export class Kit {
  constructor(
    readonly items: Item[] = [],
    private readonly f: Frame = { x: 0, y: 0, z: 0, yaw: 0 },
    readonly chairs: ChairInfo[] = [],
  ) {}

  /** World pose of this frame's origin. */
  origin(): { x: number; z: number; yaw: number } {
    return { x: this.f.x, z: this.f.z, yaw: this.f.yaw };
  }

  /** Map a local x/z to world using three's Y-rotation convention (local +z faces (sin yaw, cos yaw)). */
  private pt(x: number, z: number) {
    const c = Math.cos(this.f.yaw);
    const s = Math.sin(this.f.yaw);
    return { x: this.f.x + x * c + z * s, z: this.f.z - x * s + z * c };
  }

  frame(x: number, z: number, yaw = 0, y = 0): Kit {
    const p = this.pt(x, z);
    return new Kit(this.items, { x: p.x, z: p.z, y: this.f.y + y, yaw: this.f.yaw + yaw }, this.chairs);
  }

  add(prim: Prim, mat: Mat, [x, y, z]: V3, [sx, sy, sz]: V3, o: { yaw?: number; rx?: number; rz?: number; color?: string } = {}): this {
    const p = this.pt(x, z);
    this.items.push({ prim, mat, x: p.x, y: this.f.y + y, z: p.z, sx, sy, sz, yaw: this.f.yaw + (o.yaw ?? 0), rx: o.rx ?? 0, rz: o.rz ?? 0, color: o.color });
    return this;
  }

  box(mat: Mat, pos: V3, size: V3, o?: { yaw?: number; rx?: number; rz?: number; color?: string }) {
    return this.add("box", mat, pos, size, o);
  }
  rbox(mat: Mat, pos: V3, size: V3, o?: { yaw?: number; rx?: number; rz?: number; color?: string }) {
    return this.add("rbox", mat, pos, size, o);
  }
  /** Upright cylinder: `d` diameter, `h` height, centred at pos. */
  cyl(mat: Mat, pos: V3, d: number, h: number, o?: { color?: string; dz?: number }) {
    return this.add("cyl", mat, pos, [d, h, o?.dz ?? d], o);
  }
}

// ---------- footprints shared with the walk-mode colliders (scene/solids.ts) ----------

/** Pod desk top (width along the row, depth). */
export const DESK_SIZE = { w: 1.18, d: 0.66 } as const;
/** Manager's executive desk top. */
export const EXEC_DESK_SIZE = { w: 2.1, d: 0.95 } as const;
/** Open bookshelf footprint. */
export const SHELF_SIZE = { w: 1.3, d: 0.36 } as const;
/** Credenza body footprint. */
export const CREDENZA_SIZE = { w: 1.6, d: 0.46 } as const;
/** Sofa depth (every width). */
export const SOFA_D = 0.86;
/** Armchair width (a one-seat sofa). */
export const ARMCHAIR_W = 0.95;
/** Kitchenette counter depth (the walnut top overhangs the 0.62 body). */
export const COUNTER_D = 0.66;
/** Pod felt privacy screen along the cluster spine. */
export const PRIVACY_SCREEN = { w: 3.8, d: 0.06 } as const;
/** Whiteboard stand: posts at +-legX, board frame 1.66 wide. */
export const WHITEBOARD_STAND = { w: 1.7, d: 0.1 } as const;
/** Meeting-room TV stand: a 1.9 wide, 0.06 deep screen on two legs (at +-legX) with 0.6 deep feet. */
export const TV_STAND = { w: 1.9, d: 0.06, legX: 0.7, footW: 0.08, footD: 0.6 } as const;
/** Lounge scoreboard on its stand: board 1.75 x 1.15 (centre 1.15 up), posts at +-postX. */
export const SCOREBOARD_STAND = { w: 1.75, d: 0.1, h: 1.15, y: 1.15, postX: 0.9 } as const;
/** Production backdrop (green screen) on two posts. */
export const BACKDROP_STAND = { w: 1.9, d: 0.1 } as const;
/** Research reading table (shared RESEARCH_FOOTPRINT). */
export const READING_TABLE = RESEARCH_FOOTPRINT.table;
/** Production edit desk top (shared PRODUCTION_FOOTPRINT). */
export const EDIT_DESK = { w: PRODUCTION_FOOTPRINT.desks[0].w, d: PRODUCTION_FOOTPRINT.desks[0].d } as const;
/** My Office executive desk (shared MYOFFICE_FOOTPRINT). */
export const MY_DESK = MYOFFICE_FOOTPRINT.desk;
/** Research globe: base diameter and sphere diameter. */
export const GLOBE = { base: 0.36, sphere: 0.55 } as const;
/** Tripod camera: the collider is just the centre column / camera body, the legs splay under it. */
export const TRIPOD = { r: 0.1 } as const;
/** Small round side table next to the My Office sofa. */
export const SIDE_TABLE_D = 0.5;
/** Softbox light stand base. */
export const SOFTBOX_BASE_D = 0.4;

/**
 * A wall screen's face as the kit draws it: the lit screen front sits `front` in front of the
 * anchor's inner-face point (local +z faces into the room). Overlays go SCREEN_FACE_NUDGE past it.
 */
export const SCREEN_FACE = { front: 0.002 } as const;
export const SCREEN_FACE_NUDGE = 0.003;

// ---------- furniture (all built in a local frame: +z is "front") ----------

const DEG = Math.PI / 180;
const DESK_H = 0.74;

function hashColor(list: string[], n: number): string {
  return list[Math.abs(Math.floor(n)) % list.length]!;
}

/** A desk whose front (+z) faces the person sitting at it. */
export function desk(k: Kit, screen?: string, seed = 0) {
  // Width 1.18 gives a comfortable 0.02 gap to adjacent desks at 1.2-unit column spacing.
  k.rbox("deskTop", [0, DESK_H - 0.025, 0], [DESK_SIZE.w, 0.05, DESK_SIZE.d]);
  for (const x of [-0.54, 0.54]) k.box("deskLeg", [x, (DESK_H - 0.05) / 2, 0], [0.05, DESK_H - 0.05, 0.58]);
  k.box("deskLeg", [0, 0.5, -0.22], [1.1, 0.16, 0.02]);
  // Monitor: bezel, glowing screen, neck, foot.
  k.box("bezel", [0, 1.06, -0.18], [0.66, 0.4, 0.03], { rx: -0.08 });
  k.box("screen", [0, 1.06, -0.163], [0.61, 0.35, 0.004], { rx: -0.08, color: screen });
  k.box("alu", [0, 0.86, -0.21], [0.05, 0.22, 0.03]);
  k.box("alu", [0, DESK_H + 0.008, -0.2], [0.24, 0.016, 0.16]);
  k.box("keyboard", [-0.02, DESK_H + 0.01, 0.1], [0.44, 0.018, 0.14]);
  k.box("keyboard", [0.33, DESK_H + 0.01, 0.12], [0.07, 0.02, 0.1]);
  if (seed % 3 === 0) k.cyl("pot", [-0.45, DESK_H + 0.06, 0.02], 0.09, 0.12);
  if (seed % 3 === 1) {
    k.cyl("pot", [0.46, DESK_H + 0.05, -0.12], 0.12, 0.1);
    k.add("ico", "leaf2", [0.46, DESK_H + 0.17, -0.12], [0.2, 0.18, 0.2]);
  }
  if (seed % 4 === 2) k.box("book", [-0.42, DESK_H + 0.03, -0.05], [0.24, 0.05, 0.3], { yaw: 0.2, color: "#e4b04a" });
}

/** Swivel chair; the sitter faces +z. */
/** Top of the desk-chair seat cushion (seat box y 0.47 + half height 0.04). Seated robots rest here. */
export const CHAIR_SEAT_TOP = 0.51;
/** An assigned seat whose owner stepped away: the chair is swivelled off the desk and rolled back. */
export const AWAY_CHAIR_SWIVEL = 70 * (Math.PI / 180);
export const AWAY_CHAIR_ROLLBACK = 0.18;
/**
 * A seated robot sits on the front of its chair: the chair is drawn this far behind the seat point
 * so the backrest (0.25 + this, minus half its 0.07 depth) clears the 0.43-radius robot body.
 */
export const SEATED_CHAIR_BACK = 0.25;
/** The manager sits this much farther back from the executive desk than managerHome() so the raised body clears the desktop. */
export const MANAGER_DESK_CLEARANCE = 0.15;

export function chair(k: Kit, tag?: { id: string; pushable: boolean }) {
  const first = k.items.length;
  k.rbox("chair", [0, 0.47, 0], [0.5, 0.08, 0.48]);
  k.rbox("chair", [0, 0.82, -0.25], [0.46, 0.52, 0.07], { rx: -0.1 });
  k.cyl("chairBase", [0, 0.27, 0], 0.06, 0.38);
  k.cyl("chairBase", [0, 0.05, 0], 0.56, 0.04);
  for (const x of [-0.26, 0.26]) k.box("chairBase", [x, 0.6, -0.02], [0.04, 0.03, 0.3]);
  if (tag) k.chairs.push({ ...tag, ...k.origin(), first, count: k.items.length - first });
}

export function plant(k: Kit, size = 1, seed = 0) {
  const s = size;
  k.cyl(seed % 2 ? "potDark" : "pot", [0, 0.22 * s, 0], 0.42 * s, 0.44 * s, {});
  k.cyl("chairBase", [0, 0.45 * s, 0], 0.36 * s, 0.02);
  k.add("ico", "leaf", [0, 0.82 * s, 0], [0.7 * s, 0.75 * s, 0.7 * s], { yaw: seed });
  k.add("ico", "leaf2", [0.16 * s, 1.14 * s, -0.08 * s], [0.5 * s, 0.6 * s, 0.5 * s], { yaw: seed * 2 });
  k.add("ico", "leaf", [-0.12 * s, 1.38 * s, 0.06 * s], [0.34 * s, 0.44 * s, 0.34 * s], { yaw: seed * 3 });
}

/** Tall open bookshelf, 1.3 wide. */
export function bookshelf(k: Kit, seed = 0, tall = 1.7) {
  const w = SHELF_SIZE.w;
  const d = SHELF_SIZE.d;
  for (const x of [-w / 2, w / 2]) k.box("shelf", [x, tall / 2, 0], [0.04, tall, d]);
  const shelves = Math.round(tall / 0.42);
  for (let i = 0; i <= shelves; i++) k.box("shelf", [0, (i * tall) / shelves, 0], [w, 0.035, d]);
  k.box("shelf", [0, tall / 2, -d / 2 + 0.01], [w, tall, 0.02]);
  const books = ["#d9644a", "#3f6f8f", "#e4b04a", "#6b8f71", "#efe7da", "#7b5ea7"];
  for (let i = 0; i < shelves; i++) {
    let x = -w / 2 + 0.06;
    let n = seed * 7 + i * 13;
    while (x < w / 2 - 0.12) {
      n = (n * 31 + 7) % 97;
      const bw = 0.04 + (n % 5) * 0.012;
      const bh = 0.24 + (n % 4) * 0.03;
      if (n % 11 === 0) {
        x += 0.14;
        continue;
      }
      k.box("book", [x + bw / 2, (i * tall) / shelves + 0.02 + bh / 2, 0.02], [bw, bh, 0.24], { color: hashColor(books, n) });
      x += bw + 0.008;
    }
  }
}

/** Low sideboard with a few objects on top. */
export function credenza(k: Kit, seed = 0) {
  k.rbox("shelf", [0, 0.34, 0], [CREDENZA_SIZE.w, 0.62, CREDENZA_SIZE.d]);
  k.box("deskLeg", [0, 0.02, 0], [1.5, 0.04, 0.4]);
  for (const x of [-0.4, 0.4]) k.box("walnut", [x, 0.34, 0.232], [0.76, 0.56, 0.006]);
  k.cyl("pot", [-0.5, 0.75, 0], 0.16, 0.22);
  k.add("ico", "leaf2", [-0.5, 0.95, 0], [0.26, 0.3, 0.26]);
  for (let i = 0; i < 4; i++) k.box("book", [0.25 + i * 0.07, 0.8, -0.02], [0.05, 0.28, 0.22], { color: hashColor(["#3f6f8f", "#e4b04a", "#efe7da", "#d9644a"], i + seed) });
  if (seed % 2 === 0) k.rbox("bezel", [0.1, 0.7, 0], [0.34, 0.12, 0.28]);
}

export function whiteboard(k: Kit) {
  for (const x of [-0.85, 0.85]) {
    k.box("alu", [x, 0.85, 0], [0.04, 1.7, 0.04]);
    k.box("alu", [x, 0.02, 0], [0.06, 0.04, 0.5]);
  }
  k.box("alu", [0, 1.12, -0.005], [1.66, 0.96, 0.03]);
  k.box("whiteboard", [0, WHITEBOARD_FACE.y, WHITEBOARD_FACE.z - 0.005], [WHITEBOARD_FACE.w, WHITEBOARD_FACE.h, 0.01]);
}

export function floorLamp(k: Kit) {
  k.cyl("chairBase", [0, 0.02, 0], 0.34, 0.04);
  k.cyl("alu", [0, 0.8, 0], 0.035, 1.56);
  k.add("cone", "lampGlow", [0, 1.62, 0], [0.46, 0.3, 0.46]);
}

export function sofa(k: Kit, mat: "sofa" | "sofa2" = "sofa", width = 1.9) {
  k.rbox(mat, [0, 0.24, 0], [width, 0.3, SOFA_D]);
  k.rbox(mat, [0, 0.6, -0.33], [width, 0.56, 0.22]);
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) k.rbox(mat, [x, 0.44, 0], [0.2, 0.36, 0.86]);
  const seats = width > 1.5 ? [-width / 4 + 0.05, width / 4 - 0.05] : [0];
  for (const x of seats) k.rbox(mat, [x, 0.44, 0.06], [width / seats.length - 0.28, 0.12, 0.62]);
  k.rbox("cushion", [-width / 2 + 0.38, 0.68, -0.14], [0.36, 0.34, 0.12], { rx: -0.25, yaw: 0.2 });
  for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) for (const z of [-0.34, 0.34]) k.cyl("deskLeg", [x, 0.04, z], 0.05, 0.08);
}

export function armchair(k: Kit, mat: "sofa" | "sofa2" = "sofa2") {
  sofa(k, mat, ARMCHAIR_W);
}

/** Coffee point: counter, machine, mugs. */
export function kitchenette(k: Kit, counterW = 1.9) {
  k.rbox("deskTop", [0, 0.46, 0], [counterW, 0.9, 0.62]);
  k.box("walnut", [0, 0.92, 0], [counterW + 0.04, 0.04, COUNTER_D]);
  k.rbox("bezel", [-0.5, 1.13, -0.05], [0.34, 0.38, 0.3]);
  k.box("lampGlow", [-0.5, 1.2, 0.101], [0.08, 0.04, 0.004]);
  for (let i = 0; i < 3; i++) k.cyl("pot", [0.1 + i * 0.16, 0.99, 0.12], 0.08, 0.1, { color: ["#ffffff", "#e4b04a", "#3f6f8f"][i] });
  k.cyl("pot", [0.65, 1.05, -0.05], 0.22, 0.22);
  k.add("ico", "leaf2", [0.65, 1.28, -0.05], [0.3, 0.32, 0.3]);
}

/** A standing TV for the meeting room. */
export function tvStand(k: Kit) {
  for (const x of [-TV_STAND.legX, TV_STAND.legX]) {
    k.box("deskLeg", [x, 0.7, 0], [0.05, 1.4, 0.05]);
    k.box("deskLeg", [x, 0.02, 0], [TV_STAND.footW, 0.04, TV_STAND.footD]);
  }
  k.box("bezel", [0, 1.35, 0], [TV_STAND.w, 1.1, TV_STAND.d]);
  k.box("screen", [0, 1.35, 0.032], [1.8, 1.0, 0.004], { color: "#2d5fd1" });
  // Slide content: a title bar and three bars of a chart.
  k.box("lampGlow", [-0.45, 1.7, 0.036], [0.7, 0.07, 0.003]);
  [0.25, 0.45, 0.62].forEach((h, i) => k.box("accent", [0.2 + i * 0.22, 0.98 + h / 2, 0.036], [0.14, h, 0.003]));
}

// ---------- rooms ----------

/** Corner slots: vertex directions k*60deg, 4.6 from the center, facing in. */
export function cornerFrame(angleDeg: number, at = 4.55): { x: number; z: number; yaw: number } {
  const dist = (at * HEX_R) / 6;
  const a = angleDeg * DEG;
  const x = dist * Math.cos(a);
  const z = dist * Math.sin(a);
  return { x, z, yaw: yawToward({ x, z }, { x: 0, z: 0 }) };
}

/**
 * Whiteboard corner slot per room kind (meeting rooms put the TV at 240, so the board goes to 180;
 * the production room keeps 240/300 for the ends of its screen wall; the research room has
 * bookshelves round the west corners). Lounges and My Office have no whiteboard.
 */
export const WHITEBOARD_SLOT = {
  pod: { angleDeg: 240, at: 4.4 },
  meeting: { angleDeg: 180, at: 4.4 },
  production: { angleDeg: 120, at: 4.4 },
  research: { angleDeg: 300, at: 4.4 },
} as const;

/** Room kinds that carry a whiteboard (clickable board, visit target). */
export function hasWhiteboard(kind: Space["kind"]): boolean {
  return kind !== "lounge" && kind !== "myoffice";
}

/** Whiteboard corner slot of a room kind (office uses the pod slot). */
export function whiteboardSlot(kind: Space["kind"]): { angleDeg: number; at: number } {
  return kind === "meeting" || kind === "production" || kind === "research" ? WHITEBOARD_SLOT[kind] : WHITEBOARD_SLOT.pod;
}

/**
 * A frame against the wall that runs from the corner at `fromDeg` toward the adjacent corner at
 * `toDeg`: `along` from the corner, `inset` in from the wall's centre line, local +z facing into the
 * room. Wall runs within 2.5 of a corner never reach the doorway (the middle 1.8 of the 7-long wall).
 */
export function wallRunFrame(fromDeg: number, toDeg: number, along: number, inset: number): { x: number; z: number; yaw: number } {
  const a = { x: HEX_R * Math.cos(fromDeg * DEG), z: HEX_R * Math.sin(fromDeg * DEG) };
  const b = { x: HEX_R * Math.cos(toDeg * DEG), z: HEX_R * Math.sin(toDeg * DEG) };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const ml = Math.hypot(mx, mz);
  const nx = -mx / ml;
  const nz = -mz / ml;
  return { x: a.x + ux * along + nx * inset, z: a.z + uz * along + nz * inset, yaw: Math.atan2(nx, nz) };
}

/** Local frame of a wall screen anchor (origin on the screen's inner face, +z into the room). */
export function screenFrame(anchor: WallScreenAnchor): { x: number; z: number; yaw: number } {
  return { x: anchor.x, z: anchor.z, yaw: anchor.yaw };
}

/** Bookshelf height in the research room (taller than the pod shelves). */
export const RESEARCH_SHELF_TALL = 2.0;
/** Wall-run shelves sit this far in from the wall centre line (half partition + half shelf depth + gap). */
const SHELF_INSET = 0.05 + SHELF_SIZE.d / 2 + 0.02;

/** Research bookshelves: the 180 corner plus four wall runs on the 150 and 210 walls, clear of their doorways. */
export function researchShelfFrames(): { x: number; z: number; yaw: number }[] {
  return [
    cornerFrame(180, 4.55),
    wallRunFrame(180, 120, 1.75, SHELF_INSET),
    wallRunFrame(180, 240, 1.75, SHELF_INSET),
    wallRunFrame(120, 180, 1.75, SHELF_INSET),
    wallRunFrame(240, 180, 1.75, SHELF_INSET),
  ];
}

/** Research corner props: pinboard, globe and plants. */
export const RESEARCH_PROPS = {
  pinboard: { angleDeg: 240, at: 4.4 },
  globe: { angleDeg: 120, at: 4.6 },
  plants: [
    { angleDeg: 0, at: 4.7, size: 1.1 },
    { angleDeg: 60, at: 4.8, size: 0.95 },
  ],
} as const;

/** Production props: tripod camera aimed at the green-screen backdrop, a softbox light, gear rack, plants. */
export const PRODUCTION_PROPS = {
  tripod: { x: 1.7, z: 2.1 },
  backdrop: { angleDeg: 180, at: 4.5 },
  softbox: { angleDeg: 240, at: 4.6 },
  rack: { angleDeg: 300, at: 4.55 },
  plants: [
    { angleDeg: 0, at: 4.7, size: 1.0 },
    { angleDeg: 60, at: 4.8, size: 0.9 },
  ],
} as const;

/** My Office props round the executive desk: couch corner, plants either side of the wall screen, lamp, credenza. */
export const MYOFFICE_PROPS = {
  sofa: { angleDeg: 120, at: 4.4, w: 1.9 },
  armchair: { angleDeg: 0, at: 4.4 },
  /** Side table beside the sofa, in the sofa's frame. */
  sideTableX: 1.3,
  plants: [
    { angleDeg: 180, at: 4.7, size: 1.25 },
    { angleDeg: 240, at: 4.7, size: 1.15 },
  ],
  /** Floor lamp beside the armchair, in its frame (away from the floor decal). */
  lampX: -0.85,
  credenza: { angleDeg: 300, at: 4.55 },
} as const;

/** The user's desk chair in My Office (local): behind userHome, facing the wall screen. */
export function myOfficeChairFrame(): { x: number; z: number; yaw: number } {
  const home = userHome({ x: 0, z: 0 });
  return { x: home.x - Math.sin(home.yaw) * SEATED_CHAIR_BACK, z: home.z - Math.cos(home.yaw) * SEATED_CHAIR_BACK, yaw: home.yaw };
}

/** Lounge scoreboard stand (local to the lounge): on the 210 wall's run next to the 180 corner, clear of the doorway. */
export function scoreboardFrame(): { x: number; z: number; yaw: number } {
  return wallRunFrame(180, 240, 1.45, 0.2);
}
/** Board face inside the whiteboard frame: centre y, front-face z (box z 0.012 + half depth 0.005), size. */
export const WHITEBOARD_FACE = { y: 1.12, z: 0.017, w: 1.6, h: 0.9 } as const;

function corner(k: Kit, angleDeg: number, at = 4.55): Kit {
  const c = cornerFrame(angleDeg, at);
  return k.frame(c.x, c.z, c.yaw);
}

export interface RoomOccupancy {
  /** seat -> screen/tint colour for an occupied seat. */
  seats: Map<number, string>;
  /** Assigned seats whose owner is currently elsewhere (lounge, meeting, visiting, walking). */
  away?: Set<number>;
}

function podRoom(k: Kit, s: Space, occ: RoomOccupancy, seed: number) {
  for (let seat = 0; seat < s.seats; seat++) {
    const l = seatLocal("pod", seat);
    const dz = l.z < 0 ? -0.36 : 0.36;
    desk(k.frame(l.x, dz, l.z < 0 ? Math.PI : 0), occ.seats.get(seat), seed + seat);
    const back = l.z < 0 ? -1 : 1;
    const id = `${s.id}#${seat}`;
    if (!occ.seats.has(seat)) chair(k.frame(l.x, l.z + back * 0.1, l.yaw), { id, pushable: true });
    else if (occ.away?.has(seat)) chair(k.frame(l.x, l.z + back * (SEATED_CHAIR_BACK + AWAY_CHAIR_ROLLBACK), l.yaw + AWAY_CHAIR_SWIVEL), { id, pushable: true });
    else chair(k.frame(l.x, l.z + back * SEATED_CHAIR_BACK, l.yaw), { id, pushable: false });
  }
  // Felt privacy screen along the spine of the cluster, with an aluminium cap.
  k.rbox("felt", [0, DESK_H + 0.2, 0], [PRIVACY_SCREEN.w, 0.4, 0.05]);
  k.box("alu", [0, DESK_H + 0.405, 0], [PRIVACY_SCREEN.w, 0.015, PRIVACY_SCREEN.d]);
  k.box("deskLeg", [0, 0.36, 0], [0.06, 0.72, 0.06]);
  // Corners: tall pieces at the back (away from the camera), low ones at the front.
  bookshelf(corner(k, 180), seed);
  whiteboard(corner(k, WHITEBOARD_SLOT.pod.angleDeg, WHITEBOARD_SLOT.pod.at));
  credenza(corner(k, 300), seed);
  plant(corner(k, 0, 4.7), 1.1, seed);
  plant(corner(k, 120, 4.7), 0.9, seed + 1);
  credenza(corner(k, 60, 4.7), seed + 1);
}

function officeRoom(k: Kit, s: Space, occ: RoomOccupancy = { seats: new Map() }) {
  const home = managerHome({ ...s, x: 0, z: 0 });
  // Rug, then the executive desk between the manager and the room.
  k.cyl("rugOffice", [0, 0.006, 0], 6.0, 0.012);
  k.cyl("accent", [0, 0.004, 0], 6.1, 0.008);
  const toCam = { x: Math.cos(45 * DEG), z: Math.sin(45 * DEG) };
  const deskAt = { x: home.x + toCam.x * 0.78, z: home.z + toCam.z * 0.78 };
  const dk = k.frame(deskAt.x, deskAt.z, yawToward(deskAt, home));
  dk.rbox("walnut", [0, 0.75, 0], [EXEC_DESK_SIZE.w, 0.07, EXEC_DESK_SIZE.d]);
  dk.rbox("walnut", [-0.82, 0.37, 0], [0.42, 0.72, 0.85]);
  dk.box("deskLeg", [0.95, 0.37, 0], [0.05, 0.72, 0.85]);
  dk.box("walnut", [0.1, 0.45, -0.44], [1.5, 0.5, 0.03]);
  dk.box("bezel", [0.62, 1.02, -0.2], [0.62, 0.38, 0.03], { rx: -0.08, yaw: 0.45 });
  dk.box("screen", [0.627, 1.02, -0.186], [0.57, 0.33, 0.004], { rx: -0.08, yaw: 0.45, color: "#ffc14d" });
  dk.box("alu", [0.62, 0.86, -0.22], [0.05, 0.2, 0.03]);
  dk.box("keyboard", [0.15, 0.8, 0.1], [0.46, 0.018, 0.14]);
  dk.cyl("alu", [-0.7, 0.81, -0.2], 0.16, 0.04);
  dk.cyl("alu", [-0.7, 1.0, -0.22], 0.025, 0.4);
  dk.add("cone", "lampGlow", [-0.62, 1.22, -0.14], [0.24, 0.16, 0.24], { rx: 0.5 });
  dk.box("book", [0.75, 0.8, 0.12], [0.28, 0.04, 0.2], { color: "#b5503b", yaw: -0.3 });
  // Two visitor chairs in front, facing the manager.
  const front = { x: deskAt.x + toCam.x * 1.05, z: deskAt.z + toCam.z * 1.05 };
  [-0.62, 0.62].forEach((side, i) => {
    const p = { x: front.x + side * toCam.z, z: front.z - side * toCam.x };
    chair(k.frame(p.x, p.z, yawToward(p, home)), { id: `${s.id}#v${i}`, pushable: true });
  });
  // Manager desk chair (seat 0 = manager): under the seated manager, or swivelled and rolled back
  // when they stepped out.
  if (occ.seats.has(0)) {
    const away = occ.away?.has(0) ?? false;
    const d = MANAGER_DESK_CLEARANCE + SEATED_CHAIR_BACK + (away ? AWAY_CHAIR_ROLLBACK : 0);
    const fx = Math.sin(home.yaw), fz = Math.cos(home.yaw);
    chair(k.frame(home.x - fx * d, home.z - fz * d, home.yaw + (away ? AWAY_CHAIR_SWIVEL : 0)), { id: `${s.id}#0`, pushable: away });
  }
  bookshelf(corner(k, 180, 4.5), 3, 1.9);
  whiteboard(corner(k, WHITEBOARD_SLOT.pod.angleDeg, WHITEBOARD_SLOT.pod.at));
  credenza(corner(k, 300), 2);
  armchair(corner(k, 0, 4.4));
  plant(corner(k, 60, 4.8), 1.25, 2);
  plant(corner(k, 120, 4.7), 1.0, 5);
}

function meetingRoom(k: Kit, s: Space, occ: RoomOccupancy) {
  // Table diameter 4.2 (radius 2.1) suits the 40% bigger rooms; seats are at radius 2.7.
  k.cyl("walnut", [0, 0.74, 0], 4.2, 0.07);
  k.cyl("deskLeg", [0, 0.37, 0], 0.48, 0.7);
  k.cyl("deskLeg", [0, 0.02, 0], 1.6, 0.04);
  for (let i = 0; i < 3; i++) k.box("book", [Math.cos(i * 2.1) * 0.5, 0.79, Math.sin(i * 2.1) * 0.5], [0.22, 0.01, 0.3], { yaw: i, color: "#efe7da" });
  k.cyl("pot", [0, 0.86, 0], 0.18, 0.18);
  k.add("ico", "leaf2", [0, 1.02, 0], [0.26, 0.24, 0.26]);
  for (let seat = 0; seat < s.seats; seat++) {
    const taken = occ.seats.has(seat);
    const away = taken && (occ.away?.has(seat) ?? false);
    const l = seatLocal("meeting", seat);
    const r = Math.hypot(l.x, l.z);
    const back = !taken ? r + 0.12 : r + SEATED_CHAIR_BACK + (away ? AWAY_CHAIR_ROLLBACK : 0);
    const a = Math.atan2(l.z, l.x);
    chair(k.frame(back * Math.cos(a), back * Math.sin(a), l.yaw + (away ? AWAY_CHAIR_SWIVEL : 0)), { id: `${s.id}#${seat}`, pushable: !taken || away });
  }
  tvStand(corner(k, 240, 4.5));
  whiteboard(corner(k, WHITEBOARD_SLOT.meeting.angleDeg, WHITEBOARD_SLOT.meeting.at));
  credenza(corner(k, 300), 4);
  plant(corner(k, 0, 4.7), 1.1, 3);
  plant(corner(k, 60, 4.8), 0.8, 4);
  plant(corner(k, 120, 4.7), 1.2, 6);
}

function loungeRoom(k: Kit, _s: Space, _occ: RoomOccupancy) {
  // Place furniture using the shared loungeSpots layout so positions match agent spots exactly.
  // Use fp.w and fp.d (the footprint dimensions from loungeSpots) directly so visual sizes
  // match the lounge layout at any scale factor.
  const { furniture, tableR } = loungeSpots();

  // Rugs and coffee table — diameter from tableR so it matches the collision radius.
  k.cyl("rugLounge", [0, 0.006, 0], 5.4, 0.012);
  k.cyl("rugLounge2", [0, 0.01, 0], 4.2, 0.012);
  k.cyl("rugLounge", [0, 0.014, 0], 3.8, 0.012);
  k.cyl("walnut", [0, 0.38, 0], tableR * 2, 0.05);
  k.cyl("deskLeg", [0, 0.19, 0], 0.16, 0.36);
  k.cyl("pot", [0.15, 0.46, 0.1], 0.1, 0.12, { color: "#e4b04a" });
  k.box("book", [-0.2, 0.42, -0.1], [0.3, 0.03, 0.22], { yaw: 0.4, color: "#3f6f8f" });

  for (const fp of furniture) {
    const fk = k.frame(fp.x, fp.z, fp.yaw);
    if (fp.kind === "sofa") {
      // Use fp.w (footprint width) so the sofa spans the correct number of seats
      sofa(fk, fp.seats >= 3 ? "sofa" : "sofa2", fp.w);
    } else if (fp.kind === "armchair") {
      // Use fp.w for armchair width (1.0*s per lounge layout)
      sofa(fk, "sofa2", fp.w);
    } else if (fp.kind === "counter") {
      // Pass fp.w so the counter top matches the layout footprint (2.4*s)
      kitchenette(fk, fp.w);
    } else if (fp.kind === "beanbag") {
      // Low floor cushion sized to layout footprint
      fk.rbox("cushion", [0, 0.12, 0], [fp.w, 0.22, fp.d]);
    }
  }

  // Corner decor: lamp and plants
  floorLamp(corner(k, 120, 4.6));
  plant(corner(k, 0, 4.7), 1.2, 7);
  plant(corner(k, 60, 4.8), 0.8, 8);

  // Scoreboard stand (LoungeScoreboard.tsx draws the live face on it). Every lounge wall can be a
  // doorway (the lounge is the centre hex), so it stands on a wall run beside the 180 corner.
  const sb = scoreboardFrame();
  const b = k.frame(sb.x, sb.z, sb.yaw);
  for (const x of [-SCOREBOARD_STAND.postX, SCOREBOARD_STAND.postX]) {
    b.box("alu", [x, (SCOREBOARD_STAND.y + 0.5) / 2, -0.02], [0.04, SCOREBOARD_STAND.y + 0.5, 0.04]);
    b.box("alu", [x, 0.02, -0.02], [0.06, 0.04, 0.1]);
  }
  b.box("bezel", [0, SCOREBOARD_STAND.y, -0.025], [SCOREBOARD_STAND.w + 0.05, SCOREBOARD_STAND.h + 0.05, 0.04]);
}

// ---------- My Office, Production Room, Research Room ----------

/**
 * A big wall screen on a screen wall (anchor from shared WALL_SCREEN / PRODUCTION_SCREEN): a backing
 * panel set into the wall line, the bezel, and the lit screen whose front face is at local z
 * SCREEN_FACE.front (the live canvas overlay sits SCREEN_FACE_NUDGE past it).
 */
function wallScreen(k: Kit, anchor: WallScreenAnchor, backing: Mat, backingW: number, screenColor: string) {
  const f = k.frame(anchor.x, anchor.z, anchor.yaw);
  const top = anchor.y + anchor.height / 2 + 0.35;
  f.box(backing, [0, top / 2, -0.1], [backingW, top, 0.04]);
  f.box("bezel", [0, anchor.y, -0.035], [anchor.width + 0.1, anchor.height + 0.1, 0.06]);
  f.box("screen", [0, anchor.y, SCREEN_FACE.front - 0.002], [anchor.width, anchor.height, 0.004], { color: screenColor });
  // A slim shelf under the screen with a soundbar.
  f.box("walnut", [0, anchor.y - anchor.height / 2 - 0.12, 0.04], [anchor.width * 0.7, 0.03, 0.16]);
  f.rbox("bezel", [0, anchor.y - anchor.height / 2 - 0.07, 0.04], [anchor.width * 0.5, 0.07, 0.09]);
}

function myOfficeRoom(k: Kit, s: Space) {
  // Warm rug over the dark wood floor, under the desk and chair, with a thin brass edge.
  const rug = k.frame(1.15 * Math.cos(-150 * DEG), 1.15 * Math.sin(-150 * DEG), MY_DESK.yaw);
  rug.box("rugMine", [0, 0.006, 0], [3.6, 0.012, 2.9]);
  rug.box("accent", [0, 0.004, 0], [3.7, 0.008, 3.0]);
  wallScreen(k, WALL_SCREEN, "walnut", WALL_SCREEN.width + 0.9, "#1b2740");

  // Executive desk: long side parallel to the screen wall, the user's side (+z) toward the room.
  const dk = k.frame(MY_DESK.x, MY_DESK.z, MY_DESK.yaw);
  dk.rbox("walnut", [0, 0.75, 0], [MY_DESK.w, 0.07, MY_DESK.d]);
  dk.rbox("walnut", [-MY_DESK.w / 2 + 0.24, 0.37, 0], [0.42, 0.72, MY_DESK.d - 0.08]);
  dk.box("deskLeg", [MY_DESK.w / 2 - 0.06, 0.37, 0], [0.05, 0.72, MY_DESK.d - 0.08]);
  dk.box("walnut", [0.1, 0.45, -MY_DESK.d / 2 + 0.04], [MY_DESK.w - 0.5, 0.5, 0.03]);
  // Laptop (lid toward the user, low so the wall screen stays in view), lamp, a book and a mug.
  dk.box("alu", [0.15, 0.795, 0.12], [0.38, 0.02, 0.26]);
  dk.box("alu", [0.15, 0.91, -0.02], [0.38, 0.24, 0.012], { rx: -0.22 });
  dk.box("screen", [0.15, 0.91, -0.013], [0.34, 0.2, 0.004], { rx: -0.22, color: "#8fb8ff" });
  dk.cyl("alu", [-0.7, 0.8, -0.2], 0.16, 0.04);
  dk.cyl("alu", [-0.7, 0.99, -0.22], 0.025, 0.4);
  dk.add("cone", "lampGlow", [-0.62, 1.21, -0.14], [0.24, 0.16, 0.24], { rx: 0.5 });
  dk.box("book", [0.68, 0.8, 0.05], [0.26, 0.04, 0.2], { color: "#3f6f8f", yaw: 0.25 });
  dk.cyl("pot", [-0.35, 0.83, 0.2], 0.08, 0.1, { color: "#e4b04a" });
  const ch = myOfficeChairFrame();
  chair(k.frame(ch.x, ch.z, ch.yaw), { id: `${s.id}#u`, pushable: true });

  // Couch corner: sofa, armchair and a side table with a lamp.
  const sf = corner(k, MYOFFICE_PROPS.sofa.angleDeg, MYOFFICE_PROPS.sofa.at);
  sofa(sf, "sofa", MYOFFICE_PROPS.sofa.w);
  sf.cyl("walnut", [MYOFFICE_PROPS.sideTableX, 0.5, 0], SIDE_TABLE_D, 0.04);
  sf.cyl("deskLeg", [MYOFFICE_PROPS.sideTableX, 0.25, 0], 0.06, 0.5);
  sf.cyl("deskLeg", [MYOFFICE_PROPS.sideTableX, 0.015, 0], 0.34, 0.03);
  sf.add("cone", "lampGlow", [MYOFFICE_PROPS.sideTableX, 0.72, 0], [0.26, 0.2, 0.26]);
  sf.cyl("alu", [MYOFFICE_PROPS.sideTableX, 0.58, 0], 0.03, 0.14);
  const ac = corner(k, MYOFFICE_PROPS.armchair.angleDeg, MYOFFICE_PROPS.armchair.at);
  armchair(ac, "sofa2");
  floorLamp(ac.frame(MYOFFICE_PROPS.lampX, 0));
  MYOFFICE_PROPS.plants.forEach((p, i) => plant(corner(k, p.angleDeg, p.at), p.size, 11 + i));
  credenza(corner(k, MYOFFICE_PROPS.credenza.angleDeg, MYOFFICE_PROPS.credenza.at), 6);
}

/** An edit desk (1.6 x 0.8): main monitor exactly like a pod desk's, a second one angled on the outer side. */
function editDesk(k: Kit, screen: string | undefined, outer: number) {
  const w = EDIT_DESK.w;
  const d = EDIT_DESK.d;
  k.rbox("deskTop", [0, DESK_H - 0.025, 0], [w, 0.05, d]);
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) k.box("deskLeg", [x, (DESK_H - 0.05) / 2, 0], [0.05, DESK_H - 0.05, d - 0.1]);
  k.box("deskLeg", [0, 0.5, -d / 2 + 0.08], [w - 0.12, 0.16, 0.02]);
  // Main monitor (DeskMonitor overlays this face: local (0, 1.06, -0.163), tilt -0.08).
  k.box("bezel", [0, 1.06, -0.18], [0.66, 0.4, 0.03], { rx: -0.08 });
  k.box("screen", [0, 1.06, -0.163], [0.61, 0.35, 0.004], { rx: -0.08, color: screen });
  k.box("alu", [0, 0.86, -0.21], [0.05, 0.22, 0.03]);
  k.box("alu", [0, DESK_H + 0.008, -0.2], [0.24, 0.016, 0.16]);
  // Second monitor, turned toward the editor: a colour-graded timeline.
  const m = k.frame(outer * 0.56, -0.14, -outer * 0.45);
  m.box("bezel", [0, 1.02, 0], [0.46, 0.3, 0.03], { rx: -0.08 });
  m.box("screen", [0, 1.02, 0.017], [0.42, 0.26, 0.004], { rx: -0.08, color: screen ? "#e8a93a" : undefined });
  m.box("alu", [0, 0.85, -0.02], [0.04, 0.2, 0.03]);
  m.box("alu", [0, DESK_H + 0.008, -0.02], [0.18, 0.016, 0.12]);
  // Keyboard, jog wheel and a pair of desk speakers.
  k.box("keyboard", [-0.08, DESK_H + 0.01, 0.12], [0.44, 0.018, 0.14]);
  k.cyl("chairBase", [0.3, DESK_H + 0.02, 0.14], 0.12, 0.03);
  for (const x of [-0.62 * outer, 0.4 * outer]) k.rbox("bezel", [x, DESK_H + 0.11, -0.28], [0.12, 0.2, 0.14]);
}

function tripodCamera(k: Kit) {
  for (let i = 0; i < 3; i++) {
    const leg = k.frame(0, 0, (i * 120 + 30) * DEG);
    leg.box("deskLeg", [0, 0.63, 0.18], [0.025, 1.3, 0.025], { rx: -0.28 });
  }
  k.cyl("deskLeg", [0, 1.28, 0], 0.05, 0.12);
  k.rbox("bezel", [0, 1.42, 0], [0.18, 0.2, 0.38]);
  k.add("cyl", "bezel", [0, 1.43, 0.25], [0.12, 0.14, 0.12], { rx: Math.PI / 2 });
  k.add("cyl", "alu", [0, 1.43, 0.325], [0.1, 0.01, 0.1], { rx: Math.PI / 2 });
  k.box("alu", [0, 1.56, -0.02], [0.05, 0.05, 0.2]);
  k.box("screen", [0.06, 1.5, 0.12], [0.02, 0.02, 0.02], { color: "#ff3b30" });
  // Flip-out viewfinder on the left side.
  k.box("bezel", [-0.12, 1.45, -0.05], [0.02, 0.1, 0.14]);
}

function backdrop(k: Kit) {
  for (const x of [-0.95, 0.95]) {
    k.box("alu", [x, 1.15, 0], [0.04, 2.3, 0.04]);
    k.box("alu", [x, 0.02, 0], [0.06, 0.04, 0.5]);
  }
  k.box("alu", [0, 2.3, 0], [1.96, 0.04, 0.04]);
  k.box("fabric", [0, 1.2, 0.01], [1.8, 2.1, 0.03], { color: "#3fa45b" });
  // The sweep: the green paper rolls out onto the floor.
  k.box("fabric", [0, 0.008, 0.55], [1.8, 0.012, 1.0], { color: "#3fa45b" });
}

function softbox(k: Kit) {
  k.cyl("chairBase", [0, 0.02, 0], SOFTBOX_BASE_D, 0.04);
  k.cyl("alu", [0, 0.9, 0], 0.035, 1.76);
  k.rbox("fabric", [0, 1.85, -0.02], [0.62, 0.62, 0.26], { color: "#2a2d33" });
  k.box("lampGlow", [0, 1.85, 0.115], [0.54, 0.54, 0.004]);
}

function productionRoom(k: Kit, s: Space, occ: RoomOccupancy) {
  wallScreen(k, PRODUCTION_SCREEN, "acoustic", PRODUCTION_SCREEN.width + 1.5, "#101722");
  // Acoustic battens either side of the screen.
  const sf = k.frame(PRODUCTION_SCREEN.x, PRODUCTION_SCREEN.z, PRODUCTION_SCREEN.yaw);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) sf.box("walnut", [side * (PRODUCTION_SCREEN.width / 2 + 0.12 + i * 0.16), 1.4, -0.07], [0.05, 2.5, 0.03]);
  PRODUCTION_FOOTPRINT.desks.forEach((d, seat) => {
    editDesk(k.frame(d.x, d.z, 0), occ.seats.get(seat), Math.sign(d.x) || 1);
    const l = seatLocal("production", seat);
    const id = `${s.id}#${seat}`;
    // Seats look -z (yaw PI): the chair goes behind them, toward +z.
    if (!occ.seats.has(seat)) chair(k.frame(l.x, l.z + 0.1, l.yaw), { id, pushable: true });
    else if (occ.away?.has(seat)) chair(k.frame(l.x, l.z + SEATED_CHAIR_BACK + AWAY_CHAIR_ROLLBACK, l.yaw + AWAY_CHAIR_SWIVEL), { id, pushable: true });
    else chair(k.frame(l.x, l.z + SEATED_CHAIR_BACK, l.yaw), { id, pushable: false });
  });
  const bd = cornerFrame(PRODUCTION_PROPS.backdrop.angleDeg, PRODUCTION_PROPS.backdrop.at);
  const t = PRODUCTION_PROPS.tripod;
  tripodCamera(k.frame(t.x, t.z, yawToward(t, bd)));
  backdrop(corner(k, PRODUCTION_PROPS.backdrop.angleDeg, PRODUCTION_PROPS.backdrop.at));
  softbox(corner(k, PRODUCTION_PROPS.softbox.angleDeg, PRODUCTION_PROPS.softbox.at));
  credenza(corner(k, PRODUCTION_PROPS.rack.angleDeg, PRODUCTION_PROPS.rack.at), 1);
  whiteboard(corner(k, WHITEBOARD_SLOT.production.angleDeg, WHITEBOARD_SLOT.production.at));
  PRODUCTION_PROPS.plants.forEach((p, i) => plant(corner(k, p.angleDeg, p.at), p.size, 21 + i));
}

function globe(k: Kit) {
  k.cyl("walnut", [0, 0.02, 0], GLOBE.base, 0.04);
  k.cyl("alu", [0, 0.42, 0], 0.035, 0.8);
  k.add("sphere", "fabric", [0, 1.08, 0], [GLOBE.sphere, GLOBE.sphere, GLOBE.sphere], { color: "#3d7fb8" });
  // Continents: a few flattened patches on the sphere, and the brass meridian.
  k.add("ico", "fabric", [0.13, 1.16, 0.2], [0.2, 0.22, 0.1], { yaw: 0.6, color: "#6fa864" });
  k.add("ico", "fabric", [-0.18, 1.0, 0.17], [0.16, 0.2, 0.1], { yaw: -0.8, color: "#6fa864" });
  k.add("cyl", "accent", [0, 1.08, 0], [0.62, 0.02, 0.62], { rx: Math.PI / 2 });
}

function pinboard(k: Kit) {
  for (const x of [-0.85, 0.85]) {
    k.box("alu", [x, 0.85, 0], [0.04, 1.7, 0.04]);
    k.box("alu", [x, 0.02, 0], [0.06, 0.04, 0.5]);
  }
  k.box("walnut", [0, 1.12, -0.005], [1.66, 0.96, 0.03]);
  k.box("fabric", [0, 1.12, 0.012], [1.56, 0.86, 0.01], { color: "#c39263" });
  const notes = ["#fff3a8", "#ffd1dc", "#c8f0ff", "#d7f5c4", "#ffffff", "#fff3a8", "#ffe0b3"];
  notes.forEach((c, i) => {
    const x = -0.6 + (i % 4) * 0.4 + (i > 3 ? 0.2 : 0);
    const y = 1.34 - Math.floor(i / 4) * 0.4;
    k.box("book", [x, y, 0.02], [0.2, 0.16, 0.004], { color: c, rz: ((i * 37) % 7 - 3) * 0.03 });
  });
  // Red string between a few notes.
  k.box("book", [-0.2, 1.2, 0.024], [0.62, 0.008, 0.003], { color: "#d9364a", rz: 0.5 });
  k.box("book", [0.3, 1.22, 0.024], [0.5, 0.008, 0.003], { color: "#d9364a", rz: -0.35 });
}

function readingTable(k: Kit) {
  const t = READING_TABLE;
  k.rbox("walnut", [0, DESK_H - 0.03, 0], [t.w, 0.06, t.d]);
  for (const x of [-t.w / 2 + 0.28, t.w / 2 - 0.28]) {
    k.box("walnut", [x, (DESK_H - 0.06) / 2, 0], [0.08, DESK_H - 0.06, t.d - 0.3]);
    k.box("walnut", [x, 0.03, 0], [0.12, 0.06, t.d - 0.2]);
  }
  k.box("walnut", [0, 0.2, 0], [t.w - 0.6, 0.06, 0.06]);
  // Two green banker's lamps down the middle, open books at every place, a stack in the centre.
  for (const x of [-0.45, 0.45]) {
    k.cyl("alu", [x, DESK_H + 0.01, 0], 0.14, 0.02);
    k.cyl("alu", [x, DESK_H + 0.12, 0], 0.02, 0.22);
    k.rbox("fabric", [x, DESK_H + 0.25, 0], [0.34, 0.08, 0.14], { color: "#2f6b45" });
    k.box("lampGlow", [x, DESK_H + 0.205, 0], [0.3, 0.004, 0.1]);
  }
  for (const p of RESEARCH_FOOTPRINT.seats) {
    const z = Math.sign(p.z) * 0.3;
    k.box("book", [p.x - 0.1, DESK_H + 0.012, z], [0.2, 0.014, 0.28], { color: "#efe7da", yaw: 0.05 });
    k.box("book", [p.x + 0.1, DESK_H + 0.012, z], [0.2, 0.014, 0.28], { color: "#f6f0e4", yaw: -0.05 });
  }
  ["#3f6f8f", "#d9644a", "#e4b04a"].forEach((c, i) => k.box("book", [0, DESK_H + 0.03 + i * 0.045, 0.02], [0.26, 0.04, 0.19], { color: c, yaw: i * 0.3 }));
}

function researchRoom(k: Kit, s: Space, occ: RoomOccupancy) {
  k.box("rugLounge", [0, 0.006, 0], [4.2, 0.012, 3.4]);
  readingTable(k);
  for (let seat = 0; seat < s.seats; seat++) {
    const l = seatLocal("research", seat);
    // Seats on the -z side look +z: their chairs go toward -z, and vice versa.
    const back = l.z < 0 ? -1 : 1;
    const id = `${s.id}#${seat}`;
    if (!occ.seats.has(seat)) chair(k.frame(l.x, l.z + back * 0.1, l.yaw), { id, pushable: true });
    else if (occ.away?.has(seat)) chair(k.frame(l.x, l.z + back * (SEATED_CHAIR_BACK + AWAY_CHAIR_ROLLBACK), l.yaw + AWAY_CHAIR_SWIVEL), { id, pushable: true });
    else chair(k.frame(l.x, l.z + back * SEATED_CHAIR_BACK, l.yaw), { id, pushable: false });
  }
  researchShelfFrames().forEach((f, i) => bookshelf(k.frame(f.x, f.z, f.yaw), 5 + i, RESEARCH_SHELF_TALL));
  pinboard(corner(k, RESEARCH_PROPS.pinboard.angleDeg, RESEARCH_PROPS.pinboard.at));
  globe(corner(k, RESEARCH_PROPS.globe.angleDeg, RESEARCH_PROPS.globe.at));
  whiteboard(corner(k, WHITEBOARD_SLOT.research.angleDeg, WHITEBOARD_SLOT.research.at));
  RESEARCH_PROPS.plants.forEach((p, i) => plant(corner(k, p.angleDeg, p.at), p.size, 31 + i));
}

/** Every piece of furniture in one space, in world coordinates. */
export function furnishSpace(kit: Kit, s: Space, occ: RoomOccupancy) {
  const k = kit.frame(s.x, s.z);
  const seed = Math.abs(s.q * 7 + s.r * 13);
  switch (s.kind) {
    case "pod":
      return podRoom(k, s, occ, seed);
    case "office":
      return officeRoom(k, s, occ);
    case "meeting":
      return meetingRoom(k, s, occ);
    case "myoffice":
      return myOfficeRoom(k, s);
    case "production":
      return productionRoom(k, s, occ);
    case "research":
      return researchRoom(k, s, occ);
    default:
      return loungeRoom(k, s, occ);
  }
}

// ---------- walls ----------

const DOOR_W = 1.8;
const WALL_H = 1.15;

/** One run of partition: a solid base panel, frosted glass above, and an aluminium top rail. */
function partition(kit: Kit, a: { x: number; z: number }, b: { x: number; z: number }) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.05) return;
  const k = kit.frame((a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2);
  k.box("wallBase", [0, 0.24, 0], [len, 0.48, 0.1]);
  k.box("glass", [0, 0.48 + (WALL_H - 0.48) / 2, 0], [len, WALL_H - 0.48, 0.03]);
  k.box("alu", [0, WALL_H, 0], [len, 0.04, 0.07]);
  k.box("alu", [0, 0.49, 0], [len, 0.025, 0.06]);
}

function post(kit: Kit, p: { x: number; z: number }, h = WALL_H + 0.04) {
  kit.box("alu", [p.x, h / 2, p.z], [0.09, h, 0.09]);
}

/**
 * The room on the other side of wall `dir` of `s` and whether that wall has a doorway: shared walls
 * get one unless either side hangs a screen on it (shared wallIsOpen); outer walls never do.
 * Shared by the kit walls and the walk-mode solids so both always agree.
 */
export function wallSide(spaces: readonly Space[], s: Space, dir: number): { neighbor?: Space; open: boolean } {
  const [dq, dr] = AXIAL_DIRS[dir]!;
  const neighbor = spaces.find((o) => o.q === s.q + dq && o.r === s.r + dr);
  return { neighbor, open: neighbor !== undefined && wallIsOpen(s, neighbor) };
}

/**
 * Walls of the honeycomb. Every wall shared by two rooms has a doorway in the middle unless it carries
 * a screen; outer walls are solid. Shared walls are built once.
 */
export function buildWalls(kit: Kit, spaces: Space[]) {
  const postsDone = new Set<string>();
  const addPost = (p: { x: number; z: number }) => {
    const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    if (postsDone.has(key)) return;
    postsDone.add(key);
    post(kit, p);
  };
  for (const s of spaces) {
    AXIAL_DIRS.forEach(([dq, dr], dir) => {
      const nq = s.q + dq;
      const nr = s.r + dr;
      const { neighbor, open } = wallSide(spaces, s, dir);
      // Build a shared wall from the room with the smaller (q, r) only.
      if (neighbor && (nq < s.q || (nq === s.q && nr < s.r))) return;
      const n = DOOR_ANGLES[dir]!;
      const c1 = { x: s.x + HEX_R * Math.cos(n - 30 * DEG), z: s.z + HEX_R * Math.sin(n - 30 * DEG) };
      const c2 = { x: s.x + HEX_R * Math.cos(n + 30 * DEG), z: s.z + HEX_R * Math.sin(n + 30 * DEG) };
      addPost(c1);
      addPost(c2);
      if (!open) {
        partition(kit, c1, c2);
        return;
      }
      const ux = (c2.x - c1.x) / HEX_R;
      const uz = (c2.z - c1.z) / HEX_R;
      const g1 = { x: c1.x + ux * (HEX_R - DOOR_W) / 2, z: c1.z + uz * (HEX_R - DOOR_W) / 2 };
      const g2 = { x: c2.x - ux * (HEX_R - DOOR_W) / 2, z: c2.z - uz * (HEX_R - DOOR_W) / 2 };
      partition(kit, c1, g1);
      partition(kit, g2, c2);
      // Door jambs a little taller than the partition, and a lintel-free opening.
      post(kit, g1, WALL_H + 0.25);
      post(kit, g2, WALL_H + 0.25);
    });
  }
}
