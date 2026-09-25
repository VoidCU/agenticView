import {
  AXIAL_DIRS,
  DOOR_ANGLES,
  HEX_R,
  seatLocal,
  yawToward,
  managerHome,
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

export class Kit {
  constructor(
    readonly items: Item[] = [],
    private readonly f: Frame = { x: 0, y: 0, z: 0, yaw: 0 },
  ) {}

  /** Map a local x/z to world using three's Y-rotation convention (local +z faces (sin yaw, cos yaw)). */
  private pt(x: number, z: number) {
    const c = Math.cos(this.f.yaw);
    const s = Math.sin(this.f.yaw);
    return { x: this.f.x + x * c + z * s, z: this.f.z - x * s + z * c };
  }

  frame(x: number, z: number, yaw = 0, y = 0): Kit {
    const p = this.pt(x, z);
    return new Kit(this.items, { x: p.x, z: p.z, y: this.f.y + y, yaw: this.f.yaw + yaw });
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

// ---------- furniture (all built in a local frame: +z is "front") ----------

const DEG = Math.PI / 180;
const DESK_H = 0.74;

function hashColor(list: string[], n: number): string {
  return list[Math.abs(Math.floor(n)) % list.length]!;
}

/** A desk whose front (+z) faces the person sitting at it. */
export function desk(k: Kit, screen?: string, seed = 0) {
  k.rbox("deskTop", [0, DESK_H - 0.025, 0], [1.24, 0.05, 0.66]);
  for (const x of [-0.57, 0.57]) k.box("deskLeg", [x, (DESK_H - 0.05) / 2, 0], [0.05, DESK_H - 0.05, 0.58]);
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
export function chair(k: Kit) {
  k.rbox("chair", [0, 0.47, 0], [0.5, 0.08, 0.48]);
  k.rbox("chair", [0, 0.82, -0.25], [0.46, 0.52, 0.07], { rx: -0.1 });
  k.cyl("chairBase", [0, 0.27, 0], 0.06, 0.38);
  k.cyl("chairBase", [0, 0.05, 0], 0.56, 0.04);
  for (const x of [-0.26, 0.26]) k.box("chairBase", [x, 0.6, -0.02], [0.04, 0.03, 0.3]);
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
  const w = 1.3;
  const d = 0.36;
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
  k.rbox("shelf", [0, 0.34, 0], [1.6, 0.62, 0.46]);
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
  k.box("whiteboard", [0, 1.12, 0.012], [1.6, 0.9, 0.01]);
  // Sticky notes and a scribble strip.
  const notes = ["#ffd166", "#ff9fb4", "#9be3c3", "#9cc7ff", "#ffd166"];
  notes.forEach((c, i) => k.box("book", [-0.55 + (i % 3) * 0.2, 1.36 - Math.floor(i / 3) * 0.2, 0.02], [0.14, 0.14, 0.004], { color: c }));
  k.box("book", [0.3, 1.3, 0.02], [0.6, 0.02, 0.003], { color: "#3f6f8f" });
  k.box("book", [0.25, 1.2, 0.02], [0.5, 0.02, 0.003], { color: "#3f6f8f" });
  k.box("book", [0.35, 1.1, 0.02], [0.7, 0.02, 0.003], { color: "#d9644a" });
}

export function floorLamp(k: Kit) {
  k.cyl("chairBase", [0, 0.02, 0], 0.34, 0.04);
  k.cyl("alu", [0, 0.8, 0], 0.035, 1.56);
  k.add("cone", "lampGlow", [0, 1.62, 0], [0.46, 0.3, 0.46]);
}

export function sofa(k: Kit, mat: "sofa" | "sofa2" = "sofa", width = 1.9) {
  k.rbox(mat, [0, 0.24, 0], [width, 0.3, 0.86]);
  k.rbox(mat, [0, 0.6, -0.33], [width, 0.56, 0.22]);
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) k.rbox(mat, [x, 0.44, 0], [0.2, 0.36, 0.86]);
  const seats = width > 1.5 ? [-width / 4 + 0.05, width / 4 - 0.05] : [0];
  for (const x of seats) k.rbox(mat, [x, 0.44, 0.06], [width / seats.length - 0.28, 0.12, 0.62]);
  k.rbox("cushion", [-width / 2 + 0.38, 0.68, -0.14], [0.36, 0.34, 0.12], { rx: -0.25, yaw: 0.2 });
  for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) for (const z of [-0.34, 0.34]) k.cyl("deskLeg", [x, 0.04, z], 0.05, 0.08);
}

export function armchair(k: Kit, mat: "sofa" | "sofa2" = "sofa2") {
  sofa(k, mat, 0.95);
}

/** Coffee point: counter, machine, mugs. */
export function kitchenette(k: Kit) {
  k.rbox("deskTop", [0, 0.46, 0], [1.9, 0.9, 0.62]);
  k.box("walnut", [0, 0.92, 0], [1.94, 0.04, 0.66]);
  k.rbox("bezel", [-0.5, 1.13, -0.05], [0.34, 0.38, 0.3]);
  k.box("lampGlow", [-0.5, 1.2, 0.101], [0.08, 0.04, 0.004]);
  for (let i = 0; i < 3; i++) k.cyl("pot", [0.1 + i * 0.16, 0.99, 0.12], 0.08, 0.1, { color: ["#ffffff", "#e4b04a", "#3f6f8f"][i] });
  k.cyl("pot", [0.65, 1.05, -0.05], 0.22, 0.22);
  k.add("ico", "leaf2", [0.65, 1.28, -0.05], [0.3, 0.32, 0.3]);
}

/** A standing TV for the meeting room. */
export function tvStand(k: Kit) {
  for (const x of [-0.7, 0.7]) {
    k.box("deskLeg", [x, 0.7, 0], [0.05, 1.4, 0.05]);
    k.box("deskLeg", [x, 0.02, 0], [0.08, 0.04, 0.6]);
  }
  k.box("bezel", [0, 1.35, 0], [1.9, 1.1, 0.06]);
  k.box("screen", [0, 1.35, 0.032], [1.8, 1.0, 0.004], { color: "#2d5fd1" });
  // Slide content: a title bar and three bars of a chart.
  k.box("lampGlow", [-0.45, 1.7, 0.036], [0.7, 0.07, 0.003]);
  [0.25, 0.45, 0.62].forEach((h, i) => k.box("accent", [0.2 + i * 0.22, 0.98 + h / 2, 0.036], [0.14, h, 0.003]));
}

// ---------- rooms ----------

/** Corner slots: vertex directions k*60deg, 4.6 from the center, facing in. */
function corner(k: Kit, angleDeg: number, at = 4.55): Kit {
  const dist = (at * HEX_R) / 6;
  const a = angleDeg * DEG;
  const x = dist * Math.cos(a);
  const z = dist * Math.sin(a);
  return k.frame(x, z, yawToward({ x, z }, { x: 0, z: 0 }));
}

export interface RoomOccupancy {
  /** seat -> screen/tint colour for an occupied seat. */
  seats: Map<number, string>;
}

function podRoom(k: Kit, s: Space, occ: RoomOccupancy, seed: number) {
  for (let seat = 0; seat < s.seats; seat++) {
    const l = seatLocal("pod", seat);
    const dz = l.z < 0 ? -0.36 : 0.36;
    desk(k.frame(l.x, dz, l.z < 0 ? Math.PI : 0), occ.seats.get(seat), seed + seat);
    if (!occ.seats.has(seat)) chair(k.frame(l.x, l.z + (l.z < 0 ? -0.1 : 0.1), l.yaw));
  }
  // Felt privacy screen along the spine of the cluster, with an aluminium cap.
  k.rbox("felt", [0, DESK_H + 0.2, 0], [2.5, 0.4, 0.05]);
  k.box("alu", [0, DESK_H + 0.405, 0], [2.5, 0.015, 0.06]);
  k.box("deskLeg", [0, 0.36, 0], [0.06, 0.72, 0.06]);
  // Corners: tall pieces at the back (away from the camera), low ones at the front.
  bookshelf(corner(k, 180), seed);
  whiteboard(corner(k, 240, 4.4));
  credenza(corner(k, 300), seed);
  plant(corner(k, 0, 4.7), 1.1, seed);
  plant(corner(k, 120, 4.7), 0.9, seed + 1);
  credenza(corner(k, 60, 4.7), seed + 1);
}

function officeRoom(k: Kit, s: Space) {
  const home = managerHome({ ...s, x: 0, z: 0 });
  // Rug, then the executive desk between the manager and the room.
  k.cyl("rugOffice", [0, 0.006, 0], 4.3, 0.012);
  k.cyl("accent", [0, 0.004, 0], 4.38, 0.008);
  const toCam = { x: Math.cos(45 * DEG), z: Math.sin(45 * DEG) };
  const deskAt = { x: home.x + toCam.x * 0.78, z: home.z + toCam.z * 0.78 };
  const dk = k.frame(deskAt.x, deskAt.z, yawToward(deskAt, home));
  dk.rbox("walnut", [0, 0.75, 0], [2.1, 0.07, 0.95]);
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
  for (const side of [-0.62, 0.62]) {
    const p = { x: front.x + side * toCam.z, z: front.z - side * toCam.x };
    chair(k.frame(p.x, p.z, yawToward(p, home)));
  }
  bookshelf(corner(k, 180, 4.5), 3, 1.9);
  bookshelf(corner(k, 240, 4.5), 5, 1.9);
  credenza(corner(k, 300), 2);
  armchair(corner(k, 0, 4.4));
  plant(corner(k, 60, 4.8), 1.25, 2);
  plant(corner(k, 120, 4.7), 1.0, 5);
}

function meetingRoom(k: Kit, s: Space, occ: RoomOccupancy) {
  k.cyl("walnut", [0, 0.74, 0], 2.5, 0.07);
  k.cyl("deskLeg", [0, 0.37, 0], 0.3, 0.7);
  k.cyl("deskLeg", [0, 0.02, 0], 1.0, 0.04);
  for (let i = 0; i < 3; i++) k.box("book", [Math.cos(i * 2.1) * 0.5, 0.79, Math.sin(i * 2.1) * 0.5], [0.22, 0.01, 0.3], { yaw: i, color: "#efe7da" });
  k.cyl("pot", [0, 0.86, 0], 0.18, 0.18);
  k.add("ico", "leaf2", [0, 1.02, 0], [0.26, 0.24, 0.26]);
  for (let seat = 0; seat < s.seats; seat++) {
    if (occ.seats.has(seat)) continue;
    const l = seatLocal("meeting", seat);
    const back = Math.hypot(l.x, l.z) + 0.12;
    const a = Math.atan2(l.z, l.x);
    chair(k.frame(back * Math.cos(a), back * Math.sin(a), l.yaw));
  }
  tvStand(corner(k, 240, 4.5));
  whiteboard(corner(k, 180, 4.4));
  credenza(corner(k, 300), 4);
  plant(corner(k, 0, 4.7), 1.1, 3);
  plant(corner(k, 60, 4.8), 0.8, 4);
  plant(corner(k, 120, 4.7), 1.2, 6);
}

function loungeRoom(k: Kit, s: Space, occ: RoomOccupancy) {
  k.cyl("rugLounge", [0, 0.006, 0], 3.9, 0.012);
  k.cyl("rugLounge2", [0, 0.01, 0], 3.0, 0.012);
  k.cyl("rugLounge", [0, 0.014, 0], 2.7, 0.012);
  k.cyl("walnut", [0, 0.38, 0], 1.1, 0.05);
  k.cyl("deskLeg", [0, 0.19, 0], 0.12, 0.36);
  k.cyl("pot", [0.15, 0.46, 0.1], 0.1, 0.12, { color: "#e4b04a" });
  k.box("book", [-0.2, 0.42, -0.1], [0.3, 0.03, 0.22], { yaw: 0.4, color: "#3f6f8f" });
  for (let seat = 0; seat < s.seats; seat++) {
    if (occ.seats.has(seat)) continue;
    const l = seatLocal("lounge", seat);
    k.frame(l.x, l.z, l.yaw).rbox(seat % 2 ? "sofa2" : "sofa", [0, 0.2, 0], [0.62, 0.4, 0.62]);
  }
  sofa(corner(k, 180, 4.5), "sofa");
  kitchenette(corner(k, 240, 4.6));
  sofa(corner(k, 300, 4.5), "sofa2");
  floorLamp(corner(k, 120, 4.6));
  plant(corner(k, 0, 4.7), 1.2, 7);
  armchair(corner(k, 60, 4.5), "sofa");
}

/** Every piece of furniture in one space, in world coordinates. */
export function furnishSpace(kit: Kit, s: Space, occ: RoomOccupancy) {
  const k = kit.frame(s.x, s.z);
  const seed = Math.abs(s.q * 7 + s.r * 13);
  if (s.kind === "pod") podRoom(k, s, occ, seed);
  else if (s.kind === "office") officeRoom(k, s);
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
