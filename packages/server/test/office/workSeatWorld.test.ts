import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAgent, type Agent, type ServerMessage } from "@agenticview/shared";
import { createWorld, type World } from "../../src/world.js";
import { EventBus } from "../../src/events/bus.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import { writeJsonFile } from "../../src/store/jsonStore.js";
import { projectRoot } from "../../src/store/paths.js";

let home: string;
let project: string;
const oldHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-ws-home-"));
  project = await mkdtemp(join(tmpdir(), "av-ws-project-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = oldHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function open(): Promise<{ world: World; events: ServerMessage[] }> {
  const bus = new EventBus();
  const events: ServerMessage[] = [];
  bus.on((event) => events.push(event));
  const world = await createWorld({ kind: "project", projectPath: project }, {
    runtimes: new Map([["claude", new FakeRuntime(async function* () {})]]), bus,
    toolRegistry: new ToolRegistry(), bridgeUrl: () => "http://localhost",
  });
  return { world, events };
}

async function until<T>(fn: () => Promise<T | undefined | false>, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const worker = (id: string, name: string, day: number, extra: Partial<Agent>): Agent => ({
  ...defaultAgent({ id, name, role: "worker", scope: "project", specialty: "x", createdAt: `2026-01-0${day}T00:00:00Z` }),
  ...extra,
});

describe("workSeat migration on office start", () => {
  it("adopts current placements, resolves duplicate workSeats and is idempotent", async () => {
    const root = projectRoot(project);
    await mkdir(join(root, "agents"), { recursive: true });
    const agents = [
      worker("w_a", "Ada", 1, { placement: { space: "pod-a", seat: 3 } }),
      worker("w_b", "Bea", 2, { placement: { space: "pod-a", seat: 1 }, workSeat: { space: "pod-a", seat: 1 } }),
      // Cid claims Bea's desk too (a hand-edited or pre-uniqueness record): the later agent moves.
      worker("w_c", "Cid", 3, { placement: { space: "pod-a", seat: 1 }, workSeat: { space: "pod-a", seat: 1 } }),
      worker("w_d", "Dot", 4, {}),
    ];
    for (const a of agents) await writeJsonFile(join(root, "agents", `${a.id}.json`), a);
    const { world } = await open();
    const seat = async (id: string) => (await world.registry.get(id))!.workSeat;
    expect(await seat("w_a")).toEqual({ space: "pod-a", seat: 3 });
    expect(await seat("w_b")).toEqual({ space: "pod-a", seat: 1 });
    const cid = await seat("w_c");
    const dot = await seat("w_d");
    expect(cid?.space).toBe("pod-a");
    const keys = [await seat("w_a"), await seat("w_b"), cid, dot].map((p) => `${p!.space}#${p!.seat}`);
    expect(new Set(keys).size).toBe(4);
    // Second start: nothing moves.
    const before = (await world.registry.list()).map((a) => [a.id, a.workSeat, a.updatedAt]);
    const again = (await open()).world;
    expect((await again.registry.list()).map((a) => [a.id, a.workSeat, a.updatedAt])).toEqual(before);
  });
});

describe("working agents sit at their workSeat", () => {
  it("a task start walks the worker to its desk; brainstorm (meeting) work does not", async () => {
    const { world } = await open();
    const nova = await world.registry.create({ name: "Nova", specialty: "x" });
    const desk = nova.workSeat!;
    // Brainstorm seated it in the Meeting Room (seatWorker).
    await world.registry.update(nova.id, { placement: { space: "meeting", seat: 1 } });
    const meeting = await world.tasks.create({ kind: "work", title: "Brainstorm: x", description: "x", createdBy: "m", assigneeId: nova.id, projectPath: project, meeting: true });
    await world.tasks.transition(meeting.id, "assigned");
    await world.tasks.transition(meeting.id, "running");
    await new Promise((r) => setTimeout(r, 100));
    expect((await world.registry.get(nova.id))!.placement).toEqual({ space: "meeting", seat: 1 });
    await world.tasks.transition(meeting.id, "done");
    await world.registry.update(nova.id, { lounging: true });
    const work = await world.tasks.create({ kind: "work", title: "Build", description: "x", createdBy: "m", assigneeId: nova.id, projectPath: project });
    await world.tasks.transition(work.id, "assigned");
    const seated = await until(async () => {
      const a = await world.registry.get(nova.id);
      return a?.placement?.space === desk.space && a.placement.seat === desk.seat && a;
    });
    expect(seated.lounging).toBeUndefined();
    expect(seated.workSeat).toEqual(desk);
  });

  it("the owner starting work displaces an idle squatter", async () => {
    const { world } = await open();
    const nova = await world.registry.create({ name: "Nova", specialty: "x" });
    const bolt = await world.registry.create({ name: "Bolt", specialty: "x" });
    await world.registry.update(nova.id, { placement: { space: "pod-b", seat: 0 } });
    await world.registry.update(bolt.id, { placement: nova.workSeat });
    const t = await world.tasks.create({ kind: "work", title: "Build", description: "x", createdBy: "m", assigneeId: nova.id, projectPath: project });
    await world.tasks.transition(t.id, "assigned");
    await until(async () => (await world.registry.get(nova.id))?.placement?.seat === nova.workSeat!.seat && (await world.registry.get(nova.id))?.placement?.space === nova.workSeat!.space);
    // Bolt goes back to its own (free) designated desk.
    expect((await world.registry.get(bolt.id))!.placement).toEqual(bolt.workSeat);
  });

  it("the user dragging a worker (moveDesk) is an owner move", async () => {
    const { world } = await open();
    const nova = await world.registry.create({ name: "Nova", specialty: "x" });
    const bolt = await world.registry.create({ name: "Bolt", specialty: "x" });
    expect(await world.moveDesk(bolt.id, nova.workSeat!)).toMatch(/Nova swapped to/);
    expect((await world.registry.get(bolt.id))!.workSeat).toEqual(nova.workSeat);
    expect((await world.registry.get(nova.id))!.workSeat).toEqual(bolt.workSeat);
  });
});
