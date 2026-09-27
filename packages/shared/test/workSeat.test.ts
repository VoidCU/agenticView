import { describe, it, expect } from "vitest";
import {
  AgentPatchSchema,
  AgentSchema,
  TaskSchema,
  buildSpacesFromLayout,
  defaultAgent,
  defaultLayout,
  describeWorkSeatMoves,
  designatedSeats,
  DESK_KINDS,
  isDeskKind,
  SPACE_KINDS,
  freeDeskFor,
  migrateWorkSeats,
  nextPlacement,
  planOffice,
  type Agent,
  type Placement,
} from "../src/index.js";

const at = (space: string, seat: number): Placement => ({ space, seat });
const w = (i: number, extra: Partial<Agent> = {}): Agent => ({
  ...defaultAgent({ id: `w_${i}`, name: `W${i}`, role: "worker", scope: "project", specialty: "", createdAt: `2026-01-${String(i).padStart(2, "0")}T00:00:00Z` }),
  ...extra,
});
const spaces = buildSpacesFromLayout(defaultLayout(6));
const keys = (r: Record<string, Placement>) => Object.values(r).map((p) => `${p.space}#${p.seat}`);

describe("Agent.workSeat schema", () => {
  it("is optional so older agent JSON loads, and round-trips when present", () => {
    const old = JSON.parse(JSON.stringify(w(1, { placement: at("pod-a", 0) })));
    delete old.workSeat;
    expect(AgentSchema.parse(old).workSeat).toBeUndefined();
    expect(AgentSchema.parse({ ...old, workSeat: at("pod-b", 2) }).workSeat).toEqual(at("pod-b", 2));
    expect(() => AgentSchema.parse({ ...old, workSeat: { space: "", seat: 0 } })).toThrow();
  });

  it("is not patchable by clients (a placement patch is the owner move)", () => {
    const patch = AgentPatchSchema.parse({ workSeat: at("pod-a", 1), placement: at("pod-a", 2) });
    expect(patch).toEqual({ placement: at("pod-a", 2) });
  });

  it("Task.meeting is optional", () => {
    const base = { id: "t", kind: "work", title: "x", description: "", status: "queued", createdBy: "m", assigneeId: "w", projectPath: "/p", images: [], log: [], createdAt: "2026-01-01T00:00:00Z" };
    expect(TaskSchema.parse(base).meeting).toBeUndefined();
    expect(TaskSchema.parse({ ...base, meeting: true }).meeting).toBe(true);
  });
});

