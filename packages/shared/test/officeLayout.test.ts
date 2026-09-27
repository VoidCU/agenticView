import { describe, it, expect } from "vitest";
import {
  AXIAL_DIRS,
  DEFAULT_HEXES,
  HEX_APOTHEM,
  MAX_HEXES,
  MAX_RINGS,
  PRODUCTION_FOOTPRINT,
  PRODUCTION_SCREEN,
  RESEARCH_FOOTPRINT,
  SEATS_BY_KIND,
  WALK_R,
  WALL_SCREEN,
  OfficeLayoutSchema,
  applyLayoutMoves,
  buildSpacesFromLayout,
  defaultLayout,
  defaultRoomName,
  growLayout,
  hexDistance,
  managerHome,
  neighbors,
  nextGrowthHex,
  nextPlacement,
  planOffice,
  route,
  seatLocal,
  setRoomKind,
  spaceAt,
  spacePath,
  userHome,
  validateLayout,
  wallIsOpen,
  worldToAxial,
  yawToward,
  type OfficeLayout,
  type SpaceKind,
} from "../src/office.js";
import { LOUNGE_DOOR_ANGLE, loungeSpots } from "../src/lounge.js";
import { defaultAgent, type Agent, type Placement } from "../src/agent.js";

const at = (layout: OfficeLayout, id: string) => layout.rooms.find((r) => r.id === id)!;
const errorsOf = (layout: OfficeLayout, ctx?: Parameters<typeof validateLayout>[1]) => {
  const v = validateLayout(layout, ctx);
  return v.ok ? [] : v.errors;
};
function worker(id: string, n: number, placement?: Placement): Agent {
  // defaultAgent does not copy placement: set it afterwards.
  const a = defaultAgent({
    id,
    name: id,
    role: "worker",
    scope: "project",
    specialty: "test",
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
  });
  return placement ? { ...a, placement } : a;
}

// ── Default plan ───────────────────────────────────────────────────────────────

describe("default plan (user's sketch)", () => {
  const plan = defaultLayout(0);

  it("puts every fixed room on its sketched hex", () => {
    expect(at(plan, "lounge")).toMatchObject({ kind: "lounge", q: 0, r: 0 });
    expect(at(plan, "office")).toMatchObject({ kind: "office", q: -1, r: 0 });
    expect(at(plan, "meeting")).toMatchObject({ kind: "meeting", q: 0, r: -1 });
    expect(at(plan, "myoffice")).toMatchObject({ kind: "myoffice", q: -2, r: 0 });
    expect(at(plan, "production")).toMatchObject({ kind: "production", q: -1, r: -1 });
    expect(at(plan, "research")).toMatchObject({ kind: "research", q: -2, r: 1 });
    for (const [id, h] of Object.entries(DEFAULT_HEXES)) expect(at(plan, id)).toMatchObject(h);
  });

  it("keeps the ring-1 pods pod-a..pod-d on their old hexes", () => {
    expect(plan.rooms.filter((r) => r.kind === "pod").map((r) => [r.id, r.q, r.r])).toEqual([
      ["pod-a", 1, 0],
      ["pod-b", 0, 1],
      ["pod-c", 1, -1],
      ["pod-d", -1, 1],
    ]);
  });

  it("is valid, parses with the schema and fills ring 1 completely", () => {
    expect(validateLayout(plan)).toEqual({ ok: true });
    expect(OfficeLayoutSchema.parse(plan)).toEqual(plan);
    const ring1 = plan.rooms.filter((r) => hexDistance(r, { q: 0, r: 0 }) === 1);
    expect(ring1).toHaveLength(6);
  });

  it("names the new rooms", () => {
    const spaces = buildSpacesFromLayout(plan);
    expect(spaces[0]).toMatchObject({ id: "office", name: "Manager's Office", seats: 0 });
    const name = (id: string) => spaces.find((s) => s.id === id)!.name;
    expect(name("myoffice")).toBe("My Office");
    expect(name("production")).toBe("Production Room");
    expect(name("research")).toBe("Research Room");
    expect(name("pod-c")).toBe("Pod C");
  });

  it("gives every new room a doorway neighbour and hangs the screens on walls without one", () => {
    const spaces = buildSpacesFromLayout(plan);
    for (const id of ["myoffice", "production", "research"]) {
      const s = spaces.find((x) => x.id === id)!;
      expect(neighbors(spaces, s).length, id).toBeGreaterThan(0);
    }
    const my = at(plan, "myoffice");
    const [dq, dr] = AXIAL_DIRS[WALL_SCREEN.dir]!;
    expect(plan.rooms.find((r) => r.q === my.q + dq && r.r === my.r + dr)).toBeUndefined();
    const prod = at(plan, "production");
    const [pq, pr] = AXIAL_DIRS[PRODUCTION_SCREEN.dir]!;
    expect(plan.rooms.find((r) => r.q === prod.q + pq && r.r === prod.r + pr)).toBeUndefined();
    expect(WALL_SCREEN.angleDeg).toBe(-150);
    expect(PRODUCTION_SCREEN.angleDeg).toBe(-90);
  });

  it("grows whole rings of pods like ringsFor, skipping the fixed hexes with stable ids", () => {
    expect(defaultLayout(23).rooms.filter((r) => r.kind === "pod")).toHaveLength(4);
    const two = defaultLayout(24);
    const pods = two.rooms.filter((r) => r.kind === "pod");
    expect(pods).toHaveLength(4 + 9);
    expect(pods.slice(0, 4).map((p) => p.id)).toEqual(["pod-a", "pod-b", "pod-c", "pod-d"]);
    expect(pods.map((p) => p.id)).toEqual(pods.map((_, i) => `pod-${String.fromCharCode(97 + i)}`));
    const fixed = new Set(Object.values(DEFAULT_HEXES).map((h) => `${h.q},${h.r}`));
    for (const p of pods) expect(fixed.has(`${p.q},${p.r}`)).toBe(false);
    expect(validateLayout(two)).toEqual({ ok: true });
    const full = defaultLayout(10_000);
    expect(full.rooms).toHaveLength(MAX_HEXES);
    expect(validateLayout(full)).toEqual({ ok: true });
  });
});

