import { describe, expect, it } from "vitest";
import { route, seatPose, spaceAt, type Agent } from "@agenticview/shared";
import { awaySeatSignature, layoutFor } from "../src/scene/layout";
import { computeTargets, isVisiting, nextVisitExpiry, visitTarget } from "../src/scene/targets";
import { whiteboardPose } from "../src/scene/Whiteboard";
import { agent, manager } from "./fixtures";

const NOW = Date.parse("2026-09-27T10:00:00.000Z");
const later = new Date(NOW + 30_000).toISOString();
const earlier = new Date(NOW - 1_000).toISOString();

const w = (i: number, over: Partial<Agent> = {}) =>
  agent({ id: `w_${String(i).padStart(8, "0")}`, name: `W${i}`, createdAt: `2026-09-25T00:00:${String(i).padStart(2, "0")}.000Z`, ...over });

function targetsFor(list: Agent[], prevLoungeAssign: Record<string, string> = {}) {
  const layout = layoutFor(list);
  const lounge = layout.spaces.find((s) => s.kind === "lounge");
  return { layout, ...computeTargets({ layout, list, lounge, loungeBreaks: new Map(), prevLoungeAssign, managerId: manager.id, now: NOW }) };
}

describe("idle visits (agent.visiting)", () => {
  it("a colleague visit stands beside the colleague's desk, facing them, and keeps the visitor's own placement", () => {
    const host = w(1);
    const guest = w(2, { visiting: { targetAgentId: host.id, until: later } });
    const { layout, targets } = targetsFor([manager, host, guest]);
    const t = targets[guest.id]!;
    const own = layout.poses[guest.id]!;
    const hostPose = layout.poses[host.id]!;
    expect(Math.hypot(t.x - own.x, t.z - own.z)).toBeGreaterThan(0.3);
    const d = Math.hypot(t.x - hostPose.x, t.z - hostPose.z);
    expect(d).toBeGreaterThan(0.6);
    expect(d).toBeLessThan(1.6);
    // Facing the colleague.
    expect(Math.atan2(hostPose.x - t.x, hostPose.z - t.z)).toBeCloseTo(t.yaw, 5);
    expect(t.yOffset).toBe(0);
    // Placement untouched: the visitor still owns its seat.
    expect(layout.placements[guest.id]).toBeDefined();
    // Reachable through doorways.
    const path = route(layout.spaces, own, t);
    expect(path.at(-1)!.x).toBeCloseTo(t.x, 5);
  });

  it("a whiteboard visit stands in front of the room board, inside the room, facing it", () => {
    const guest = w(1);
    const { layout } = targetsFor([manager, guest]);
    const pod = layout.spaces.find((s) => s.kind === "pod")!;
    const visiting = { ...guest, visiting: { spaceId: pod.id, until: later } };
    const { targets } = targetsFor([manager, visiting]);
    const t = targets[guest.id]!;
    const b = whiteboardPose(pod);
    expect(spaceAt(layout.spaces, t.x, t.z)?.id).toBe(pod.id);
    expect(Math.hypot(t.x - b.x, t.z - b.z)).toBeCloseTo(1.4, 5);
    expect(Math.atan2(b.x - t.x, b.z - t.z)).toBeCloseTo(t.yaw, 5);
  });

  it("two visitors to the same board do not stack", () => {
    const { layout } = targetsFor([manager, w(1), w(2)]);
    const meeting = layout.spaces.find((s) => s.kind === "meeting")!;
    const v = { spaceId: meeting.id, until: later };
    const { targets } = targetsFor([manager, w(1, { visiting: v }), w(2, { visiting: v })]);
    const a = targets[w(1).id]!;
    const b = targets[w(2).id]!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.6);
  });

  it("an expired or empty visit falls back to the agent's desk", () => {
    const host = w(1);
    for (const visiting of [{ targetAgentId: host.id, until: earlier }, { until: later }]) {
      const guest = w(2, { visiting });
      const { layout, targets } = targetsFor([manager, host, guest]);
      expect(targets[guest.id]).toEqual(layout.poses[guest.id]);
      expect(isVisiting(guest, NOW)).toBe(false);
    }
  });

  it("lounging beats visiting; lounges have no board to visit", () => {
    const { layout } = targetsFor([manager, w(1)]);
    const lounge = layout.spaces.find((s) => s.kind === "lounge")!;
    expect(visitTarget(w(1, { visiting: { spaceId: lounge.id, until: later } }), layout)).toBeUndefined();
    const guest = w(1, { lounging: true, visiting: { spaceId: layout.spaces.find((s) => s.kind === "pod")!.id, until: later } });
    const { targets } = targetsFor([manager, guest]);
    expect(spaceAt(layout.spaces, targets[guest.id]!.x, targets[guest.id]!.z)?.kind).toBe("lounge");
  });

  it("nextVisitExpiry returns the earliest future until", () => {
    const soon = new Date(NOW + 5_000).toISOString();
    expect(nextVisitExpiry([w(1, { visiting: { spaceId: "x", until: later } }), w(2, { visiting: { spaceId: "x", until: soon } }), w(3, { visiting: { spaceId: "x", until: earlier } })], NOW)).toBe(NOW + 5_000);
    expect(nextVisitExpiry([w(1)], NOW)).toBeUndefined();
  });

  it("the visitor's chair counts as away while visiting, and while walking back", () => {
    const host = w(1);
    const guest = w(2, { visiting: { targetAgentId: host.id, until: later } });
    const { layout, targets } = targetsFor([manager, host, guest]);
    const key = `${layout.placements[guest.id]!.space}#${layout.placements[guest.id]!.seat}`;
    expect(awaySeatSignature(layout, targets).split(",")).toContain(key);
    // Visit over: target is the seat again, but the robot is still two metres away.
    const home = targetsFor([manager, host, w(2)]);
    expect(awaySeatSignature(home.layout, home.targets).split(",")).not.toContain(key);
    const seat = home.layout.poses[guest.id]!;
    const live = new Map([[guest.id, { x: seat.x + 2, z: seat.z }]]);
    expect(awaySeatSignature(home.layout, home.targets, live).split(",")).toContain(key);
    live.set(guest.id, { x: seat.x, z: seat.z });
    expect(awaySeatSignature(home.layout, home.targets, live).split(",")).not.toContain(key);
  });
});

describe("lounge exit with a new placement", () => {
  it("the target moves from the lounge spot to the NEW seat (the robot routes there, it is not re-spawned)", () => {
    const a = w(1, { placement: { space: "pod-a", seat: 0 }, lounging: true });
    const first = targetsFor([manager, a, w(2)]);
    const inLounge = first.targets[a.id]!;
    expect(spaceAt(first.layout.spaces, inLounge.x, inLounge.z)?.kind).toBe("lounge");

    const back = { ...a, lounging: false, placement: { space: "pod-a", seat: 4 } };
    const second = targetsFor([manager, back, w(2)], first.loungeAssign);
    const pod = second.layout.spaces.find((s) => s.id === "pod-a")!;
    const seat = seatPose(pod, 4);
    expect(second.targets[a.id]!.x).toBeCloseTo(seat.x, 5);
    expect(second.targets[a.id]!.z).toBeCloseTo(seat.z, 5);
    // A path exists from the lounge spot to the new seat through doorways.
    const path = route(second.layout.spaces, inLounge, second.targets[a.id]!);
    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)!.x).toBeCloseTo(seat.x, 5);
    // The lounge assignment is dropped for the returning agent.
    expect(second.loungeAssign[a.id]).toBeUndefined();
  });
});
