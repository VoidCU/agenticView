import { describe, it, expect } from "vitest";
import { defaultAgent, planOffice, type Agent } from "@agenticview/shared";
import { moveWorker, seatWorker, officeTools, type OfficeToolContext } from "../../src/manager/officeTools.js";

/** A fake registry that enforces the workSeat invariant after EVERY write, like the real one does. */
function fakeWorld(agents: Agent[]) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const emitted: Agent[] = [];
  const violations: string[] = [];
  const ctx: OfficeToolContext = {
    registry: {
      list: async () => [...byId.values()],
      update: async (id: string, patch: Partial<Agent>) => {
        const next = { ...byId.get(id)!, ...patch };
        for (const k of ["placement", "workSeat"] as const) if (k in patch && patch[k] === undefined) delete next[k];
        byId.set(id, next);
        const desks = [...byId.values()].filter((a) => a.workSeat).map((a) => `${a.workSeat!.space}#${a.workSeat!.seat}`);
        if (new Set(desks).size !== desks.length) violations.push(`after updating ${id}: ${desks.join(",")}`);
        return next;
      },
    },
    emitAgent: (a) => emitted.push(a),
  };
  return { ctx, byId, emitted, violations };
}

const mk = (i: number, desk?: number, sits?: number) => {
  const a = defaultAgent({ id: `w_${i}`, name: `W${i}`, role: "worker", scope: "project", specialty: "", createdAt: `2026-01-0${i}T00:00:00Z` });
  if (desk !== undefined) a.workSeat = { space: "pod-a", seat: desk };
  if (sits !== undefined) a.placement = { space: "pod-a", seat: sits };
  return a;
};
const manager = () => defaultAgent({ id: "m_1", name: "Atlas", role: "manager", scope: "project", specialty: "manager" });