// ── Seat poses and anchors ─────────────────────────────────────────────────────

describe("new room kinds: seats and anchors", () => {
  it("seat counts", () => {
    expect(SEATS_BY_KIND.myoffice).toBe(0);
    expect(SEATS_BY_KIND.production).toBe(2);
    expect(SEATS_BY_KIND.research).toBe(4);
  });

  it.each(["production", "research"] as SpaceKind[])("%s seats are distinct and inside the walkway", (kind) => {
    const poses = Array.from({ length: SEATS_BY_KIND[kind] }, (_, i) => seatLocal(kind, i));
    expect(new Set(poses.map((p) => `${p.x},${p.z}`)).size).toBe(poses.length);
    for (const p of poses) expect(Math.hypot(p.x, p.z)).toBeLessThan(WALK_R - 1.5);
  });

  it("production seats face their desk and the screen wall", () => {
    for (let i = 0; i < 2; i++) {
      const p = seatLocal("production", i);
      const desk = PRODUCTION_FOOTPRINT.desks[i]!;
      expect(p.yaw).toBeCloseTo(yawToward(p, { x: p.x, z: desk.z }));
      expect(p.yaw).toBeCloseTo(yawToward(p, { x: p.x, z: PRODUCTION_SCREEN.z }));
    }
  });

  it("research seats face across the reading table, two per side", () => {
    const poses = [0, 1, 2, 3].map((i) => seatLocal("research", i));
    expect(poses.filter((p) => p.z < 0)).toHaveLength(2);
    expect(poses.filter((p) => p.z > 0)).toHaveLength(2);
    for (const p of poses) {
      expect(Math.abs(p.z)).toBeGreaterThan(RESEARCH_FOOTPRINT.table.d / 2);
      expect(p.yaw).toBeCloseTo(yawToward(p, { x: p.x, z: 0 }));
    }
  });

  it("screens sit on the inner face of their wall and face into the room", () => {
    for (const s of [WALL_SCREEN, PRODUCTION_SCREEN]) {
      expect(Math.hypot(s.x, s.z)).toBeCloseTo(HEX_APOTHEM - 0.08);
      expect(s.yaw).toBeCloseTo(yawToward(s, { x: 0, z: 0 }));
      expect(s.dir).toBeGreaterThanOrEqual(0);
    }
  });

  it("userHome stands inside My Office, looking at the wall screen", () => {
    const plan = defaultLayout(0);
    const my = buildSpacesFromLayout(plan).find((s) => s.kind === "myoffice")!;
    const home = userHome(my);
    expect(worldToAxial(home.x, home.z)).toEqual({ q: my.q, r: my.r });
    expect(home.yaw).toBeCloseTo(yawToward(home, { x: my.x + WALL_SCREEN.x, z: my.z + WALL_SCREEN.z }));
  });

  it("managerHome lands inside the manager's office wherever it is", () => {
    for (const layout of [defaultLayout(0), applyLayoutMoves(defaultLayout(0), [{ space: "office", toHex: { q: 2, r: -1 } }])]) {
      const office = buildSpacesFromLayout(layout).find((s) => s.kind === "office")!;
      const h = managerHome(office);
      expect(worldToAxial(h.x, h.z)).toEqual({ q: office.q, r: office.r });
    }
  });

  it("the lounge's waiting queue points at the manager's office by default", () => {
    expect(LOUNGE_DOOR_ANGLE).toBeCloseTo((-150 * Math.PI) / 180);
    expect(loungeSpots().doorAngle).toBe(LOUNGE_DOOR_ANGLE);
    expect(loungeSpots(0, 7, 0.5).doorAngle).toBe(0.5);
  });
});

