import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_IDLE_BEHAVIOUR, type Placement, type Provider, type ServerMessage } from "@agenticview/shared";
import { IdleBehaviourService, pickOutcome, type IdleOutcome } from "../../src/games/idleBehaviour.js";
import { EventBus } from "../../src/events/bus.js";
import { AgentRegistry } from "../../src/agents/registry.js";
import type { Runtime } from "../../src/runtimes/types.js";

let home: string;
let proj: string;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-idle-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-idle-p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Deterministic seeded RNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A runtime that fails the test if anything ever calls it: idle behaviour must never touch a model. */
function tripwire(): Runtime & { calls: number } {
  const rt = {
    provider: "claude" as Provider,
    calls: 0,
    check: async () => {
      rt.calls++;
      throw new Error("idle behaviour must not call a runtime");
    },
    run: async () => {
      rt.calls++;
      throw new Error("idle behaviour must not call a runtime");
    },
  };
  return rt;
}

const SEATS: Placement[] = [0, 1, 2, 3, 4, 5].map((seat) => ({ space: "pod-a", seat }));

function setup(opts: { rng?: () => number; loungeSpots?: number; seats?: Placement[] } = {}) {
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  const registry = new AgentRegistry({ kind: "project", projectPath: proj });
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const svc = new IdleBehaviourService({
    registry,
    bus,
    settings: () => ({ idleMinutes: 3 }),
    rng: opts.rng ?? seeded(42),
    loungeSpots: () => opts.loungeSpots ?? 16,
    desks: async () => {
      const agents = await registry.list();
      const placements: Record<string, Placement> = {};
      for (const a of agents) if (a.role === "worker" && a.placement) placements[a.id] = a.placement;
      return { seats: opts.seats ?? SEATS, placements };
    },
    whiteboardSpace: () => "meeting",
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { svc, registry, msgs, timers };
}

async function workers(registry: AgentRegistry, n: number, seats: Placement[] = SEATS) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = await registry.create({ name: `W${i}`, specialty: "x" });
    out.push(await registry.update(a.id, { placement: seats[i]! }));
  }
  return out;
}