describe("move_worker owns the designated desk (workSeat)", () => {
  it("sets workSeat and placement together", async () => {
    const { ctx, byId } = fakeWorld([manager(), mk(1, 0, 0)]);
    expect(await moveWorker(ctx, "W1", "pod-b", 3)).toBe("Moved W1 to Pod B seat 3 (its designated desk)");
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-b", seat: 3 });
    expect(byId.get("w_1")!.placement).toEqual({ space: "pod-b", seat: 3 });
  });

  it("without a seat picks the first desk nobody owns, skipping a designated but empty one", async () => {
    // W1 owns pod-a#0 but is idle in pod-b; pod-a#1 is W2's.
    const w1 = mk(1, 0);
    w1.placement = { space: "pod-b", seat: 5 };
    const { ctx, byId } = fakeWorld([manager(), w1, mk(2, 1, 1), mk(3, 2, 2)]);
    await moveWorker(ctx, "W3", "pod-a");
    expect(byId.get("w_3")!.workSeat).toEqual({ space: "pod-a", seat: 2 });
    await moveWorker(ctx, "W3", "Pod A");
    expect(byId.get("w_3")!.workSeat).toEqual({ space: "pod-a", seat: 2 });
    const { ctx: ctx2, byId: byId2 } = fakeWorld([manager(), w1, mk(2, 1, 1), mk(3, 4, 4)]);
    await moveWorker(ctx2, "W3", "pod-a");
    expect(byId2.get("w_3")!.workSeat).toEqual({ space: "pod-a", seat: 2 });
  });

  it("swaps designated desks with the owner, never sharing one at any point", async () => {
    const { ctx, byId, violations } = fakeWorld([manager(), mk(1, 0, 0), mk(2, 1, 1), mk(3, 2, 2)]);
    const out = await moveWorker(ctx, "W3", "pod-a", 0);
    expect(out).toMatch(/^Moved W3 to Pod A seat 0 \(its designated desk\); W1 swapped to Seat 2 in Pod A/);
    expect(byId.get("w_3")!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 2 });
    // W1 was sitting at its old desk: it walks to its new one, W3 sits at pod-a#0.
    expect(byId.get("w_1")!.placement).toEqual({ space: "pod-a", seat: 2 });
    expect(byId.get("w_3")!.placement).toEqual({ space: "pod-a", seat: 0 });
    expect(violations).toEqual([]);
    const seats = Object.values(planOffice([...byId.values()]).placements).map((p) => `${p.space}#${p.seat}`);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it("a swap leaves an owner who is idle elsewhere where it is (only its designated desk changes)", async () => {
    const w1 = mk(1, 0);
    w1.placement = { space: "pod-b", seat: 4 };
    const { ctx, byId, violations } = fakeWorld([manager(), w1, mk(2, 1, 1)]);
    await moveWorker(ctx, "W2", "pod-a", 0);
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 1 });
    expect(byId.get("w_1")!.placement).toEqual({ space: "pod-b", seat: 4 });
    expect(violations).toEqual([]);
  });

  it("refuses when the mover has no desk to swap, with a clear message", async () => {
    const { ctx, byId } = fakeWorld([manager(), mk(1, 0, 0), mk(2)]);
    const out = await moveWorker(ctx, "W2", "pod-a", 0);
    expect(out).toBe("ERROR: Seat 0 in Pod A is W1's designated desk and W2 has no desk to swap; move W1 first");
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    expect(byId.get("w_2")!.workSeat).toBeUndefined();
  });

  it("refuses a space whose every desk is designated unless a seat is named", async () => {
    const ws = [0, 1, 2, 3].map((n) => ({ ...mk(n + 1), workSeat: { space: "pod-b", seat: n }, placement: { space: "pod-b", seat: n } }));
    const podFull = [...ws, { ...mk(5), workSeat: { space: "pod-b", seat: 4 } }, { ...mk(6), workSeat: { space: "pod-b", seat: 5 } }, mk(7, 0, 0)];
    const { ctx } = fakeWorld([manager(), ...podFull]);
    expect(await moveWorker(ctx, "W7", "pod-b")).toMatch(/^ERROR: every desk in Pod B is someone's designated desk/);
  });

  it("a move to the meeting room or lounge is a temporary seat: the designated desk never changes", async () => {
    const { ctx, byId, violations } = fakeWorld([manager(), mk(1, 0, 0), mk(2, 1, 1)]);
    const out = await moveWorker(ctx, "W1", "Meeting Room", 2);
    expect(out).toBe("Moved W1 to Meeting Room seat 2 (temporary seat: Meeting Room has no work desks, so W1's designated desk is unchanged)");
    expect(byId.get("w_1")!.placement).toEqual({ space: "meeting", seat: 2 });
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    await moveWorker(ctx, "W2", "lounge");
    expect(byId.get("w_2")!.placement?.space).toBe("lounge");
    expect(byId.get("w_2")!.workSeat).toEqual({ space: "pod-a", seat: 1 });
    // arrange_workers follows the same rule per move.
    const tool = officeTools(ctx).find((t) => t.name === "arrange_workers")!;
    await tool.handler({ moves: [{ agent: "W1", space: "lounge" }, { agent: "W2", space: "pod-b", seat: 4 }] });
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    expect(byId.get("w_2")!.workSeat).toEqual({ space: "pod-b", seat: 4 });
    expect(violations).toEqual([]);
  });

  it("a worker without a desk moved to the lounge still has none", async () => {
    const { ctx, byId } = fakeWorld([manager(), mk(1, 0, 0), mk(2)]);
    await moveWorker(ctx, "W2", "lounge");
    expect(byId.get("w_2")!.workSeat).toBeUndefined();
  });

  it("move_worker and arrange_workers tool descriptions say meeting room / lounge seats are temporary", () => {
    const { ctx } = fakeWorld([manager()]);
    const tools = officeTools(ctx);
    for (const name of ["move_worker", "arrange_workers"]) {
      expect(tools.find((t) => t.name === name)!.description).toMatch(/meeting room or lounge .*temporary seat/);
    }
  });

  it("arrange_workers applies several owner moves without duplicates", async () => {
    const { ctx, byId, violations } = fakeWorld([manager(), mk(1, 0, 0), mk(2, 1, 1), mk(3, 2, 2)]);
    const tool = officeTools(ctx).find((t) => t.name === "arrange_workers")!;
    await tool.handler({ moves: [{ agent: "W1", space: "pod-a", seat: 1 }, { agent: "W3", space: "pod-b" }] });
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 1 });
    expect(byId.get("w_2")!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    expect(byId.get("w_3")!.workSeat).toEqual({ space: "pod-b", seat: 0 });
    expect(violations).toEqual([]);
  });

  it("list_spaces shows whose designated desk each seat is", async () => {
    const w1 = mk(1, 0);
    w1.placement = { space: "pod-b", seat: 0 };
    const { ctx } = fakeWorld([manager(), w1]);
    const rows = JSON.parse(await officeTools(ctx).find((t) => t.name === "list_spaces")!.handler({})) as { id: string; seats: { seat: number; free?: boolean; designatedFor?: string }[] }[];
    expect(rows.find((r) => r.id === "pod-a")!.seats[0]).toEqual({ seat: 0, free: true, designatedFor: "W1" });
  });

  it("seatWorker (brainstorm) moves the seat but never the designated desk", async () => {
    const { ctx, byId } = fakeWorld([manager(), mk(1, 0, 0), mk(2, 1, 1)]);
    await seatWorker(ctx, "W1", "meeting", 0);
    expect(byId.get("w_1")!.placement).toEqual({ space: "meeting", seat: 0 });
    expect(byId.get("w_1")!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    await seatWorker(ctx, "W1", "pod-a", 0);
    expect(byId.get("w_1")!.placement).toEqual({ space: "pod-a", seat: 0 });
    expect(byId.get("w_2")!.workSeat).toEqual({ space: "pod-a", seat: 1 });
  });
});
