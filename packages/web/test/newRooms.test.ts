/**
 * Round 12 scene: My Office, Production Room, Research Room, screen walls without doorways, and live
 * re-layout (the server sends a new OfficeLayout: walls, furniture and colliders rebuild for it).
 */
import { describe, expect, it } from "vitest";
import {
  AXIAL_DIRS,
  DOOR_ANGLES,
  HEX_APOTHEM,
  HEX_R,
  PRODUCTION_SCREEN,
  WALL_SCREEN,
  applyLayoutMoves,
  defaultLayout,
  doorPoint,
  route,
  spaceAt,
  userHome,
  validateLayout,
  wallIsOpen,
  type OfficeLayout as FloorPlan,
  type Space,
  type Task,
} from "@agenticview/shared";
import { Kit, buildWalls, furnishSpace, hasWhiteboard, myOfficeChairFrame, type Item } from "../src/scene/kit";
import { SEATED_LIFT, layoutFor, planSignature, youHome } from "../src/scene/layout";
import { buildColliders, overlapsAny } from "../src/scene/colliders";
import { solidsForLayout, type SolidBox } from "../src/scene/solids";
import { monitorPoseForSeat } from "../src/scene/DeskMonitor";
import { whiteboardPose } from "../src/scene/Whiteboard";
import { loungeDoorAngle } from "../src/scene/targets";
import { viewOrder } from "../src/scene/roomKeys";
import { walkInteraction } from "../src/scene/WalkMode";
import * as THREE from "three";
import {
  PRODUCTION_SLATE,
  createWallScreenMesh,
  SOCIAL_CONNECT_HINT,
  SOCIAL_EMPTY,
  SOCIAL_TITLE,
  drawProduction,
  drawSocialHub,
  productionTask,
  wallScreenPose,
  wrapLines,
} from "../src/scene/WallScreens";
import { agent, manager, task } from "./fixtures";