describe("migrateWorkSeats", () => {
  it("adopts every worker's current placement on an older office", () => {
    const m = migrateWorkSeats([w(1, { placement: at("pod-a", 3) }), w(2, { placement: at("pod-b", 0) })], spaces);
    expect(m.workSeats).toEqual({ w_1: at("pod-a", 3), w_2: at("pod-b", 0) });
    expect(m.moves.map((x) => x.reason)).toEqual(["adopted", "adopted"]);
    expect(describeWorkSeatMoves(m.moves)).toEqual(["W1: adopted pod-a#3 -> pod-a#3", "W2: adopted pod-b#0 -> pod-b#0"]);
    expect(m.changed).toBe(true);
  });

  it("resolves duplicates: the earlier agent keeps the desk, the later one gets a free desk in the same pod", () => {
    const agents = [
      w(2, { placement: at("pod-a", 1), workSeat: at("pod-a", 1) }),
      w(1, { placement: at("pod-b", 0), workSeat: at("pod-b", 0) }),
      w(3, { placement: at("pod-a", 1), workSeat: at("pod-a", 1) }),
      w(4, { placement: at("pod-a", 1) }),
    ];
    const m = migrateWorkSeats(agents, spaces);
    expect(m.workSeats.w_2).toEqual(at("pod-a", 1));
    expect(m.workSeats.w_3).toEqual(at("pod-a", 0));
    expect(m.workSeats.w_4).toEqual(at("pod-a", 2));
    expect(new Set(keys(m.workSeats)).size).toBe(4);
    expect(m.moves.map((x) => [x.agentId, x.reason])).toEqual([["w_3", "duplicate"], ["w_4", "duplicate"]]);
  });

  it("an existing workSeat wins over another worker's placement", () => {
    const m = migrateWorkSeats([w(1, { placement: at("pod-a", 0) }), w(2, { placement: at("pod-b", 0), workSeat: at("pod-a", 0) })], spaces);
    expect(m.workSeats.w_2).toEqual(at("pod-a", 0));
    expect(m.workSeats.w_1).toEqual(at("pod-a", 1));
  });

  it("remaps seats that no longer exist and workers with no seat at all", () => {
    const m = migrateWorkSeats([w(1, { workSeat: at("pod-z", 0), placement: at("pod-z", 0) }), w(2), w(3, { workSeat: at("pod-a", 9) })], spaces);
    expect(m.moves.map((x) => x.reason)).toEqual(["missing", "missing", "missing"]);
    expect(new Set(keys(m.workSeats)).size).toBe(3);
    for (const p of Object.values(m.workSeats)) expect(p.space.startsWith("pod-")).toBe(true);
  });

  it("an invalid workSeat falls back to the worker's current desk when free", () => {
    const m = migrateWorkSeats([w(1, { workSeat: at("pod-z", 0), placement: at("pod-b", 4) })], spaces);
    expect(m.workSeats.w_1).toEqual(at("pod-b", 4));
    expect(m.moves[0]).toMatchObject({ reason: "missing", from: at("pod-z", 0), to: at("pod-b", 4) });
  });

  it("is idempotent", () => {
    const agents = [w(1, { placement: at("pod-a", 1) }), w(2, { placement: at("pod-a", 1), workSeat: at("pod-a", 1) }), w(3)];
    const first = migrateWorkSeats(agents, spaces);
    const applied = agents.map((a) => ({ ...a, workSeat: first.workSeats[a.id] }));
    const second = migrateWorkSeats(applied, spaces);
    expect(second.changed).toBe(false);
    expect(second.moves).toEqual([]);
    expect(second.workSeats).toEqual(first.workSeats);
  });

  it("reports workers no desk is left for", () => {
    const tiny = spaces.filter((s) => s.id === "pod-a");
    const agents = Array.from({ length: 7 }, (_, i) => w(i + 1));
    const m = migrateWorkSeats(agents, tiny);
    expect(Object.keys(m.workSeats)).toHaveLength(6);
    expect(m.unseated).toEqual(["w_7"]);
  });

  it("only work rooms hold designated desks: meeting room / lounge seats are neither kept nor adopted", () => {
    const m = migrateWorkSeats([
      w(1, { workSeat: at("meeting", 0), placement: at("meeting", 0) }),
      w(2, { placement: at("lounge", 1) }),
      w(3, { workSeat: at("research", 1) }),
      w(4, { workSeat: at("production", 0) }),
    ], spaces);
    expect(m.workSeats.w_1!.space).toBe("pod-a");
    expect(m.workSeats.w_2!.space).toBe("pod-a");
    expect(m.workSeats.w_3).toEqual(at("research", 1));
    expect(m.workSeats.w_4).toEqual(at("production", 0));
    expect(m.moves.map((x) => [x.agentId, x.reason])).toEqual([["w_1", "missing"], ["w_2", "missing"]]);
    for (const seat of Object.values(m.workSeats)) expect(isDeskKind(spaces.find((sp) => sp.id === seat.space)!.kind)).toBe(true);
  });

  it("never falls back to a meeting room or lounge seat when work desks run out", () => {
    const noDesks = spaces.filter((s) => s.kind === "meeting" || s.kind === "lounge");
    const m = migrateWorkSeats([w(1), w(2, { placement: at("meeting", 0) })], noDesks);
    expect(m.workSeats).toEqual({});
    expect(m.unseated).toEqual(["w_1", "w_2"]);
  });
});

describe("desk kinds", () => {
  it("pods, the Production Room and the Research Room are work rooms; nothing else is", () => {
    expect([...DESK_KINDS].sort()).toEqual(["pod", "production", "research"]);
    expect(SPACE_KINDS.filter(isDeskKind).sort()).toEqual(["pod", "production", "research"]);
  });
});

describe("seating respects designated desks", () => {
  it("auto-seating and nextPlacement keep off other workers' designated desks", () => {
    const owner = w(1, { workSeat: at("pod-a", 0), placement: at("pod-b", 3) });
    const plan = planOffice([owner, w(2)], defaultLayout(2));
    expect(plan.placements.w_2).toEqual(at("pod-a", 1));
    expect(nextPlacement([owner], defaultLayout(2))).toEqual(at("pod-a", 1));
  });

  it("an unplaced worker is seated at its own workSeat", () => {
    const plan = planOffice([w(1, { workSeat: at("pod-b", 2) })], defaultLayout(1));
    expect(plan.placements.w_1).toEqual(at("pod-b", 2));
  });

  it("freeDeskFor: own workSeat first, then a free desk nobody owns, then any free desk", () => {
    const seats = [0, 1, 2].map((n) => at("pod-a", n));
    const a = w(1, { workSeat: at("pod-a", 2) });
    const b = w(2, { workSeat: at("pod-a", 1) });
    expect(freeDeskFor("w_1", seats, { w_9: at("pod-a", 0) }, [a, b])).toEqual(at("pod-a", 2));
    expect(freeDeskFor("w_1", seats, { w_9: at("pod-a", 0), w_3: at("pod-a", 2) }, [a, b])).toEqual(at("pod-a", 1));
    const c = w(3);
    expect(freeDeskFor("w_3", seats, { w_2: at("pod-a", 0) }, [a, b, c])).toEqual(at("pod-a", 1));
    expect(freeDeskFor("w_3", seats, { w_1: at("pod-a", 0), w_2: at("pod-a", 1), w_4: at("pod-a", 2) }, [a, b, c])).toBeUndefined();
  });

  it("designatedSeats maps desks to their owners", () => {
    const m = designatedSeats([w(1, { workSeat: at("pod-a", 0) }), w(2)], undefined);
    expect([...m.keys()]).toEqual(["pod-a#0"]);
    expect(designatedSeats([w(1, { workSeat: at("pod-a", 0) })], "w_1").size).toBe(0);
  });
});
