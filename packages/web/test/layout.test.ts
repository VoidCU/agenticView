import { describe, expect, it } from "vitest";
import {
  axialToWorld,
  worldToAxial,
  buildSpaces,
  hexRing,
  planOffice,
  nextPlacement,
  route,
  spaceAt,
  spacePath,
  doorPoint,
  seatPose,
  HEX_R,
  HEX_APOTHEM,
  WALK_R,
  ringsFor,
  type Point,
  type Space,
} from "@agenticview/shared";
import { layoutFor } from "../src/scene/layout";
import { agent, manager } from "./fixtures";

const w = (i: number, placement?: { space: string; seat: number }) =>
  agent({ id: `w_${String(i).padStart(8, "0")}`, name: `W${i}`, createdAt: `2026-09-25T00:00:${String(i).padStart(2, "0")}.000Z`, ...(placement ? { placement } : {}) });

describe("hex grid", () => {
  it("neighbouring hex centers are one wall apart (2 x apothem)", () => {
    for (const [q, r] of [[1, 0], [0, 1], [1, -1], [-1, 0]] as const) {
      const p = axialToWorld(q, r);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(2 * HEX_APOTHEM, 6);
    }
  });

  it("round-trips world <-> axial, including points near a wall", () => {
    for (const h of [...hexRing(1), ...hexRing(2)]) {
      const p = axialToWorld(h.q, h.r);
      expect(worldToAxial(p.x, p.z)).toEqual(h);
      expect(worldToAxial(p.x + HEX_APOTHEM * 0.95, p.z)).toEqual(h);
    }
  });

  it("rings have 6k hexes", () => {
    expect(hexRing(0)).toHaveLength(1);
    expect(hexRing(1)).toHaveLength(6);
    expect(hexRing(2)).toHaveLength(12);
  });

  it("one ring = office + 4 pods + meeting room + lounge; two rings add 12 pods", () => {
    const one = buildSpaces(1);
    expect(one.map((s) => s.id)).toEqual(["office", "pod-a", "pod-b", "pod-c", "pod-d", "meeting", "lounge"]);
    expect(one[0]).toMatchObject({ x: 0, z: 0, kind: "office", seats: 0 });
    const two = buildSpaces(2);
    expect(two.filter((s) => s.kind === "pod")).toHaveLength(16);
    expect(new Set(two.map((s) => `${s.q},${s.r}`)).size).toBe(two.length);
  });

  it("grows a ring once the pods have no desk to spare", () => {
    expect(ringsFor(0)).toBe(1);
    expect(ringsFor(15)).toBe(1);
    expect(ringsFor(16)).toBe(2);
  });
});

describe("planOffice", () => {
  it("fills pod desks in order by creation", () => {
    const plan = planOffice([manager, w(3), w(1), w(2), w(4), w(5)]);
    expect(plan.placements["w_00000001"]).toEqual({ space: "pod-a", seat: 0 });
    expect(plan.placements["w_00000004"]).toEqual({ space: "pod-a", seat: 3 });
    expect(plan.placements["w_00000005"]).toEqual({ space: "pod-b", seat: 0 });
    expect(plan.placements[manager.id]).toBeUndefined();
  });

  it("keeps persisted placements and fills around them; a contested seat goes to the elder", () => {
    const plan = planOffice([w(1, { space: "meeting", seat: 2 }), w(2), w(3, { space: "pod-a", seat: 0 }), w(4, { space: "pod-a", seat: 0 })]);
    expect(plan.placements["w_00000001"]).toEqual({ space: "meeting", seat: 2 });
    expect(plan.placements["w_00000003"]).toEqual({ space: "pod-a", seat: 0 });
    expect(plan.placements["w_00000002"]).toEqual({ space: "pod-a", seat: 1 });
    expect(plan.placements["w_00000004"]).toEqual({ space: "pod-a", seat: 2 });
  });

  it("ignores placements in unknown spaces or seats", () => {
    const plan = planOffice([w(1, { space: "roof", seat: 0 }), w(2, { space: "pod-a", seat: 9 })]);
    expect(plan.placements["w_00000001"]).toEqual({ space: "pod-a", seat: 0 });
    expect(plan.placements["w_00000002"]).toEqual({ space: "pod-a", seat: 1 });
  });

  it("grows to fit a persisted outer-ring placement", () => {
    const plan = planOffice([w(1, { space: "pod-e", seat: 1 })]);
    expect(plan.spaces.some((s) => s.id === "pod-e")).toBe(true);
    expect(plan.placements["w_00000001"]).toEqual({ space: "pod-e", seat: 1 });
  });

  it("nextPlacement is the first free desk", () => {
    expect(nextPlacement([manager, w(1), w(2)])).toEqual({ space: "pod-a", seat: 2 });
  });
});

/** Does segment p-q cross a wall of the honeycomb anywhere but through a doorway? */
function crossesWall(spaces: Space[], p: Point, q: Point): boolean {
  const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.05);
  let prev = spaceAt(spaces, p.x, p.z);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    const cur = spaceAt(spaces, x, z);
    if (!cur) return true;
    if (prev && cur.id !== prev.id) {
      // Changing room: must happen within half a door width of that wall's doorway.
      const dir = [0, 1, 2, 3, 4, 5].find((d) => Math.hypot(doorPoint(prev!, d).x - x, doorPoint(prev!, d).z - z) < 0.8);
      if (dir === undefined) return true;
    }
    prev = cur;
  }
  return false;
}

describe("route", () => {
  const spaces = buildSpaces(2);
  const byId = (id: string) => spaces.find((s) => s.id === id)!;

  it("prefers going round the meeting room over cutting through it", () => {
    const behindMeeting = spaces.find((s) => s.q === 0 && s.r === -2)!;
    const chain = spacePath(spaces, byId("office"), behindMeeting).map((s) => s.id);
    expect(chain).not.toContain("meeting");
    expect(chain[0]).toBe("office");
    expect(chain[chain.length - 1]).toBe(behindMeeting.id);
  });

  it("goes from the office through doorways only, and ends on the target", () => {
    for (const target of spaces.filter((s) => s.seats > 0)) {
      for (let seat = 0; seat < target.seats; seat++) {
        const from = { x: -0.9, z: -0.9 };
        const to = seatPose(target, seat);
        const pts = route(spaces, from, to);
        expect(pts[0]).toEqual(from);
        expect(pts[pts.length - 1]).toEqual({ x: to.x, z: to.z });
        for (let i = 1; i < pts.length; i++) expect(crossesWall(spaces, pts[i - 1]!, pts[i]!)).toBe(false);
      }
    }
  });

  it("stays on the walkway inside a room (never cuts over the central desks)", () => {
    const pod = byId("pod-a");
    const pts = route(spaces, seatPose(pod, 0), seatPose(pod, 3));
    for (const p of pts.slice(1, -1)) expect(Math.hypot(p.x - pod.x, p.z - pod.z)).toBeCloseTo(WALK_R, 5);
  });

  it("stays inside the honeycomb", () => {
    const pts = route(spaces, seatPose(byId("pod-a"), 0), seatPose(byId("lounge"), 1));
    for (const p of pts) expect(Math.hypot(p.x, p.z)).toBeLessThan(HEX_R * 6);
  });
});

describe("layoutFor", () => {
  it("puts the manager at home in the office and workers at their desks", () => {
    const l = layoutFor([manager, w(1)]);
    expect(l.poses[manager.id]!.space).toBe("office");
    expect(l.poses["w_00000001"]).toMatchObject({ space: "pod-a", seat: 0 });
    expect(l.next).toEqual({ space: "pod-a", seat: 1 });
  });
});
