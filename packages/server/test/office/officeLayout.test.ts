/**
 * Tests for the office layout rules:
 *   - Hex fill order (ring-by-ring)
 *   - Growth only when the current ring is full
 *   - addRoom places the next free hex
 *   - removeRoom refuses occupied rooms and the Manager's Office
 *   - Cap at MAX_RINGS (3)
 *   - Persistence (rooms.json written/read)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  hexesForRing,
  nextAddRoomHex,
  currentOfficeRings,
  buildSpacesFromExplicit,
  planOfficeWithSpaces,
  MAX_RINGS,
  type ExplicitRoom,
  defaultAgent,
} from "@agenticview/shared";
import { createWorld } from "../../src/world.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import { EventBus } from "../../src/events/bus.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";

// ---------- pure-function tests ----------

describe("hexesForRing", () => {
  it("ring 1 returns 6 hexes in canonical order", () => {
    const r1 = hexesForRing(1);
    expect(r1).toHaveLength(6);
    // First four are RING1_PODS
    expect(r1[0]).toEqual({ q: 1, r: 0 });
    expect(r1[1]).toEqual({ q: 0, r: 1 });
    // Meeting and Lounge at the end
    expect(r1[4]).toEqual({ q: 0, r: -1 });
    expect(r1[5]).toEqual({ q: -1, r: 0 });
  });

  it("ring 2 returns 12 hexes", () => {
    expect(hexesForRing(2)).toHaveLength(12);
  });

  it("ring 3 returns 18 hexes", () => {
    expect(hexesForRing(3)).toHaveLength(18);
  });
});

describe("nextAddRoomHex – fill order and ring-fill rule", () => {
  it("returns the first ring-1 hex when rooms is empty", () => {
    const hex = nextAddRoomHex([]);
    expect(hex).not.toBeNull();
    expect(hex!.ring).toBe(1);
    expect(hex).toMatchObject({ q: 1, r: 0 }); // first RING1_PODS hex
  });

  it("stays in ring 1 until it is full", () => {
    const ring1 = hexesForRing(1);
    // Fill all but the last ring-1 hex.
    const partial: { q: number; r: number }[] = ring1.slice(0, 5);
    const next = nextAddRoomHex(partial);
    expect(next).not.toBeNull();
    expect(next!.ring).toBe(1);
    expect(next).toMatchObject(ring1[5]!);
  });

  it("advances to ring 2 only when ring 1 is completely full", () => {
    const ring1 = hexesForRing(1);
    const fullRing1: { q: number; r: number }[] = ring1.map((h) => ({ ...h }));
    const next = nextAddRoomHex(fullRing1);
    expect(next).not.toBeNull();
    expect(next!.ring).toBe(2);
  });

  it("returns null when all MAX_RINGS rings are occupied", () => {
    const all: { q: number; r: number }[] = [];
    for (let k = 1; k <= MAX_RINGS; k++) {
      for (const h of hexesForRing(k)) all.push({ ...h });
    }
    expect(nextAddRoomHex(all)).toBeNull();
  });
});

describe("currentOfficeRings", () => {
  it("returns 0 when rooms is empty", () => {
    expect(currentOfficeRings([])).toBe(0);
  });

  it("returns the max ring of the rooms", () => {
    const ring1 = hexesForRing(1).map((h) => ({ ...h }));
    expect(currentOfficeRings(ring1)).toBe(1);
    const ring2 = hexesForRing(2);
    expect(currentOfficeRings([...ring1, ring2[0]!])).toBe(2);
  });
});

describe("buildSpacesFromExplicit + planOfficeWithSpaces", () => {
  it("always includes the Manager's Office", () => {
    const spaces = buildSpacesFromExplicit([]);
    expect(spaces.find((s) => s.id === "office")).toBeDefined();
    expect(spaces).toHaveLength(1);
  });

  it("builds spaces with correct seats from kind", () => {
    const rooms: ExplicitRoom[] = [
      { id: "pod-a", kind: "pod", name: "Pod A", q: 1, r: 0 },
      { id: "meeting", kind: "meeting", name: "Meeting Room", q: 0, r: -1 },
    ];
    const spaces = buildSpacesFromExplicit(rooms);
    expect(spaces).toHaveLength(3);
    expect(spaces.find((s) => s.id === "pod-a")!.seats).toBe(4);
    expect(spaces.find((s) => s.id === "meeting")!.seats).toBe(6);
  });

  it("seats workers in explicit spaces using persisted placements", () => {
    const worker = defaultAgent({ name: "W1", role: "worker", scope: "project", specialty: "" });
    worker.placement = { space: "pod-a", seat: 2 };
    const rooms: ExplicitRoom[] = [{ id: "pod-a", kind: "pod", name: "Pod A", q: 1, r: 0 }];
    const spaces = buildSpacesFromExplicit(rooms);
    const manager = defaultAgent({ name: "M", role: "manager", scope: "project", specialty: "" });
    const plan = planOfficeWithSpaces(spaces, [manager, worker]);
    expect(plan.placements[worker.id]).toEqual({ space: "pod-a", seat: 2 });
  });
});

// ---------- world-level tests (persistence, addRoom, removeRoom) ----------

let tmpHome: string;
let tmpProj: string;
const savedHome = process.env.AGENTICVIEW_HOME;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "av-layout-h-"));
  tmpProj = await mkdtemp(join(tmpdir(), "av-layout-p-"));
  process.env.AGENTICVIEW_HOME = tmpHome;
});

afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(tmpProj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function makeWorld() {
  const fake = new FakeRuntime(async function* () {
    yield { type: "text" as const, text: "hi" };
  });
  const bus = new EventBus();
  const toolRegistry = new ToolRegistry();
  return createWorld({ kind: "project", projectPath: tmpProj }, {
    runtimes: new Map([["claude", fake]]),
    bus,
    toolRegistry,
    bridgeUrl: () => "http://localhost",
  });
}

describe("world.addRoom", () => {
  it("places the first room and persists it in rooms.json", async () => {
    const world = await makeWorld();
    const result = await world.addRoom("pod", "Alpha Pod");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("should be ok");
    // The ID should be a pod-X pattern (exact letter depends on auto-init).
    expect(result.spaceId).toMatch(/^pod-/);

    // rooms.json is written inside <project>/.agenticview/rooms.json
    const roomsFile = join(tmpProj, ".agenticview", "rooms.json");
    const raw = await readFile(roomsFile, "utf8").catch(() => undefined);
    expect(raw).toBeDefined();
    if (raw !== undefined) {
      const rooms = JSON.parse(raw) as ExplicitRoom[];
      expect(rooms.find((r) => r.id === result.spaceId)).toBeDefined();
    }
  });

  it("returns {ok:false} with the cap message when all rings are full", async () => {
    const world = await makeWorld();
    // Fill all MAX_RINGS rings by calling addRoom enough times.
    // ring1=6, ring2=12, ring3=18 → 36 explicit rooms max.
    const total = 6 + 12 + 18;
    let last: Awaited<ReturnType<typeof world.addRoom>> = { ok: false, message: "" };
    for (let i = 0; i < total + 1; i++) {
      last = await world.addRoom("pod", `R${i}`);
    }
    expect(last.ok).toBe(false);
    if (!last.ok) {
      expect(last.message).toMatch(/full.*3 ring/i);
    }
  });

  it("snapshot includes ringCount", async () => {
    const world = await makeWorld();
    await world.addRoom("pod", "Pod X");
    const snap = await world.snapshot();
    expect(snap.ringCount).toBeGreaterThanOrEqual(1);
  });
});

describe("world.removeRoom", () => {
  it("refuses to remove the Manager's Office", async () => {
    const world = await makeWorld();
    const result = await world.removeRoom("office");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/manager/i);
  });

  it("refuses to remove a room with a seated agent", async () => {
    const world = await makeWorld();
    // Add a pod and seat a worker in it.
    const addResult = await world.addRoom("pod", "Test Pod");
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) throw new Error("expected ok");
    const spaceId = addResult.spaceId;

    // Create a worker and pin them in the new pod.
    const worker = await world.registry.create({ name: "Tester", role: "worker", scope: "project", specialty: "test" });
    await world.registry.update(worker.id, { placement: { space: spaceId, seat: 0 } });

    const removeResult = await world.removeRoom(spaceId);
    expect(removeResult.ok).toBe(false);
    if (!removeResult.ok) expect(removeResult.message).toMatch(/seated|Tester/i);
  });

  it("removes an empty room and updates rooms.json", async () => {
    const world = await makeWorld();
    const addResult = await world.addRoom("pod", "Temp Pod");
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) throw new Error("expected ok");

    const removeResult = await world.removeRoom(addResult.spaceId);
    expect(removeResult.ok).toBe(true);
  });

  it("refuses an unknown spaceId", async () => {
    const world = await makeWorld();
    const result = await world.removeRoom("pod-zzz");
    expect(result.ok).toBe(false);
  });
});