describe("idle behaviour rolls (server RNG only)", () => {
  it("follows 40 / 25 / 35 over many seeded rolls", () => {
    const rng = seeded(7);
    const counts: Record<IdleOutcome, number> = { stay: 0, visit: 0, lounge: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) counts[pickOutcome(DEFAULT_IDLE_BEHAVIOUR, rng())]++;
    expect(counts.stay / N).toBeCloseTo(0.4, 1);
    expect(counts.visit / N).toBeCloseTo(0.25, 1);
    expect(counts.lounge / N).toBeCloseTo(0.35, 1);
    expect(Math.abs(counts.stay / N - 0.4)).toBeLessThan(0.02);
    expect(Math.abs(counts.visit / N - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(counts.lounge / N - 0.35)).toBeLessThan(0.02);
    // Chances are configurable weights.
    expect(pickOutcome({ stayChance: 0, visitChance: 0, loungeChance: 1 }, 0.01)).toBe("lounge");
    expect(pickOutcome({ stayChance: 0, visitChance: 0, loungeChance: 0 }, 0.5)).toBe("stay");
  });

  it("the service's own rolls follow the distribution too, with nobody in the lounge beyond the cap", async () => {
    const { svc, registry } = setup({ rng: seeded(99), loungeSpots: 1000 });
    const [a] = await workers(registry, 1);
    const counts: Record<IdleOutcome, number> = { stay: 0, visit: 0, lounge: 0 };
    for (let i = 0; i < 150; i++) counts[(await svc.roll(a!.id))!]++;
    expect(counts.stay / 150).toBeGreaterThan(0.28);
    expect(counts.visit / 150).toBeGreaterThan(0.15);
    expect(counts.lounge / 150).toBeGreaterThan(0.23);
    svc.stop();
  }, 60000);

  it("caps the lounge at half its spots", async () => {
    const { svc, registry } = setup({ rng: () => 0.99, loungeSpots: 4 });
    const ws = await workers(registry, 5);
    for (const w of ws) await svc.roll(w.id);
    const lounging = (await registry.list()).filter((a) => a.lounging);
    await expect(svc.loungeCap()).resolves.toBe(2);
    expect(lounging).toHaveLength(2);
    svc.stop();
  });

  it("lounging workers re-roll and sit back down at a free desk (or their own), never a taken one", async () => {
    const seats = SEATS.slice(0, 4);
    let r = 0.99;
    const { svc, registry } = setup({ rng: () => r, seats });
    const [a, b, c] = await workers(registry, 3, seats);
    await svc.roll(a!.id); // lounge
    expect((await registry.get(a!.id))!.lounging).toBe(true);
    // Roll "stay" with a draw that picks the LAST choice: the only free seat (pod-a#3), not its own (#0).
    r = 0.1;
    const rolls = [0.1, 0.99];
    const svc2 = new IdleBehaviourService({
      ...(svc as unknown as { deps: ConstructorParameters<typeof IdleBehaviourService>[0] }).deps,
      rng: () => rolls.shift() ?? 0,
    });
    expect(await svc2.roll(a!.id)).toBe("stay");
    const back = (await registry.get(a!.id))!;
    expect(back.lounging).toBeUndefined();
    expect(back.placement).toEqual({ space: "pod-a", seat: 3 });
    // Nobody shares a seat.
    const keys = (await registry.list()).map((x) => `${x.placement!.space}#${x.placement!.seat}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect((await registry.get(b!.id))!.placement).toEqual({ space: "pod-a", seat: 1 });
    expect((await registry.get(c!.id))!.placement).toEqual({ space: "pod-a", seat: 2 });
    svc.stop();
  });

  it("with every desk taken a worker returns to its own seat", async () => {
    const seats = SEATS.slice(0, 2);
    const { svc, registry } = setup({ rng: () => 0.99, seats });
    const [a] = await workers(registry, 2, seats);
    await registry.update(a!.id, { lounging: true });
    const back = await svc.sitDown((await registry.get(a!.id))!);
    expect(back.placement).toEqual({ space: "pod-a", seat: 0 });
    expect(back.lounging).toBeUndefined();
  });

  it("visits clear themselves, busy workers are never rolled, and nothing calls a runtime", async () => {
    const rt = tripwire();
    const { svc, registry, timers } = setup({ rng: () => 0.5 });
    const [a, b] = await workers(registry, 2);
    expect(await svc.roll(a!.id)).toBe("visit");
    const v = (await registry.get(a!.id))!.visiting!;
    expect(v.targetAgentId === b!.id || v.spaceId === "meeting").toBe(true);
    const visitTimer = timers.find((t) => t.ms === DEFAULT_IDLE_BEHAVIOUR.visitSeconds * 1000)!;
    visitTimer.fn();
    await new Promise((r) => setTimeout(r, 50));
    expect((await registry.get(a!.id))!.visiting).toBeUndefined();

    await svc.onBusy(b!.id);
    expect(await svc.roll(b!.id)).toBeUndefined();
    svc.onIdle(b!.id);
    expect(timers.at(-1)!.ms).toBe(3 * 60_000);
    expect(rt.calls).toBe(0);
    svc.stop();
  });

  it("a worker that gets work while lounging sits back down", async () => {
    const { svc, registry } = setup({ rng: () => 0 });
    const [a] = await workers(registry, 1);
    await registry.update(a!.id, { lounging: true });
    await svc.onBusy(a!.id);
    const cur = (await registry.get(a!.id))!;
    expect(cur.lounging).toBeUndefined();
    expect(cur.placement).toBeDefined();
  });

  it("schedules re-rolls between 2 and 4 minutes", () => {
    const { svc } = setup({ rng: seeded(3) });
    for (let i = 0; i < 200; i++) {
      const ms = svc.nextDelayMs();
      expect(ms).toBeGreaterThanOrEqual(120_000);
      expect(ms).toBeLessThanOrEqual(240_000);
    }
  });
});

describe("designated desks (workSeat) and work", () => {
  it("a worker that starts work walks to its workSeat (from the lounge or another desk)", async () => {
    const { svc, registry } = setup();
    const [a, b] = await workers(registry, 2);
    expect(a!.workSeat).toEqual({ space: "pod-a", seat: 0 });
    await registry.update(a!.id, { placement: { space: "pod-a", seat: 4 }, lounging: true });
    await registry.update(b!.id, { placement: { space: "pod-a", seat: 5 }, visiting: { spaceId: "meeting", until: new Date(Date.now() + 60_000).toISOString() } });
    await svc.onBusy(a!.id, { toDesk: true });
    await svc.onBusy(b!.id, { toDesk: true });
    const na = (await registry.get(a!.id))!;
    const nb = (await registry.get(b!.id))!;
    expect(na.placement).toEqual({ space: "pod-a", seat: 0 });
    expect(na.lounging).toBeUndefined();
    expect(nb.placement).toEqual({ space: "pod-a", seat: 1 });
    expect(nb.visiting).toBeUndefined();
  });

  it("brainstorm work (no toDesk) leaves the worker's seat alone", async () => {
    const { svc, registry } = setup();
    const [a] = await workers(registry, 1);
    await registry.update(a!.id, { placement: { space: "meeting", seat: 2 } });
    await svc.onBusy(a!.id, { toDesk: false });
    expect((await registry.get(a!.id))!.placement).toEqual({ space: "meeting", seat: 2 });
    expect((await registry.get(a!.id))!.workSeat).toEqual({ space: "pod-a", seat: 0 });
  });

  it("squatter rule: an idle worker at the owner's desk gets up when the owner starts working", async () => {
    const { svc, registry, msgs } = setup();
    const [owner, squatter, third] = await workers(registry, 3);
    // The squatter left its own desk (pod-a#1) and third now sits there; the squatter took pod-a#0.
    await registry.update(owner!.id, { placement: { space: "pod-a", seat: 3 }, lounging: true });
    await registry.update(third!.id, { placement: { space: "pod-a", seat: 1 } });
    await registry.update(squatter!.id, { placement: { space: "pod-a", seat: 0 } });
    // Designated: pod-a#0 owner, #1 squatter, #2 third. The first free desk nobody owns is pod-a#3 (the
    // owner just left it), so the squatter moves there rather than onto third's empty pod-a#2.
    await svc.onBusy(owner!.id, { toDesk: true });
    const o = (await registry.get(owner!.id))!;
    const s = (await registry.get(squatter!.id))!;
    expect(o.placement).toEqual({ space: "pod-a", seat: 0 });
    expect(s.placement).toEqual({ space: "pod-a", seat: 3 });
    // Workseats never move.
    expect(o.workSeat).toEqual({ space: "pod-a", seat: 0 });
    expect(s.workSeat).toEqual({ space: "pod-a", seat: 1 });
    expect(msgs.filter((m) => m.type === "agent.updated").map((m) => (m as { agent: { id: string } }).agent.id).slice(-2)).toEqual([squatter!.id, owner!.id]);
  });

  it("a squatter goes back to its own desk when that is free", async () => {
    const { svc, registry } = setup();
    const [owner, squatter] = await workers(registry, 2);
    await registry.update(owner!.id, { placement: { space: "pod-a", seat: 5 } });
    await registry.update(squatter!.id, { placement: { space: "pod-a", seat: 0 } });
    await svc.onBusy(owner!.id, { toDesk: true });
    expect((await registry.get(squatter!.id))!.placement).toEqual({ space: "pod-a", seat: 1 });
    expect((await registry.get(owner!.id))!.placement).toEqual({ space: "pod-a", seat: 0 });
  });

  it("with every desk taken the squatter goes to the lounge", async () => {
    const seats: Placement[] = [0, 1].map((seat) => ({ space: "pod-a", seat }));
    const { svc, registry } = setup({ seats });
    const [owner, squatter, third] = await workers(registry, 3, [...seats, { space: "pod-a", seat: 2 }]);
    await registry.update(owner!.id, { placement: { space: "meeting", seat: 0 } });
    await registry.update(squatter!.id, { placement: { space: "pod-a", seat: 0 } });
    await registry.update(third!.id, { placement: { space: "pod-a", seat: 1 } });
    await svc.onBusy(owner!.id, { toDesk: true });
    const s = (await registry.get(squatter!.id))!;
    expect(s.lounging).toBe(true);
    expect(s.placement).toBeUndefined();
    expect((await registry.get(owner!.id))!.placement).toEqual({ space: "pod-a", seat: 0 });
  });

  it("toWorkSeat is idempotent and idle rolls never change a workSeat", async () => {
    const { svc, registry } = setup({ rng: seeded(3) });
    const ws = await workers(registry, 3);
    const before = Object.fromEntries(ws.map((w) => [w!.id, w!.workSeat]));
    for (let i = 0; i < 60; i++) await svc.roll(ws[i % 3]!.id);
    expect(Object.fromEntries((await registry.list()).filter((a) => a.role === "worker").map((a) => [a.id, a.workSeat]))).toEqual(before);
    await svc.onBusy(ws[0]!.id, { toDesk: true });
    const once = (await registry.get(ws[0]!.id))!;
    await svc.toWorkSeat(ws[0]!.id);
    expect((await registry.get(ws[0]!.id))!.updatedAt).toBe(once.updatedAt);
  });
});
