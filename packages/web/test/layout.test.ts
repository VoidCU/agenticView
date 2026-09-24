import { describe, expect, it } from "vitest";
import { layoutFor, nextDeskFor } from "../src/scene/layout";
import { agent, manager } from "./fixtures";

const w = (i: number, scope: "project" | "global" = "project") => agent({ id: `w_0000000${i}`, name: `W${i}`, scope });

describe("layoutFor", () => {
  it("puts the manager on the podium at the origin", () => {
    const l = layoutFor([manager]);
    expect(l[manager.id]).toEqual({ x: 0, z: 0, zone: "podium" });
  });

  it("places 3 project workers 120 degrees apart on a ring of radius 5.2 starting at -90 degrees", () => {
    const l = layoutFor([manager, w(1), w(2), w(3)]);
    const r = 4 + 0.4 * 3;
    expect(r).toBeCloseTo(5.2);
    const p1 = l["w_00000001"]!;
    const p2 = l["w_00000002"]!;
    const p3 = l["w_00000003"]!;
    expect(p1.zone).toBe("desk");
    expect(p1.x).toBeCloseTo(0, 5);
    expect(p1.z).toBeCloseTo(-5.2, 5);
    expect(p2.x).toBeCloseTo(5.2 * Math.cos(Math.PI / 6), 5);
    expect(p2.z).toBeCloseTo(5.2 * Math.sin(Math.PI / 6), 5);
    expect(p3.x).toBeCloseTo(-5.2 * Math.cos(Math.PI / 6), 5);
    expect(p3.z).toBeCloseTo(5.2 * Math.sin(Math.PI / 6), 5);
    for (const p of [p1, p2, p3]) expect(Math.hypot(p.x, p.z)).toBeCloseTo(5.2, 5);
  });

  it("puts 2 global workers on the lobby row at z=-9, x=+-1.1", () => {
    const l = layoutFor([manager, w(1, "global"), w(2, "global")]);
    expect(l["w_00000001"]).toEqual({ x: -1.1, z: -9, zone: "lobby" });
    expect(l["w_00000002"]).toEqual({ x: 1.1, z: -9, zone: "lobby" });
  });

  it("nextDeskFor returns the ring slot a new worker would take", () => {
    const next = nextDeskFor([manager, w(1)]);
    const r = 4 + 0.4 * 2;
    expect(next.x).toBeCloseTo(r * Math.cos(-Math.PI / 2 + Math.PI), 5);
    expect(next.z).toBeCloseTo(r * Math.sin(-Math.PI / 2 + Math.PI), 5);
  });
});
