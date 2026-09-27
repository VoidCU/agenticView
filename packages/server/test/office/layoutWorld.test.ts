import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpacesFromLayout, defaultAgent, type OfficeLayout, type ServerMessage } from "@agenticview/shared";
import { createWorld, type World } from "../../src/world.js";
import { createServer, type RunningServer } from "../../src/server.js";
import { EventBus } from "../../src/events/bus.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import { writeJsonFile } from "../../src/store/jsonStore.js";
import { projectRoot } from "../../src/store/paths.js";
import { officeTools } from "../../src/manager/officeTools.js";

let home: string;
let project: string;
let server: RunningServer | undefined;
const oldHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-layout-home-"));
  project = await mkdtemp(join(tmpdir(), "av-layout-project-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = oldHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function world(): Promise<{ world: World; events: ServerMessage[] }> {
  const bus = new EventBus();
  const events: ServerMessage[] = [];
  bus.on((event) => events.push(event));
  const world = await createWorld({ kind: "project", projectPath: project }, {
    runtimes: new Map([["claude", new FakeRuntime(async function* () {})]]), bus,
    toolRegistry: new ToolRegistry(), bridgeUrl: () => "http://localhost",
  });
  return { world, events };
}

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../../../shared/test/fixtures/legacy-0.2.16");

describe("layout persistence and migration", () => {
  it("migrates the legacy fixture once, keeps names and remaps stale seats", async () => {
    const root = projectRoot(project);
    await mkdir(join(root, "agents"), { recursive: true });
    await cp(join(fixture, "rooms.json"), join(root, "rooms.json"));
    await cp(join(fixture, "office.json"), join(root, "office.json"));
    const raw = JSON.parse(await readFile(join(fixture, "agents.json"), "utf8")) as { id: string; name: string; role: "manager" | "worker"; createdAt: string; placement?: { space: string; seat: number } }[];
    for (const a of raw.filter((x) => x.role === "worker")) {
      const agent = defaultAgent({ id: a.id, name: a.name, role: a.role, scope: "project", specialty: "test", createdAt: a.createdAt });
      await writeJsonFile(join(root, "agents", `${a.id}.json`), { ...agent, ...(a.placement ? { placement: a.placement } : {}) });
    }
    const first = (await world()).world;
    const path = join(root, "layout.json");
    const initial = await readFile(path, "utf8");
    const stamp = (await stat(path)).mtimeMs;
    expect(first.layout().rooms.find((r) => r.id === "lounge")).toMatchObject({ q: 0, r: 0 });
    expect((await first.snapshot()).spaceNames).toMatchObject({ office: "HQ", meeting: "War Room" });
    expect((await first.registry.get("w_ghost"))?.placement).toEqual({ space: "pod-a", seat: 1 });
    expect((await first.registry.get("w_stale"))?.placement).toEqual({ space: "pod-a", seat: 2 });
    const second = (await world()).world;
    expect(await readFile(path, "utf8")).toBe(initial);
    expect((await stat(path)).mtimeMs).toBe(stamp);
    expect(second.layout()).toEqual(first.layout());
    expect(await readFile(join(root, "rooms.json"), "utf8")).toBe(await readFile(join(fixture, "rooms.json"), "utf8"));
  });

  it("recovers from invalid layout.json using legacy rooms", async () => {
    const root = projectRoot(project);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "layout.json"), '{"version":1,"rooms":[]}');
    await cp(join(fixture, "rooms.json"), join(root, "rooms.json"));
    const { world: loaded } = await world();
    expect(loaded.layout().rooms.some((r) => r.id === "pod-p")).toBe(true);
    expect(JSON.parse(await readFile(join(root, "layout.json"), "utf8")).rooms.length).toBeGreaterThan(0);
  });

  it("grows and broadcasts when the current pod desks fill", async () => {
    const { world: loaded, events } = await world();
    const before = loaded.layout().rooms.filter((r) => r.kind === "pod").length;
    for (let i = 0; i < before * 6; i++) await loaded.registry.create({ name: `W${i}`, specialty: "test" });
    expect(loaded.layout().rooms.filter((r) => r.kind === "pod").length).toBeGreaterThan(before);
    expect(events.some((e) => e.type === "layout.updated")).toBe(true);
  });

  it("serializes concurrent room additions without losing ids or hexes", async () => {
    const { world: loaded } = await world();
    const added = await Promise.all(Array.from({ length: 8 }, (_, i) => loaded.addRoom("pod", `Extra ${i}`)));
    expect(added.every((r) => r.ok)).toBe(true);
    const ids = added.flatMap((r) => r.ok ? [r.spaceId] : []);
    expect(new Set(ids).size).toBe(8);
    const rooms = loaded.layout().rooms.filter((r) => ids.includes(r.id));
    expect(rooms).toHaveLength(8);
    expect(new Set(rooms.map((r) => `${r.q},${r.r}`)).size).toBe(8);
  });
});