// ── Routing ────────────────────────────────────────────────────────────────────

describe("routing on the new plan", () => {
  const spaces = buildSpacesFromLayout(defaultLayout(0));
  const byId = (id: string) => spaces.find((s) => s.id === id)!;

  it("goes round through pods instead of crossing the lounge", () => {
    expect(spacePath(spaces, byId("pod-b"), byId("pod-c")).map((s) => s.id)).toEqual(["pod-b", "pod-a", "pod-c"]);
  });

  it("reaches every new room through doorways", () => {
    for (const id of ["myoffice", "production", "research"]) {
      const chain = spacePath(spaces, byId("pod-a"), byId(id));
      expect(chain[chain.length - 1]!.id).toBe(id);
      for (let i = 1; i < chain.length; i++) expect(wallIsOpen(chain[i - 1]!, chain[i]!)).toBe(true);
      const pts = route(spaces, byId("pod-a"), byId(id));
      for (const p of pts) expect(spaceAt(spaces, p.x, p.z)).toBeDefined();
    }
  });

  it("never walks through a screen wall", () => {
    const layout = setRoomKind(defaultLayout(0), { q: -3, r: 0 }, "pod");
    const ss = buildSpacesFromLayout(layout);
    const my = ss.find((s) => s.kind === "myoffice")!;
    const outer = ss.find((s) => s.q === -3 && s.r === 0)!;
    expect(wallIsOpen(my, outer)).toBe(false);
    expect(neighbors(ss, my).some((n) => n.space.id === outer.id)).toBe(false);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────────

describe("validateLayout", () => {
  const base = defaultLayout(0);

  it("rejects a bad schema", () => {
    expect(errorsOf({ ...base, version: 2 } as unknown as OfficeLayout).length).toBeGreaterThan(0);
    expect(errorsOf({ version: 1, rooms: [{ id: "x", kind: "garage", q: 0, r: 0 }] } as unknown as OfficeLayout).length).toBeGreaterThan(0);
  });

  it("requires exactly one manager's office", () => {
    expect(errorsOf(setRoomKind(base, DEFAULT_HEXES.office, "pod")).join()).toMatch(/one manager's office/);
    expect(errorsOf(setRoomKind(base, { q: 2, r: 0 }, "office")).join()).toMatch(/one manager's office required \(found 2\)/);
  });

  it("requires exactly one My Office", () => {
    expect(errorsOf(setRoomKind(base, DEFAULT_HEXES.myoffice, "pod")).join()).toMatch(/one My Office required \(found 0\)/);
    expect(errorsOf(setRoomKind(base, { q: 2, r: 0 }, "myoffice")).join()).toMatch(/one My Office required \(found 2\)/);
  });

  it("allows any number of lounges, meetings, pods, production and research rooms", () => {
    let l = base;
    for (const [h, k] of [
      [{ q: 2, r: 0 }, "lounge"],
      [{ q: 1, r: 1 }, "meeting"],
      [{ q: 2, r: -1 }, "production"],
      [{ q: 0, r: 2 }, "research"],
    ] as const) l = setRoomKind(l, h, k);
    expect(validateLayout(l)).toEqual({ ok: true });
    l = setRoomKind(setRoomKind(l, DEFAULT_HEXES.meeting, "pod"), DEFAULT_HEXES.lounge, "pod");
    expect(validateLayout(l)).toEqual({ ok: true });
  });

  it("rejects duplicate ids and shared hexes", () => {
    const dupId: OfficeLayout = { version: 1, rooms: [...base.rooms, { id: "pod-a", kind: "pod", q: 2, r: 0 }] };
    expect(errorsOf(dupId).join()).toMatch(/duplicate room id "pod-a"/);
    const dupHex: OfficeLayout = { version: 1, rooms: [...base.rooms, { id: "pod-z", kind: "pod", q: 1, r: 0 }] };
    expect(errorsOf(dupHex).join()).toMatch(/share hex 1,0/);
  });

  it("rejects hexes beyond MAX_RINGS", () => {
    const far: OfficeLayout = { version: 1, rooms: [...base.rooms, { id: "pod-z", kind: "pod", q: MAX_RINGS + 1, r: 0 }] };
    expect(errorsOf(far).join()).toMatch(/outside the office/);
  });

  it("rejects rooms not connected to the manager's office", () => {
    const island: OfficeLayout = { version: 1, rooms: [...base.rooms, { id: "pod-z", kind: "pod", q: 0, r: 3 }] };
    expect(errorsOf(island).join()).toMatch(/"pod-z" at 0,3 is not connected/);
    // Only touching My Office through its screen wall does not count as connected.
    const behindScreen = setRoomKind(base, { q: -3, r: 0 }, "pod");
    expect(errorsOf(behindScreen).join()).toMatch(/at -3,0 is not connected/);
  });

  it("refuses to remove a room with seated workers", () => {
    const placements = { w1: { space: "pod-a", seat: 2 } };
    const removed = setRoomKind(base, { q: 1, r: 0 }, null);
    expect(errorsOf(removed, { placements, previous: base }).join()).toMatch(/"pod-a" has seated workers/);
    expect(errorsOf(removed, { placements: { w1: { space: "pod-b", seat: 2 } }, previous: base })).toEqual([]);
    // A seat that vanishes because the kind changed is refused too.
    const rekinded = applyLayoutMoves(base, []);
    rekinded.rooms.find((r) => r.id === "pod-a")!.kind = "production";
    expect(errorsOf(rekinded, { placements, previous: base }).join()).toMatch(/no seat 2/);
    // A stale placement in a room the previous layout did not have is not a removal.
    expect(errorsOf(base, { placements: [{ space: "pod-q", seat: 0 }], previous: base })).toEqual([]);
  });
});

// ── Editing ────────────────────────────────────────────────────────────────────

describe("applyLayoutMoves", () => {
  const base = defaultLayout(0);

  it("moves a room onto a free hex", () => {
    const moved = applyLayoutMoves(base, [{ space: "pod-a", toHex: { q: 2, r: 0 } }]);
    expect(at(moved, "pod-a")).toMatchObject({ q: 2, r: 0 });
    expect(at(base, "pod-a")).toMatchObject({ q: 1, r: 0 }); // input untouched
  });

  it("swaps with the room already on the target hex", () => {
    const swapped = applyLayoutMoves(base, [{ space: "office", toHex: { q: 0, r: 0 } }]);
    expect(at(swapped, "office")).toMatchObject({ q: 0, r: 0 });
    expect(at(swapped, "lounge")).toMatchObject({ q: -1, r: 0 });
    expect(validateLayout(swapped)).toEqual({ ok: true });
  });

  it("applies moves in order and throws on an unknown room", () => {
    const l = applyLayoutMoves(base, [
      { space: "pod-a", toHex: { q: 0, r: 1 } },
      { space: "pod-a", toHex: { q: 1, r: 0 } },
    ]);
    expect(l).toEqual(base);
    expect(() => applyLayoutMoves(base, [{ space: "nope", toHex: { q: 0, r: 0 } }])).toThrow(/unknown room "nope"/);
  });
});

describe("setRoomKind", () => {
  const base = defaultLayout(0);

  it("re-kinds a room with a fresh id and drops its custom name", () => {
    const named: OfficeLayout = { version: 1, rooms: base.rooms.map((r) => (r.id === "pod-a" ? { ...r, name: "Den" } : r)) };
    const l = setRoomKind(named, { q: 1, r: 0 }, "research");
    expect(l.rooms.find((r) => r.q === 1 && r.r === 0)).toEqual({ id: "research-2", kind: "research", q: 1, r: 0 });
    expect(validateLayout(l)).toEqual({ ok: true });
  });

  it("adds a room on an empty hex, removes with null, same kind is a no-op", () => {
    const added = setRoomKind(base, { q: 2, r: 0 }, "pod");
    expect(added.rooms.at(-1)).toEqual({ id: "pod-e", kind: "pod", q: 2, r: 0 });
    const removed = setRoomKind(added, { q: 2, r: 0 }, null);
    expect(removed).toEqual(base);
    expect(setRoomKind(base, { q: 1, r: 0 }, "pod")).toEqual(base);
    expect(setRoomKind(base, { q: 3, r: 0 }, null)).toEqual(base);
  });

  it("reuses a freed pod letter", () => {
    const l = setRoomKind(setRoomKind(base, { q: 0, r: 1 }, null), { q: 2, r: 0 }, "pod");
    expect(at(l, "pod-b")).toMatchObject({ q: 2, r: 0 });
  });
});

// ── Growth ─────────────────────────────────────────────────────────────────────

describe("growLayout", () => {
  const base = defaultLayout(0);

  it("does nothing while a pod desk is spare", () => {
    expect(growLayout(base, 23)).toBe(base);
  });

  it("adds one pod once every desk is taken, on the next growth hex", () => {
    const hex = nextGrowthHex(base)!;
    expect(hexDistance(hex, { q: 0, r: 0 })).toBe(2);
    const grown = growLayout(base, 24);
    expect(grown.rooms).toHaveLength(base.rooms.length + 1);
    expect(grown.rooms.at(-1)).toEqual({ id: "pod-e", kind: "pod", ...hex });
    expect(validateLayout(grown)).toEqual({ ok: true });
  });

  it("fills the nearest ring first, camera-facing side first, and stays contiguous", () => {
    const grown = growLayout(base, 13 * 6 - 1);
    const added = grown.rooms.slice(base.rooms.length);
    expect(added).toHaveLength(9);
    for (const r of added) expect(hexDistance(r, { q: 0, r: 0 })).toBe(2);
    expect(validateLayout(grown)).toEqual({ ok: true });
    const first = added[0]!;
    // The first new pod faces the camera (+x/+z side).
    expect(first.q >= 0 && first.q + first.r >= 0).toBe(true);
  });

  it("stops when the honeycomb is full", () => {
    const full = growLayout(base, 10_000);
    expect(full.rooms).toHaveLength(MAX_HEXES);
    expect(nextGrowthHex(full)).toBeNull();
    expect(validateLayout(full)).toEqual({ ok: true });
  });
});

// ── Seating on a layout ────────────────────────────────────────────────────────

describe("planOffice with a layout", () => {
  it("without a layout uses the default plan", () => {
    const plan = planOffice([worker("w1", 1)]);
    expect(plan.spaces[0]).toMatchObject({ id: "office", q: -1, r: 0 });
    expect(plan.spaces.find((s) => s.kind === "myoffice")).toBeDefined();
    expect(plan.placements.w1).toEqual({ space: "pod-a", seat: 0 });
  });

  it("keeps valid seats in the new rooms and remaps seats that no longer exist", () => {
    const layout = defaultLayout(0);
    const agents = [
      worker("w1", 1, { space: "production", seat: 1 }),
      worker("w2", 2, { space: "research", seat: 3 }),
      worker("w3", 3, { space: "production", seat: 2 }), // out of range
      worker("w4", 4, { space: "myoffice", seat: 0 }), // kind without seats
      worker("w5", 5, { space: "pod-z", seat: 0 }), // unknown room
    ];
    const { placements } = planOffice(agents, layout);
    expect(placements.w1).toEqual({ space: "production", seat: 1 });
    expect(placements.w2).toEqual({ space: "research", seat: 3 });
    expect(placements.w3).toEqual({ space: "pod-a", seat: 0 });
    expect(placements.w4).toEqual({ space: "pod-a", seat: 1 });
    expect(placements.w5).toEqual({ space: "pod-a", seat: 2 });
  });

  it("applies space names and room names", () => {
    const layout: OfficeLayout = { version: 1, rooms: defaultLayout(0).rooms.map((r) => (r.id === "pod-b" ? { ...r, name: "Den" } : r)) };
    const { spaces } = planOffice([], layout, { "pod-c": "Bay" });
    expect(spaces.find((s) => s.id === "pod-b")!.name).toBe("Den");
    expect(spaces.find((s) => s.id === "pod-c")!.name).toBe("Bay");
  });

  it("nextPlacement finds a desk on a grown pod when the layout is full", () => {
    const layout = defaultLayout(0);
    const agents = Array.from({ length: 24 }, (_, i) => worker(`w${String(i).padStart(2, "0")}`, i));
    expect(nextPlacement(agents, layout)).toEqual({ space: "pod-e", seat: 0 });
    expect(nextPlacement([], layout)).toEqual({ space: "pod-a", seat: 0 });
  });

  it("default room names", () => {
    expect(defaultRoomName("pod", "pod-aa")).toBe("Pod AA");
    expect(defaultRoomName("meeting", "meeting-2")).toBe("Meeting Room 2");
    expect(defaultRoomName("research", "research")).toBe("Research Room");
    expect(defaultRoomName("lounge", "meeting-2")).toBe("Lounge");
  });
});
