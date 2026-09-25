import { describe, it, expect } from "vitest";
import { defaultAgent, planOffice, type Agent } from "@agenticview/shared";
import { officeTools, moveWorker, type OfficeToolContext } from "../../src/manager/officeTools.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";

function fakeWorld(agents: Agent[]) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const emitted: Agent[] = [];
  const ctx: OfficeToolContext = {
    registry: {
      list: async () => [...byId.values()],
      update: async (id: string, patch: Partial<Agent>) => {
        const next = { ...byId.get(id)!, ...patch };
        if (patch.placement === undefined && "placement" in patch) delete next.placement;
        byId.set(id, next);
        return next;
      },
    },
    emitAgent: (a) => emitted.push(a),
  };
  return { ctx, byId, emitted };
}

const mk = (i: number) => defaultAgent({ id: `w_${i}`, name: `W${i}`, role: "worker", scope: "project", specialty: "", createdAt: `2026-01-0${i}T00:00:00Z` });

function roster(): Agent[] {
  const m = defaultAgent({ id: "m_1", name: "Atlas", role: "manager", scope: "project", specialty: "manager" });
  const ws = [1, 2, 3].map((i) => mk(i));
  ws[0]!.placement = { space: "pod-a", seat: 0 };
  ws[1]!.placement = { space: "pod-a", seat: 1 };
  return [m, ...ws];
}

describe("office bridge tools", () => {
  it("list_spaces reports seats and occupants through the bridge registry", async () => {
    const { ctx } = fakeWorld(roster());
    const reg = new ToolRegistry();
    const { token } = reg.register("run1", officeTools(ctx));
    expect(reg.describe("run1", token).map((t) => t.name)).toEqual(["list_spaces", "move_worker", "arrange_workers"]);
    const rows = JSON.parse(await reg.call("run1", token, "list_spaces", {})) as { id: string; seats: { seat: number; name?: string; free?: boolean }[] }[];
    const podA = rows.find((r) => r.id === "pod-a")!;
    expect(podA.seats.map((s) => s.name ?? "free")).toEqual(["W1", "W2", "W3", "free"]);
    expect(rows.some((r) => r.id === "meeting")).toBe(true);
    expect(rows.some((r) => r.id === "office")).toBe(false);
  });

  it("move_worker persists the placement and broadcasts it", async () => {
    const { ctx, byId, emitted } = fakeWorld(roster());
    const reg = new ToolRegistry();
    const { token } = reg.register("run1", officeTools(ctx));
    const out = await reg.call("run1", token, "move_worker", { agent: "W3", space: "Meeting Room" });
    expect(out).toBe("Moved W3 to Meeting Room seat 0");
    expect(byId.get("w_3")!.placement).toEqual({ space: "meeting", seat: 0 });
    expect(emitted.map((a) => a.id)).toEqual(["w_3"]);
  });

  it("swaps desks when the target seat is taken", async () => {
    const { ctx, byId } = fakeWorld(roster());
    const out = await moveWorker(ctx, "w_3", "pod-a", 0);
    expect(out).toMatch(/W1 swapped to pod-a seat 2/);
    expect(byId.get("w_3")!.placement).toEqual({ space: "pod-a", seat: 0 });
    expect(byId.get("w_1")!.placement).toEqual({ space: "pod-a", seat: 2 });
    const plan = planOffice([...byId.values()]);
    const seats = Object.values(plan.placements).map((p) => `${p.space}#${p.seat}`);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it("rejects unknown workers, unknown spaces and bad seats", async () => {
    const { ctx } = fakeWorld(roster());
    expect(await moveWorker(ctx, "nobody", "pod-a")).toMatch(/^ERROR: unknown worker/);
    expect(await moveWorker(ctx, "W1", "roof")).toMatch(/^ERROR: unknown space roof/);
    expect(await moveWorker(ctx, "W1", "pod-b", 9)).toMatch(/^ERROR: Pod B has seats 0-3/);
    expect(await moveWorker(ctx, "Atlas", "pod-b")).toMatch(/^ERROR: unknown worker/);
  });

  it("pins auto-seated workers before a move so nobody else shifts", async () => {
    const { ctx, byId, emitted } = fakeWorld(roster());
    ctx.registry.pinPlacements = async () => {
      const all = await ctx.registry.list();
      const { placements } = planOffice(all);
      const out: Agent[] = [];
      for (const a of all) if (a.role === "worker" && !a.placement) out.push(await ctx.registry.update(a.id, { placement: placements[a.id] }));
      return out;
    };
    // W3 is auto-seated at pod-a#2. Moving W1 out frees pod-a#0, which would otherwise pull W3 forward.
    await moveWorker(ctx, "W1", "lounge");
    expect(byId.get("w_3")!.placement).toEqual({ space: "pod-a", seat: 2 });
    expect(planOffice([...byId.values()]).placements["w_3"]).toEqual({ space: "pod-a", seat: 2 });
    expect(emitted.map((a) => a.id)).toEqual(["w_3", "w_1"]);
  });

  it("arrange_workers applies several moves in order", async () => {
    const { ctx, byId } = fakeWorld(roster());
    const tools = officeTools(ctx);
    const out = await tools.find((t) => t.name === "arrange_workers")!.handler({ moves: [{ agent: "W1", space: "pod-b" }, { agent: "W2", space: "pod-b" }] });
    expect(out.split("\n")).toHaveLength(2);
    expect(byId.get("w_1")!.placement).toEqual({ space: "pod-b", seat: 0 });
    expect(byId.get("w_2")!.placement).toEqual({ space: "pod-b", seat: 1 });
  });
});
