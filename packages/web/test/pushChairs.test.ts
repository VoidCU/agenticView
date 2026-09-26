import { describe, expect, it } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { ChairField, CHAIR_HD, circleVsChair, moveChairClamped, type ChairState } from "../src/scene/pushChairs";
import { PLAYER_RADIUS, buildColliders, type Solid } from "../src/scene/colliders";
import { Kit, furnishSpace, type ChairInfo } from "../src/scene/kit";
import { layoutFor } from "../src/scene/layout";
import { isWalkable } from "../src/scene/walkPhysics";
import { manager } from "./fixtures";

const info = (id: string, pushable: boolean, x = 0, z = 0, yaw = 0): ChairInfo => ({ id, x, z, yaw, pushable, first: 0, count: 6 });
const everywhere = () => true;
const DT = 1 / 60;

function field(...chairs: ChairInfo[]) {
  const f = new ChairField();
  f.sync(chairs);
  return f;
}

/** Walk the player toward +z for n frames at 4.5 u/s, pushing chairs. */
function walkInto(f: ChairField, clear: Parameters<ChairField["interact"]>[3], start: { x: number; z: number }, frames: number) {
  const p = { ...start };
  for (let i = 0; i < frames; i++) {
    p.z += 4.5 * DT;
    f.interact(p, PLAYER_RADIUS, DT, clear, i);
  }
  return p;
}

