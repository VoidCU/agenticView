import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HEXES,
  ExplicitRoomsSchema,
  MAX_HEXES,
  buildSpaces,
  defaultLayout,
  hexDistance,
  validateLayout,
  type OfficeLayout,
} from "../src/office.js";
import { SpaceNamesSchema } from "../src/protocol.js";
import { defaultAgent, type Agent, type Placement } from "../src/agent.js";
import { migrateLegacyLayout } from "../src/migrations.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "legacy-0.2.16");
const json = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), "utf8"));

const rooms = ExplicitRoomsSchema.parse(json("rooms.json"));
const spaceNames = SpaceNamesSchema.parse(json("office.json"));
type RawAgent = { id: string; name: string; role: "worker" | "manager"; createdAt: string; placement?: Placement };
const agents: Agent[] = (json("agents.json") as RawAgent[]).map((a) =>
  ({ ...defaultAgent({ id: a.id, name: a.name, role: a.role, scope: "project", specialty: "test", createdAt: a.createdAt }), ...(a.placement ? { placement: a.placement } : {}) }),
);

const room = (l: OfficeLayout, id: string) => l.rooms.find((r) => r.id === id);
const applyPlacements = (list: Agent[], p: Record<string, Placement>): Agent[] => list.map((a) => (p[a.id] ? { ...a, placement: p[a.id] } : a));

describe("migrateLegacyLayout: 0.2.16 fixture (rooms.json + office.json + agents)", () => {
  const out = migrateLegacyLayout({ rooms, spaceNames, workers: agents });

  it("produces a valid layout with the new default plan's fixed rooms", () => {
    expect(validateLayout(out.layout, { placements: applyPlacements(agents, out.placements).flatMap((a) => (a.placement ? [a.placement] : [])) })).toEqual({ ok: true });
    for (const [id, h] of Object.entries(DEFAULT_HEXES)) expect(room(out.layout, id), id).toMatchObject(h);
    expect(out.layout.rooms[0]).toMatchObject({ id: "office", kind: "office" });
    expect(out.changed).toBe(true);
    expect(out.dropped).toEqual([]);
  });

  it("swaps lounge and manager's office", () => {
    expect(room(out.layout, "lounge")).toMatchObject({ kind: "lounge", q: 0, r: 0 });
    expect(room(out.layout, "office")).toMatchObject({ kind: "office", q: -1, r: 0 });
  });

  it("keeps every old pod and the meeting room by id, on its hex when still free", () => {
    for (const r of rooms) expect(room(out.layout, r.id), r.id).toBeDefined();
    for (const id of ["pod-a", "pod-b", "pod-c", "pod-d", "pod-e", "pod-k", "pod-n", "meeting"]) {
      const old = rooms.find((r) => r.id === id)!;
      expect(room(out.layout, id), id).toMatchObject({ q: old.q, r: old.r });
    }
  });

  it("moves pods off the hexes the new rooms took, keeping id and custom name", () => {
    const fixed = new Set(Object.values(DEFAULT_HEXES).map((h) => `${h.q},${h.r}`));
    const hexes = new Set<string>();
    for (const id of ["pod-m", "pod-o", "pod-p"]) {
      const r = room(out.layout, id)!;
      expect(fixed.has(`${r.q},${r.r}`), id).toBe(false);
      expect(hexDistance(r, { q: 0, r: 0 })).toBe(3);
      hexes.add(`${r.q},${r.r}`);
    }
    expect(hexes.size).toBe(3);
    expect(room(out.layout, "pod-m")!.name).toBe("Night Shift");
    expect(room(out.layout, "pod-b")!.name).toBe("Frontend Den");
    // Default names are not copied into the layout.
    expect(room(out.layout, "pod-a")!.name).toBeUndefined();
  });

  it("keeps custom names of rooms that still exist and drops the rest", () => {
    expect(out.spaceNames).toEqual({ office: "HQ", meeting: "War Room", "pod-c": "Backend Bay", "pod-p": "Data Corner" });
  });

  it("keeps valid seats (lounge, moved pods) and remaps seats that no longer exist", () => {
    expect(out.placements).toEqual({
      w_ghost: { space: "pod-a", seat: 1 },
      w_stale: { space: "pod-a", seat: 2 },
    });
    // Workers whose seat still exists are untouched: the lounger (lounge moved to the centre),
    // the worker in pod-o (pod moved), the one in the custom-named pod-b.
    for (const id of ["w_lounger", "w_displaced", "w_frontend", "w_night", "w_pod_a", "w_fresh"]) expect(out.placements[id]).toBeUndefined();
  });

  it("is idempotent: migrating the result again is a no-op", () => {
    const again = migrateLegacyLayout({ rooms, layout: out.layout, spaceNames: out.spaceNames, workers: applyPlacements(agents, out.placements) });
    expect(again.layout).toEqual(out.layout);
    expect(again.spaceNames).toEqual(out.spaceNames);
    expect(again.placements).toEqual({});
    expect(again.changed).toBe(false);
  });

  it("is deterministic", () => {
    expect(migrateLegacyLayout({ rooms, spaceNames, workers: agents })).toEqual(out);
  });
});

describe("migrateLegacyLayout: edge cases", () => {
  const w = (id: string, n: number, placement?: Placement) =>
    ({ ...defaultAgent({ id, name: id, role: "worker", scope: "project", specialty: "t", createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z` }), ...(placement ? { placement } : {}) });

  it("without rooms.json migrates the implicit auto-grown plan into the default plan", () => {
    const out = migrateLegacyLayout({ rooms: null, spaceNames: {}, workers: [w("a", 1, { space: "lounge", seat: 0 })] });
    expect(out.layout).toEqual(defaultLayout(1));
    expect(out.placements).toEqual({});
  });

  it("re-adds a lounge in the centre when the old office had removed it", () => {
    const noLounge = rooms.filter((r) => r.kind !== "lounge");
    const out = migrateLegacyLayout({ rooms: noLounge, spaceNames: {}, workers: [] });
    expect(room(out.layout, "lounge")).toMatchObject({ q: 0, r: 0 });
    expect(validateLayout(out.layout)).toEqual({ ok: true });
  });

  it("drops rooms that cannot fit when the old office used every hex", () => {
    const legacyFull = buildSpaces(3).filter((s) => s.kind !== "office").map((s) => ({ id: s.id, kind: s.kind as "pod" | "meeting" | "lounge", name: s.name, q: s.q, r: s.r }));
    const out = migrateLegacyLayout({ rooms: legacyFull, spaceNames: {}, workers: [] });
    expect(out.layout.rooms).toHaveLength(MAX_HEXES);
    expect(out.dropped).toHaveLength(3);
    expect(validateLayout(out.layout)).toEqual({ ok: true });
  });

  it("grows pods when the remapped workers need more desks", () => {
    const many = Array.from({ length: 30 }, (_, i) => w(`w${String(i).padStart(2, "0")}`, i));
    const ring1 = rooms.slice(0, 6);
    const out = migrateLegacyLayout({ rooms: ring1, spaceNames: {}, workers: many });
    expect(out.layout.rooms.filter((r) => r.kind === "pod").length * 6).toBeGreaterThan(30);
    expect(validateLayout(out.layout)).toEqual({ ok: true });
  });
});
