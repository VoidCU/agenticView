import { describe, expect, it } from "vitest";
import { buildSpaces, managerHome, seatLocal } from "@agenticview/shared";
import { AWAY_CHAIR_SWIVEL, CHAIR_SEAT_TOP, Kit, MANAGER_DESK_CLEARANCE, SEATED_CHAIR_BACK, furnishSpace } from "../src/scene/kit";
import { ROBOT_SEAT_CONTACT, SEATED_LIFT, awaySeatSignature, layoutFor } from "../src/scene/layout";
import { ROBOT_SCALE } from "../src/scene/Robot";
import { manager, worker } from "./fixtures";

const ROBOT_BODY_R = 0.6 * ROBOT_SCALE;

describe("seated robots sit on the chair", () => {
  it("rest height puts the robot's underside on the chair seat, not the floor", () => {
    // Robot underside: tilt 0.05 + skirt bottom 0.26 (local) scaled, same as the body sphere bottom.
    const underside = (0.05 + 0.26) * ROBOT_SCALE;
    expect(SEATED_LIFT).toBeGreaterThan(0.25);
    expect(SEATED_LIFT + underside).toBeGreaterThanOrEqual(CHAIR_SEAT_TOP - 0.04);
    expect(SEATED_LIFT + underside).toBeLessThanOrEqual(CHAIR_SEAT_TOP + 0.04);
    expect(SEATED_LIFT).toBeCloseTo(CHAIR_SEAT_TOP - ROBOT_SEAT_CONTACT, 9);
  });

  it("desk and manager poses carry the seat lift", () => {
    const l = layoutFor([manager, worker]);
    expect(l.poses[manager.id]!.yOffset).toBe(SEATED_LIFT);
    expect(l.poses[worker.id]!.yOffset).toBe(SEATED_LIFT);
  });

  it("the manager sits back far enough that the body clears the executive desk", () => {
    const office = buildSpaces(1).find((s) => s.kind === "office")!;
    const home = managerHome(office);
    // Desk centre is 0.78 in front of home, 0.95 deep.
    const gap = 0.78 + MANAGER_DESK_CLEARANCE - 0.95 / 2;
    expect(gap).toBeGreaterThanOrEqual(ROBOT_BODY_R);
    const pose = layoutFor([manager]).poses[manager.id]!;
    expect(Math.hypot(pose.x - home.x, pose.z - home.z)).toBeCloseTo(MANAGER_DESK_CLEARANCE, 6);
  });

  it("the chair under a seated robot keeps its backrest clear of the body", () => {
    // Backrest centre is 0.25 behind the chair origin, 0.07 deep.
    expect(SEATED_CHAIR_BACK + 0.25 - 0.035).toBeGreaterThan(ROBOT_BODY_R);
  });
});

describe("away-from-desk chairs", () => {
  const pod = buildSpaces(1).find((s) => s.kind === "pod")!;
  const chairsOf = (away: Set<number>, seats = new Map([[0, "#fff"], [1, "#fff"]])) => {
    const kit = new Kit();
    furnishSpace(kit, { ...pod, x: 0, z: 0 }, { seats, away });
    // One "chair" seat pan per chair.
    return kit.items.filter((it) => it.mat === "chair" && it.sy === 0.08);
  };

  it("draws every chair: empty seats normal, seated owners under them, away owners swivelled", () => {
    const present = chairsOf(new Set());
    expect(present).toHaveLength(pod.seats);
    const away = chairsOf(new Set([1]));
    expect(away).toHaveLength(pod.seats);
    const l = seatLocal("pod", 1);
    const nearSeat1 = (items: typeof away) => items.find((c) => Math.abs(c.x - l.x) < 0.01)!;
    expect(nearSeat1(present).yaw).toBeCloseTo(l.yaw, 6);
    const swivel = nearSeat1(away).yaw - l.yaw;
    expect(Math.abs(swivel)).toBeGreaterThanOrEqual(Math.PI / 4 - 1e-6);
    expect(Math.abs(swivel)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
    expect(AWAY_CHAIR_SWIVEL).toBeCloseTo(swivel, 6);
  });

  it("away signature lists seats whose owner's target is not the desk", () => {
    const l = layoutFor([manager, worker]);
    const atDesk = Object.fromEntries(Object.entries(l.poses).map(([id, p]) => [id, { x: p.x, z: p.z }]));
    expect(awaySeatSignature(l, atDesk)).toBe("");
    const wp = l.poses[worker.id]!;
    const away = awaySeatSignature(l, { ...atDesk, [worker.id]: { x: wp.x + 5, z: wp.z }, [manager.id]: { x: 0, z: 0 } });
    expect(away).toBe(["office#0", `${wp.space}#${wp.seat}`].sort().join(","));
  });
});
