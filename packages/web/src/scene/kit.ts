import {
  AXIAL_DIRS,
  DOOR_ANGLES,
  HEX_R,
  seatLocal,
  yawToward,
  managerHome,
  loungeSpots,
  type Space,
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
  | "accent";

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

/** Whiteboard corner slot per room kind (meeting rooms put the TV at 240, so the board goes to 180). */
export const WHITEBOARD_SLOT = { pod: { angleDeg: 240, at: 4.4 }, meeting: { angleDeg: 180, at: 4.4 } } as const;
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
}

/** Every piece of furniture in one space, in world coordinates. */
export function furnishSpace(kit: Kit, s: Space, occ: RoomOccupancy) {
  const k = kit.frame(s.x, s.z);
  const seed = Math.abs(s.q * 7 + s.r * 13);
  if (s.kind === "pod") podRoom(k, s, occ, seed);
  else if (s.kind === "office") officeRoom(k, s, occ);
  else if (s.kind === "meeting") meetingRoom(k, s, occ);
  else loungeRoom(k, s, occ);
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
 * Walls of the honeycomb. Every wall shared by two rooms has a doorway in the middle; outer walls are
 * solid. Shared walls are built once.
 */
export function buildWalls(kit: Kit, spaces: Space[]) {
  const has = (q: number, r: number) => spaces.some((s) => s.q === q && s.r === r);
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
      const shared = has(nq, nr);
      // Build a shared wall from the room with the smaller (q, r) only.
      if (shared && (nq < s.q || (nq === s.q && nr < s.r))) return;
      const n = DOOR_ANGLES[dir]!;
      const c1 = { x: s.x + HEX_R * Math.cos(n - 30 * DEG), z: s.z + HEX_R * Math.sin(n - 30 * DEG) };
      const c2 = { x: s.x + HEX_R * Math.cos(n + 30 * DEG), z: s.z + HEX_R * Math.sin(n + 30 * DEG) };
      addPost(c1);
      addPost(c2);
      if (!shared) {
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