describe("push resolution math", () => {
  it("circleVsChair returns the vector that moves the walker out of the seat footprint", () => {
    const out = { x: 0, z: 0 };
    expect(circleVsChair(0, -1, PLAYER_RADIUS, 0, 0, 0, out)).toBe(false);
    expect(circleVsChair(0, -(CHAIR_HD + PLAYER_RADIUS - 0.1), PLAYER_RADIUS, 0, 0, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(-0.1, 9);
    // Rotated chair: pushing out along its rotated face normal.
    const yaw = Math.PI / 2; // local z -> world +x
    expect(circleVsChair(CHAIR_HD + PLAYER_RADIUS - 0.05, 0, PLAYER_RADIUS, 0, 0, yaw, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.05, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });

  it("moveChairClamped takes the full move, else slides along one axis, else stays", () => {
    const c = field(info("a", true)).get("a")!;
    expect(moveChairClamped(c, 0.1, 0.2, everywhere)).toBeCloseTo(Math.hypot(0.1, 0.2));
    const wallAtX = (_: ChairState, x: number) => x < 0.15;
    expect(moveChairClamped(c, 0.1, 0.1, wallAtX)).toBeCloseTo(0.1); // z only
    expect(c.x).toBeCloseTo(0.1);
    expect(c.z).toBeCloseTo(0.3);
    const boxed = () => false;
    expect(moveChairClamped(c, 0.1, 0.1, boxed)).toBe(0);
  });

  it("walking into a pushable chair shoves it ahead; the walker is not stopped", () => {
    const f = field(info("a", true, 0, 1));
    const p = walkInto(f, everywhere, { x: 0, z: 0 }, 40);
    const c = f.get("a")!;
    expect(c.z).toBeGreaterThan(1.5);
    expect(p.z).toBeGreaterThan(1.5 - 0.6);
    expect(c.dirty).toBe(true);
    expect(f.lastMove).toBeGreaterThanOrEqual(0);
  });

  it("a fixed chair does not move and the walker stops at it", () => {
    const f = field(info("a", false, 0, 1));
    const p = walkInto(f, everywhere, { x: 0, z: 0 }, 40);
    expect(f.get("a")!.z).toBe(1);
    expect(p.z).toBeLessThanOrEqual(1 - CHAIR_HD - PLAYER_RADIUS + 1e-6);
  });

  it("a pushed chair is clamped by solids (a wall behind it) and then blocks like furniture", () => {
    const wall: Solid = { kind: "box", box: { minX: -2, maxX: 2, minZ: 1.6, maxZ: 1.7 } };
    const f = field(info("a", true, 0, 1));
    const clear = f.clearFn([wall], everywhere);
    const p = walkInto(f, clear, { x: 0, z: 0 }, 80);
    const c = f.get("a")!;
    expect(c.z + 0.26).toBeLessThanOrEqual(1.6 + 1e-6);
    expect(p.z).toBeLessThan(c.z);
  });

  it("chairs do not get pushed into each other", () => {
    const f = field(info("a", true, 0, 1), info("b", false, 0, 1.7));
    walkInto(f, f.clearFn([], everywhere), { x: 0, z: 0 }, 80);
    expect(f.get("b")!.z - f.get("a")!.z).toBeGreaterThanOrEqual(0.52 - 1e-6);
  });

  it("a shoved chair glides a little and settles", () => {
    const f = field(info("a", true, 0, 1));
    const p = walkInto(f, everywhere, { x: 0, z: 0 }, 12);
    const at = f.get("a")!.z;
    for (let i = 0; i < 120; i++) f.interact({ x: p.x - 5, z: p.z - 5 }, PLAYER_RADIUS, DT, everywhere, 100 + i);
    const c = f.get("a")!;
    expect(c.z).toBeGreaterThan(at);
    expect(c.z - at).toBeLessThan(0.5);
    expect(c.vx === 0 && c.vz === 0).toBe(true);
  });

  it("only nearby chairs are examined", () => {
    const f = field(info("far", true, 50, 50));
    const before = { ...f.get("far")! };
    walkInto(f, everywhere, { x: 0, z: 0 }, 10);
    expect(f.get("far")!.x).toBe(before.x);
  });
});

describe("fixed / pushable rules", () => {
  it("a chair keeps its pushed pose while it stays pushable, and snaps home when its owner sits", () => {
    const f = field(info("pod-a#0", true, 0, 0));
    const c = f.get("pod-a#0")!;
    c.x = 0.4;
    c.z = 0.2;
    f.sync([info("pod-a#0", true, 0, 0)]);
    expect(f.get("pod-a#0")!.x).toBe(0.4);
    expect(f.get("pod-a#0")!.dirty).toBe(true);
    // Owner sat down: fixed, back at its canonical pose.
    f.sync([info("pod-a#0", false, 0, 0.1)]);
    const home = f.get("pod-a#0")!;
    expect([home.x, home.z, home.pushable]).toEqual([0, 0.1, false]);
    // Stepped away again: pushable from the swivelled canonical pose, no stale offset.
    f.sync([info("pod-a#0", true, 0, 0.3, 1.2)]);
    expect([f.get("pod-a#0")!.x, f.get("pod-a#0")!.z]).toEqual([0, 0.3]);
  });

  it("the kit marks chairs: empty and away seats pushable, a seated owner's chair fixed", () => {
    const spaces = buildSpaces(1);
    const pod = spaces.find((s) => s.kind === "pod")!;
    const kit = new Kit();
    furnishSpace(kit, pod, { seats: new Map([[0, "#fff"], [1, "#fff"]]), away: new Set([1]) });
    const byId = Object.fromEntries(kit.chairs.map((c) => [c.id, c]));
    expect(byId[`${pod.id}#0`]!.pushable).toBe(false);
    expect(byId[`${pod.id}#1`]!.pushable).toBe(true);
    expect(byId[`${pod.id}#2`]!.pushable).toBe(true);
    expect(kit.chairs.every((c) => c.count === 6 && kit.items[c.first]!.mat === "chair")).toBe(true);

    const office = spaces.find((s) => s.kind === "office")!;
    const k2 = new Kit();
    furnishSpace(k2, office, { seats: new Map([[0, "#fff"]]) });
    const o = Object.fromEntries(k2.chairs.map((c) => [c.id, c.pushable]));
    expect(o).toEqual({ [`${office.id}#v0`]: true, [`${office.id}#v1`]: true, [`${office.id}#0`]: false });
    const k3 = new Kit();
    furnishSpace(k3, office, { seats: new Map([[0, "#fff"]]), away: new Set([0]) });
    expect(k3.chairs.find((c) => c.id === `${office.id}#0`)!.pushable).toBe(true);

    const meeting = spaces.find((s) => s.kind === "meeting")!;
    const k4 = new Kit();
    furnishSpace(k4, meeting, { seats: new Map([[0, "#fff"]]) });
    expect(k4.chairs.find((c) => c.id === `${meeting.id}#0`)!.pushable).toBe(false);
    expect(k4.chairs.find((c) => c.id === `${meeting.id}#1`)!.pushable).toBe(true);
  });

  it("in a real office every pushable chair starts clear of furniture, so it can actually be pushed", () => {
    const layout = layoutFor([manager]);
    const statics = buildColliders(layout, { excludeKinds: ["chair"] });
    const kit = new Kit();
    for (const s of layout.spaces) furnishSpace(kit, s, { seats: new Map() });
    const f = new ChairField();
    f.sync(kit.chairs);
    const clear = f.clearFn(statics, (x, z) => isWalkable(layout.spaces, x, z));
    expect(f.chairs.length).toBeGreaterThan(20);
    for (const c of f.chairs.filter((ch) => ch.pushable)) expect({ id: c.id, clear: clear(c, c.x, c.z) }).toEqual({ id: c.id, clear: true });
  });
});