function workers(n: number) {
  return Array.from({ length: n }, (_, i) => agent({ id: `w${String(i).padStart(2, "0")}`, name: `W${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
}

/** My Office and Production swapped next to the lounge so both screen walls are shared with it. */
function swappedPlan(): FloorPlan {
  const plan = applyLayoutMoves(defaultLayout(0), [
    { space: "myoffice", toHex: { q: 1, r: 0 } },
    { space: "production", toHex: { q: 0, r: 1 } },
  ]);
  const ok = validateLayout(plan);
  expect(ok).toEqual({ ok: true });
  return plan;
}

function kitOf(spaces: Space[]) {
  const kit = new Kit();
  buildWalls(kit, spaces);
  for (const s of spaces) furnishSpace(kit, s, { seats: new Map([[0, "#ff8800"], [1, "#00aaff"]]) });
  return kit;
}

const byKind = (spaces: Space[], kind: Space["kind"]) => spaces.find((s) => s.kind === kind)!;
const inRoom = (s: Space, it: { x: number; z: number }) => Math.hypot(it.x - s.x, it.z - s.z) < HEX_R;

describe("default plan: the three new rooms are furnished", () => {
  const layout = layoutFor([manager, ...workers(3)]);
  const kit = kitOf(layout.spaces);
  const solids = solidsForLayout(layout);

  it("has My Office, Production and Research next to the manager's office", () => {
    for (const k of ["myoffice", "production", "research"] as const) expect(layout.spaces.some((s) => s.kind === k)).toBe(true);
    // The manager's office is no longer at the origin: its manager pose follows it.
    const office = byKind(layout.spaces, "office");
    expect(Math.hypot(office.x, office.z)).toBeGreaterThan(1);
    expect(inRoom(office, layout.poses[manager.id]!)).toBe(true);
    expect(layout.poses[manager.id]!.space).toBe(office.id);
  });

  it("My Office: executive desk, a big wall screen on WALL_SCREEN, couch corner, no worker seats or whiteboard", () => {
    const mine = byKind(layout.spaces, "myoffice");
    expect(mine.seats).toBe(0);
    expect(hasWhiteboard("myoffice")).toBe(false);
    const screens = kit.items.filter((it) => it.mat === "screen" && inRoom(mine, it) && Math.abs(it.sx - WALL_SCREEN.width) < 1e-9);
    expect(screens).toHaveLength(1);
    expect(screens[0]!.y).toBeCloseTo(WALL_SCREEN.y, 6);
    const kinds = solids.filter((s) => inRoom(mine, s)).map((s) => s.kind);
    for (const k of ["desk", "chair", "sofa", "plant", "table"]) expect(kinds).toContain(k);
    expect(kinds).not.toContain("whiteboard");
  });

  it("Production: two edit desks with monitors, a big screen on PRODUCTION_SCREEN, a tripod camera and a whiteboard", () => {
    const prod = byKind(layout.spaces, "production");
    const room = solids.filter((s) => inRoom(prod, s));
    expect(room.filter((s) => s.kind === "desk")).toHaveLength(2);
    expect(room.some((s) => s.kind === "tripod")).toBe(true);
    expect(room.some((s) => s.kind === "whiteboard")).toBe(true);
    const big = kit.items.filter((it) => it.mat === "screen" && inRoom(prod, it) && Math.abs(it.sx - PRODUCTION_SCREEN.width) < 1e-9);
    expect(big).toHaveLength(1);
  });

  it("Research: a long reading table, 4 seats, bookshelves round the west corner, pinboard, globe and whiteboard", () => {
    const res = byKind(layout.spaces, "research");
    expect(res.seats).toBe(4);
    const room = solids.filter((s) => inRoom(res, s));
    const table = room.find((s): s is SolidBox => s.kind === "table" && "w" in s)!;
    expect(table.w).toBeCloseTo(2.8, 6);
    const shelves = room.filter((s) => s.kind === "shelf");
    expect(shelves.length).toBeGreaterThanOrEqual(3);
    // Shelves live in the 150..210 degree sector (west).
    for (const s of shelves) {
      const a = (Math.atan2(s.z - res.z, s.x - res.x) * 180) / Math.PI;
      expect(Math.abs(a)).toBeGreaterThanOrEqual(130);
    }
    expect(room.some((s) => s.kind === "globe")).toBe(true);
    expect(room.filter((s) => s.kind === "whiteboard")).toHaveLength(2); // pinboard + whiteboard
  });

  it("whiteboard overlays mirror the kit boards in production and research", () => {
    for (const kind of ["production", "research"] as const) {
      const s = byKind(layout.spaces, kind);
      const pose = whiteboardPose(s);
      const boards = kit.items.filter((it) => it.mat === "whiteboard" && inRoom(s, it));
      expect(boards).toHaveLength(1);
      const b = boards[0]!;
      expect(Math.hypot(b.x - pose.x, b.z - pose.z)).toBeLessThan(0.05);
      expect(b.yaw).toBeCloseTo(pose.yaw, 6);
    }
  });

  it("production desk monitors land on the kit's edit-desk screens", () => {
    const prod = byKind(layout.spaces, "production");
    for (const seat of [0, 1]) {
      const pose = monitorPoseForSeat(prod.x, prod.z, seat, "production")!;
      const hit = kit.items.find((it) => it.mat === "screen" && Math.abs(it.sx - 0.61) < 1e-9 && Math.hypot(it.x - pose.position[0], it.z - pose.position[2]) < 1e-6);
      expect(hit, `seat ${seat}`).toBeDefined();
      expect(hit!.y).toBeCloseTo(pose.position[1], 6);
    }
    expect(monitorPoseForSeat(prod.x, prod.z, 2, "production")).toBeNull();
    expect(monitorPoseForSeat(0, 0, 0, "research")).toBeNull();
  });

  it("wall-screen overlays sit 2-4 mm in front of the kit screen face, same yaw", () => {
    for (const kind of ["myoffice", "production"] as const) {
      const s = byKind(layout.spaces, kind);
      const pose = wallScreenPose(s)!;
      const scr = kit.items.find((it) => it.mat === "screen" && inRoom(s, it) && Math.abs(it.sx - pose.width) < 1e-9)!;
      expect(scr.yaw).toBeCloseTo(pose.yaw, 9);
      const front = { x: scr.x + Math.sin(scr.yaw) * (scr.sz / 2), z: scr.z + Math.cos(scr.yaw) * (scr.sz / 2) };
      const along = (pose.x - front.x) * Math.sin(pose.yaw) + (pose.z - front.z) * Math.cos(pose.yaw);
      expect(along).toBeGreaterThanOrEqual(0.002 - 1e-9);
      expect(along).toBeLessThanOrEqual(0.004 + 1e-9);
      expect(pose.y).toBeCloseTo(scr.y, 9);
    }
    expect(wallScreenPose(byKind(layout.spaces, "research"))).toBeUndefined();
  });

  it("'You' sits in My Office's desk chair, facing the wall screen", () => {
    const mine = byKind(layout.spaces, "myoffice");
    const home = youHome(byKind(layout.spaces, "office"), mine);
    expect(home).toMatchObject({ ...userHome(mine), yOffset: SEATED_LIFT });
    // The chair is drawn right behind that seat.
    const ch = myOfficeChairFrame();
    expect(Math.hypot(mine.x + ch.x - home.x, mine.z + ch.z - home.z)).toBeCloseTo(0.25, 6);
    // Looking at the wall screen.
    const toScreen = Math.atan2(mine.x + WALL_SCREEN.x - home.x, mine.z + WALL_SCREEN.z - home.z);
    expect(home.yaw).toBeCloseTo(toScreen, 6);
    // No My Office: the old spot in front of the manager.
    const office = byKind(layout.spaces, "office");
    expect(inRoom(office, youHome(office))).toBe(true);
  });

  it("room shortcuts reach the new rooms after the classic ones", () => {
    const order = viewOrder(layout.spaces);
    expect(order[0]).toBe("office");
    expect(order.slice(-3)).toEqual(["myoffice", "production", "research"]);
  });
});

describe("screen walls never get a doorway (wallIsOpen)", () => {
  const layout = layoutFor([manager], undefined, swappedPlan());
  const spaces = layout.spaces;
  const lounge = byKind(spaces, "lounge");
  const mine = byKind(spaces, "myoffice");
  const prod = byKind(spaces, "production");
  const colliders = buildColliders(layout, { excludeKinds: ["chair"] });
  const walls = solidsForLayout(layout).filter((s): s is SolidBox => s.kind === "wall");
  const kit = kitOf(spaces);

  const dirTo = (a: Space, b: Space) => AXIAL_DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);

  it("the plan really puts both screen walls against the lounge", () => {
    expect(dirTo(mine, lounge)).toBe(WALL_SCREEN.dir);
    expect(dirTo(prod, lounge)).toBe(PRODUCTION_SCREEN.dir);
    expect(wallIsOpen(mine, lounge)).toBe(false);
    expect(wallIsOpen(prod, lounge)).toBe(false);
  });

  it("colliders: a screen wall is one full-length wall with no gap; open walls keep the doorway", () => {
    for (const room of [mine, prod]) {
      const dir = dirTo(room, lounge);
      const door = doorPoint(room, dir);
      expect(walls.some((w) => Math.abs(w.w - HEX_R) < 1e-6 && Math.hypot(w.x - door.x, w.z - door.z) < 1e-6)).toBe(true);
      expect(overlapsAny(colliders, door.x, door.z, 0.1)).toBe(true);
    }
    // An open wall of the lounge (toward the meeting room) still has its doorway.
    const meeting = byKind(spaces, "meeting");
    const d = doorPoint(lounge, dirTo(lounge, meeting));
    expect(overlapsAny(colliders, d.x, d.z, 0.25)).toBe(false);
  });

  it("kit: the screen wall is drawn as one solid partition, no door jambs", () => {
    for (const room of [mine, prod]) {
      const door = doorPoint(room, dirTo(room, lounge));
      const glass = kit.items.filter((it) => it.mat === "glass" && Math.hypot(it.x - door.x, it.z - door.z) < 1e-6);
      expect(glass).toHaveLength(1);
      expect(glass[0]!.sx).toBeCloseTo(HEX_R, 6);
      // Door jambs are the 1.44-high posts either side of a gap.
      const jambs = kit.items.filter((it) => it.mat === "alu" && Math.abs(it.sy - 1.44) < 1e-6 && Math.hypot(it.x - door.x, it.z - door.z) < 1.0);
      expect(jambs).toHaveLength(0);
    }
  });

  it("routes go round a screen wall, through real doorways only", () => {
    const pts = route(spaces, { x: lounge.x + 0.5, z: lounge.z + 0.5 }, { x: mine.x + 0.5, z: mine.z + 0.5 });
    const closed = doorPoint(mine, dirTo(mine, lounge));
    for (const p of pts) expect(Math.hypot(p.x - closed.x, p.z - closed.z)).toBeGreaterThan(0.5);
    expect(pts.length).toBeGreaterThan(4);
  });
});

describe("live re-layout", () => {
  const roster = [manager, ...workers(7)];
  const before = layoutFor(roster);
  const plan = applyLayoutMoves(defaultLayout(roster.length - 1), [
    { space: "myoffice", toHex: { q: 1, r: 0 } }, // swaps with pod-a
    { space: "research", toHex: { q: 0, r: -1 } }, // swaps with the meeting room
  ]);
  const after = layoutFor(roster, undefined, plan);

  it("same room ids, new hexes: the plan signature changes so the scene rebuilds", () => {
    expect(before.spaces.map((s) => s.id).sort()).toEqual(after.spaces.map((s) => s.id).sort());
    expect(planSignature(after.spaces)).not.toBe(planSignature(before.spaces));
    expect(planSignature(layoutFor(roster, undefined, plan).spaces)).toBe(planSignature(after.spaces));
  });

  it("workers keep their seats and walk to where those seats are now", () => {
    const podBefore = before.spaces.find((s) => s.id === "pod-a")!;
    const podAfter = after.spaces.find((s) => s.id === "pod-a")!;
    expect(podAfter.x).not.toBeCloseTo(podBefore.x, 3);
    const w = roster[1]!.id;
    expect(after.placements[w]).toEqual(before.placements[w]);
    expect(inRoom(podAfter, after.poses[w]!)).toBe(true);
  });

  it("colliders are rebuilt from the new plan with nothing stale left behind", () => {
    const a = solidsForLayout(before);
    const b = solidsForLayout(after);
    // Deterministic: the same plan always yields the same solids.
    expect(solidsForLayout(layoutFor(roster, undefined, plan))).toEqual(b);
    // My Office's desk follows the room; nothing of it is left on its old hex (now pod-a's).
    const deskAt = (l: typeof before) => {
      const m = byKind(l.spaces, "myoffice");
      return solidsForLayout(l).filter((s) => s.kind === "desk" && inRoom(m, s));
    };
    expect(deskAt(before)).toHaveLength(1);
    expect(deskAt(after)).toHaveLength(1);
    const oldMine = byKind(before.spaces, "myoffice");
    const onOldHex = b.filter((s) => s.kind !== "wall" && spaceAt(after.spaces, s.x, s.z)?.q === oldMine.q && spaceAt(after.spaces, s.x, s.z)?.r === oldMine.r);
    expect(onOldHex.some((s) => s.kind === "sofa" || s.kind === "tripod" || s.kind === "globe")).toBe(false);
    expect(onOldHex.filter((s) => s.kind === "desk")).toHaveLength(6); // a pod now
    // Every piece of furniture sits inside some room of the new plan.
    for (const s of b) if (s.kind !== "wall") expect(spaceAt(after.spaces, s.x, s.z), `${s.kind} at ${s.x},${s.z}`).toBeDefined();
    // Same number of rooms, so the same number of wall pieces, but in new places.
    expect(a.length).toBeGreaterThan(0);
  });

  it("the lounge queue follows the doorway to the manager's office", () => {
    const lounge = byKind(after.spaces, "lounge");
    const office = byKind(after.spaces, "office");
    const dir = AXIAL_DIRS.findIndex(([dq, dr]) => lounge.q + dq === office.q && lounge.r + dr === office.r);
    expect(loungeDoorAngle(after.spaces, lounge)).toBeCloseTo(DOOR_ANGLES[dir]!, 9);
    // Office moved away from the lounge: the first open doorway instead.
    const far = layoutFor(roster, undefined, applyLayoutMoves(plan, [{ space: "office", toHex: { q: 1, r: -2 } }]));
    const l2 = byKind(far.spaces, "lounge");
    const a = loungeDoorAngle(far.spaces, l2);
    expect(DOOR_ANGLES.some((d) => Math.abs(d - a) < 1e-9)).toBe(true);
    expect(Math.hypot(Math.cos(a) * HEX_APOTHEM, Math.sin(a) * HEX_APOTHEM)).toBeCloseTo(HEX_APOTHEM, 6);
  });
});

// ---- screen painting (a recording 2D context; jsdom has no canvas) ----

function fakeCtx() {
  const texts: string[] = [];
  const noop = () => undefined;
  const ctx = new Proxy(
    {
      texts,
      fillText: (t: string) => void texts.push(t),
      measureText: (t: string) => ({ width: t.length * 20 }),
      createLinearGradient: () => ({ addColorStop: noop }),
    } as Record<string, unknown>,
    {
      get: (target, key: string) => (key in target ? target[key] : noop),
      set: () => true,
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { texts: string[] };
}

describe("wall screen content", () => {
  it("social hub: title, the connect hint and the placeholder when nothing is connected", () => {
    const ctx = fakeCtx();
    drawSocialHub(ctx, { connected: { instagram: false, meta: false }, items: [] });
    expect(ctx.texts).toContain(SOCIAL_TITLE);
    expect(ctx.texts).toContain(SOCIAL_CONNECT_HINT);
    expect(ctx.texts).toContain(SOCIAL_EMPTY);
  });

  it("social hub: feed items replace the placeholder", () => {
    const ctx = fakeCtx();
    drawSocialHub(ctx, { connected: { instagram: true, meta: false }, items: [{ id: "1", network: "instagram", text: "New post", ts: new Date().toISOString() }] });
    expect(ctx.texts).toContain("New post");
    expect(ctx.texts).not.toContain(SOCIAL_EMPTY);
  });

  it("production: the slate while idle, the running task's title while it runs", () => {
    const idle = fakeCtx();
    drawProduction(idle, "Production Room");
    expect(idle.texts).toContain(PRODUCTION_SLATE);
    const live = fakeCtx();
    drawProduction(live, "Production Room", { title: "Cut the launch trailer", who: "Ava" });
    expect(live.texts).toContain("ON AIR");
    expect(live.texts.join(" ")).toContain("Cut the launch trailer");
    expect(live.texts).not.toContain(PRODUCTION_SLATE);
  });

  it("production shows only a RUNNING task of someone seated in that room (newest first)", () => {
    const tasks: Task[] = [
      task({ id: "a", title: "Queued", status: "assigned", assigneeId: "w1" }),
      task({ id: "b", title: "Elsewhere", status: "running", assigneeId: "w9" }),
      task({ id: "c", title: "Older", status: "running", assigneeId: "w1", startedAt: "2026-01-01T00:00:00.000Z" }),
      task({ id: "d", title: "Newer", status: "running", assigneeId: "w2", startedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(productionTask(tasks, ["w1", "w2"])?.title).toBe("Newer");
    expect(productionTask(tasks, ["w1"])?.title).toBe("Older");
    expect(productionTask(tasks, ["w3"])).toBeUndefined();
    expect(productionTask(tasks, [])).toBeUndefined();
  });

  it("wraps long titles into at most N lines, ellipsising the last", () => {
    const ctx = fakeCtx();
    const lines = wrapLines(ctx, "one two three four five six seven eight nine ten", 200, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });
});

describe("wall screen is a walk-mode crosshair target", () => {
  /** Ray from 3m in front of the screen (inside the room) straight at its centre, like the walk crosshair. */
  function shoot(space: Space, objects: THREE.Object3D[]) {
    const pose = wallScreenPose(space)!;
    const n = new THREE.Vector3(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
    const origin = new THREE.Vector3(pose.x, pose.y, pose.z).addScaledVector(n, 3);
    const ray = new THREE.Raycaster(origin, n.clone().negate());
    const scene = new THREE.Scene();
    scene.add(...objects);
    scene.updateMatrixWorld(true);
    return { hits: ray.intersectObjects(scene.children, true), origin };
  }

  it("the My Office screen carries userData.wallScreenKind and is hit by a raycast", () => {
    const office = byKind(layoutFor([manager, ...workers(3)]).spaces, "myoffice");
    const mesh = createWallScreenMesh(office)!;
    expect(mesh.userData).toEqual({ wallScreenKind: "myoffice" });
    const { hits, origin } = shoot(office, [mesh]);
    expect(hits[0]?.object).toBe(mesh);
    expect(hits[0]!.distance).toBeCloseTo(3, 3);
    expect(walkInteraction(hits, origin, new THREE.Vector3(), "click")).toEqual({ kind: "settings", id: "connections" });
  });

  it("the production screen is tagged with its kind (no click action)", () => {
    const prod = byKind(layoutFor([manager, ...workers(3)]).spaces, "production");
    const mesh = createWallScreenMesh(prod)!;
    expect(mesh.userData).toEqual({ wallScreenKind: "production" });
    const { hits, origin } = shoot(prod, [mesh]);
    expect(hits[0]?.object).toBe(mesh);
    expect(walkInteraction(hits, origin, new THREE.Vector3(), "click")).toBeUndefined();
  });

  it("rooms without a wall screen get no mesh", () => {
    const lounge = byKind(layoutFor([manager, ...workers(3)]).spaces, "lounge");
    expect(createWallScreenMesh(lounge)).toBeUndefined();
  });
});