describe("layout manager tools", () => {
  it("moves, swaps, changes kinds and rejects invalid layouts", async () => {
    const { world: loaded, events } = await world();
    const tools = officeTools({ registry: loaded.registry, emitAgent: (agent) => events.push({ type: "agent.updated", agent }), layout: loaded.layout, updateLayout: loaded.updateLayout });
    const call = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args);
    const a = loaded.layout().rooms.find((r) => r.id === "pod-a")!;
    const b = loaded.layout().rooms.find((r) => r.id === "pod-b")!;
    expect(await call("move_room", { space: "pod-a", q: b.q, r: b.r })).toContain('"version":1');
    expect(loaded.layout().rooms.find((r) => r.id === "pod-a")).toMatchObject({ q: b.q, r: b.r });
    expect(loaded.layout().rooms.find((r) => r.id === "pod-b")).toMatchObject({ q: a.q, r: a.r });
    expect(await call("move_room", { space: "missing", q: 1, r: 1 })).toMatch(/unknown room/);
    expect(await call("set_layout", { moves: [{ space: "pod-a", toHex: { q: 9, r: 0 } }] })).toMatch(/outside the office/);
    expect(await call("set_room_kind", { q: 0, r: 0, kind: null })).toMatch(/not connected|office|seated/i);
    const newHex = { q: 2, r: -1 };
    const current = loaded.layout().rooms.find((r) => r.q === newHex.q && r.r === newHex.r);
    if (!current) expect(await call("set_room_kind", { ...newHex, kind: "research" })).toContain('"version":1');
    expect(events.some((e) => e.type === "layout.updated")).toBe(true);
  });

  it("remaps a seated worker when a room changes kind and refuses deletion of seated rooms", async () => {
    const { world: loaded, events } = await world();
    const worker = await loaded.registry.create({ name: "Builder", specialty: "test" });
    await loaded.registry.update(worker.id, { placement: { space: "meeting", seat: 0 } });
    const meeting = loaded.layout().rooms.find((r) => r.id === "meeting")!;
    const tools = officeTools({ registry: loaded.registry, emitAgent: () => undefined, layout: loaded.layout, updateLayout: loaded.updateLayout });
    const kind = tools.find((t) => t.name === "set_room_kind")!;
    expect(await kind.handler({ q: meeting.q, r: meeting.r, kind: null })).toMatch(/seated workers/);
    expect(await kind.handler({ q: meeting.q, r: meeting.r, kind: "pod" })).toContain('"version":1');
    expect((await loaded.registry.get(worker.id))?.placement?.space).toBe("pod-a");
    expect(events.some((e) => e.type === "agent.updated" && e.agent.id === worker.id && e.agent.placement?.space === "pod-a")).toBe(true);
    const office = loaded.layout().rooms.find((r) => r.kind === "office")!;
    expect(await kind.handler({ q: office.q, r: office.r, kind: null })).toMatch(/manager's office/i);
  });

  it("supports batch moves and renames production, research and My Office", async () => {
    const { world: loaded } = await world();
    const names: Record<string, string> = { production: "Studio", research: "Library", myoffice: "My Place" };
    const tools = officeTools({ registry: loaded.registry, emitAgent: () => undefined,
      spaces: () => buildSpacesFromLayout(loaded.layout(), names),
      layout: loaded.layout, updateLayout: loaded.updateLayout,
      spaceNames: () => names,
      renameSpace: async (id, name) => { names[id] = name; },
    });
    const rename = tools.find((t) => t.name === "rename_space")!;
    for (const id of Object.keys(names)) expect(await rename.handler({ space: id, name: `New ${id}` })).toContain(`"id":"${id}"`);
    const a = loaded.layout().rooms.find((r) => r.id === "pod-a")!;
    const b = loaded.layout().rooms.find((r) => r.id === "pod-b")!;
    const batch = tools.find((t) => t.name === "set_layout")!;
    expect(await batch.handler({ moves: [{ space: a.id, toHex: { q: b.q, r: b.r } }, { space: b.id, toHex: { q: b.q, r: b.r } }] })).toContain('"version":1');
    expect(loaded.layout().rooms.find((r) => r.id === a.id)).toMatchObject({ q: a.q, r: a.r });
  });
});

describe("HTTP layout editor", () => {
  it("requires the UI token, validates and broadcasts full layouts", async () => {
    server = await createServer({ world: { kind: "project", projectPath: project }, token: "tok", runtimes: new Map([["claude", new FakeRuntime(async function* () {})]]) });
    const url = `${server.url}/api/layout`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { method: "PUT", body: "{}" })).status).toBe(401);
    const headers = { "x-agenticview-token": "tok", "content-type": "application/json" };
    const before = await (await fetch(url, { headers })).json() as OfficeLayout & { spaceNames: Record<string, string> };
    expect(before.rooms.some((r) => r.kind === "myoffice")).toBe(true);
    const invalid = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ version: 1, rooms: [] }) });
    expect(invalid.status).toBe(400);
    const events: ServerMessage[] = [];
    server.world.bus.on((e) => events.push(e));
    const body = { ...before, spaceNames: { research: "Library" } };
    const ok = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).spaceNames).toEqual({ research: "Library" });
    expect(events.some((e) => e.type === "spaceNames.updated")).toBe(true);
    const changed = { ...before, rooms: before.rooms.map((r) => r.id === "pod-a" ? { ...r, name: "Alpha" } : r) };
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify(changed) })).status).toBe(200);
    expect(events.some((e) => e.type === "layout.updated" && e.layout.rooms.find((r) => r.id === "pod-a")?.name === "Alpha")).toBe(true);
    const agent = await server.world.registry.create({ name: "Seated", specialty: "test" });
    await server.world.registry.update(agent.id, { placement: { space: "meeting", seat: 0 } });
    const meeting = server.world.layout().rooms.find((r) => r.id === "meeting")!;
    const withoutMeeting = { ...server.world.layout(), rooms: server.world.layout().rooms.filter((r) => r.id !== "meeting") };
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify(withoutMeeting) })).status).toBe(400);
    const replacement = { ...server.world.layout(), rooms: server.world.layout().rooms.map((r) => r.id === "meeting" ? { id: "pod-z", kind: "pod" as const, q: meeting.q, r: meeting.r } : r) };
    expect((await fetch(url, { method: "PUT", headers, body: JSON.stringify(replacement) })).status).toBe(200);
    expect(events.some((e) => e.type === "agent.updated" && e.agent.id === agent.id && e.agent.placement?.space === "pod-a")).toBe(true);
  });
});
