import { describe, expect, it } from "vitest";
import { seatPose, type Agent, type Task } from "@agenticview/shared";
import { SEATED_LIFT, layoutFor } from "../src/scene/layout";
import { computeTargets, workSeatTarget, workingAgentIds } from "../src/scene/targets";
import { agent, manager } from "./fixtures";

const NOW = Date.parse("2026-09-27T10:00:00.000Z");
const w = (i: number, over: Partial<Agent> = {}) =>
  agent({ id: `w_${String(i).padStart(8, "0")}`, name: `W${i}`, createdAt: `2026-09-25T00:00:${String(i).padStart(2, "0")}.000Z`, ...over });
const task = (assigneeId: string, status: Task["status"], meeting?: boolean): Task => ({
  id: `t_${assigneeId}_${status}`, kind: "work", title: "x", description: "", status, createdBy: manager.id, assigneeId,
  projectPath: "/p", images: [], log: [], createdAt: "2026-09-27T09:00:00.000Z", ...(meeting ? { meeting } : {}),
});

function targetsFor(list: Agent[], working: Set<string>) {
  const layout = layoutFor(list);
  const lounge = layout.spaces.find((s) => s.kind === "lounge");
  return { layout, ...computeTargets({ layout, list, lounge, loungeBreaks: new Map(), prevLoungeAssign: {}, managerId: manager.id, working, now: NOW }) };
}

describe("working agents target their designated desk (workSeat)", () => {
  it("workingAgentIds: assigned / running / waiting desk work, not queued, finished or brainstorm tasks", () => {
    const ids = workingAgentIds([task("a", "running"), task("b", "waiting"), task("c", "assigned"), task("d", "queued"), task("e", "done"), task("f", "running", true)]);
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });

  it("a working agent seated elsewhere (or with a stale lounging / visiting copy) walks to its workSeat", () => {
    const desk = { space: "pod-a", seat: 3 };
    const a = w(1, { workSeat: desk, placement: { space: "pod-b", seat: 0 }, lounging: true });
    const b = w(2, { workSeat: { space: "pod-a", seat: 4 }, placement: { space: "pod-a", seat: 4 }, visiting: { spaceId: "meeting", until: new Date(NOW + 60_000).toISOString() } });
    const { layout, targets } = targetsFor([manager, a, b], new Set([a.id, b.id]));
    const pod = layout.spaces.find((s) => s.id === "pod-a")!;
    const p = seatPose(pod, 3);
    expect(targets[a.id]).toEqual({ x: p.x, z: p.z, yaw: p.yaw, yOffset: SEATED_LIFT });
    const q = seatPose(pod, 4);
    expect(targets[b.id]).toMatchObject({ x: q.x, z: q.z });
  });

  it("an idle agent keeps wandering: no workSeat override", () => {
    const a = w(1, { workSeat: { space: "pod-a", seat: 3 }, placement: { space: "pod-b", seat: 0 } });
    const { layout, targets } = targetsFor([manager, a], new Set());
    expect(targets[a.id]).toMatchObject({ x: layout.poses[a.id]!.x, z: layout.poses[a.id]!.z });
  });

  it("brainstorm: an agent busy only with meeting work stays at its Meeting Room seat", () => {
    const a = w(1, { workSeat: { space: "pod-a", seat: 3 }, placement: { space: "meeting", seat: 1 } });
    const working = workingAgentIds([task(a.id, "running", true)]);
    const { layout, targets } = targetsFor([manager, a], working);
    const meeting = layout.spaces.find((s) => s.id === "meeting")!;
    expect(targets[a.id]).toMatchObject({ x: seatPose(meeting, 1).x, z: seatPose(meeting, 1).z });
  });

  it("workSeatTarget ignores a desk that no longer exists", () => {
    const { layout } = targetsFor([manager], new Set());
    expect(workSeatTarget(w(1, { workSeat: { space: "pod-z", seat: 0 } }), layout.spaces)).toBeUndefined();
    expect(workSeatTarget(w(1), layout.spaces)).toBeUndefined();
  });
});
