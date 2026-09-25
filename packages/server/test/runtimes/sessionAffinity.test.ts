import { describe, it, expect } from "vitest";
import { defaultAgent, type Agent, type WorkerSession } from "@agenticview/shared";
import { SessionRuntime, memoryHooks } from "../../src/runtimes/session.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const mk = (name: string, session?: Agent["session"]): Agent => ({ ...defaultAgent({ name, role: "worker", scope: "project", specialty: "" }), ...(session !== undefined ? { session } : {}) });
const req = (runId: string, agent: Agent): RunRequest => ({
  runId,
  taskId: `t_${runId}`,
  agent,
  cwd: "/proj",
  prompt: [{ type: "text", text: "go" }],
  systemPrompt: "",
  tools: { edit: true, shell: true, web: false, screenshot: false },
  bridgeTools: [],
  permissionMode: "auto",
});
const sig = () => new AbortController().signal;

function setup(opts: { now?: () => number } = {}) {
  const hooks = memoryHooks();
  const saved: WorkerSession[][] = [];
  hooks.save = async (s) => void saved.push(s.map((x) => ({ ...x })));
  const rt = new SessionRuntime({ hooks, now: opts.now });
  return { rt, hooks, saved };
}

describe("SessionRuntime affinity", () => {
  it("an unbound agent's task goes to any free session, which becomes its sticky session", async () => {
    const { rt, hooks } = setup();
    const nova = mk("Nova");
    void rt.run(req("r1", nova), () => undefined, sig());
    const t = await rt.claim("sess-A", 0, undefined, { model: "claude-opus-5-5", cwd: "/proj" });
    expect(t?.runId).toBe("r1");
    expect(t?.session).toMatchObject({ id: "sess-A", model: "claude-opus-5-5" });
    expect(hooks.bindings.get(nova.id)).toBe("sess-A");
    rt.complete("r1", { text: "ok" }, "sess-A");

    // Next task of Nova waits for sess-A even though sess-B asks first.
    void rt.run(req("r2", nova), () => undefined, sig());
    expect(await rt.claim("sess-B", 0)).toBeNull();
    expect((await rt.claim("sess-A", 0))?.runId).toBe("r2");
  });

  it("a session claims tasks of agents bound to it before older unbound tasks", async () => {
    const { rt, hooks } = setup();
    const a = mk("A");
    const b = mk("B");
    await rt.claim("sess-A", 0); // register
    hooks.bindings.set(b.id, "sess-A");
    void rt.run(req("unbound", a), () => undefined, sig());
    void rt.run(req("mine", b), () => undefined, sig());
    expect((await rt.claim("sess-A", 0))?.runId).toBe("mine");
    expect((await rt.claim("sess-B", 0))?.runId).toBe("unbound");
  });

  it("tasks of an agent bound to an offline session wait; unbinding releases them to any session", async () => {
    let now = 1_000_000;
    const { rt, hooks } = setup({ now: () => now });
    const nova = mk("Nova", { id: "sess-A", name: "old" });
    await rt.claim("sess-A", 0);
    hooks.bindings.set(nova.id, "sess-A");
    now += 120_000; // sess-A goes offline
    expect(rt.isOnline("sess-A")).toBe(false);
    const events: string[] = [];
    void rt.run(req("r1", nova), (e) => e.type === "status" && events.push(e.text), sig());
    expect(events[0]).toMatch(/Waiting for Claude Code session .* \(offline\)/);
    expect(await rt.claim("sess-B", 0)).toBeNull();

    // "Use any session": the office clears the binding and kicks dispatch.
    const waiting = rt.claim("sess-B", 5000);
    hooks.bindings.set(nova.id, null);
    rt.kick();
    expect((await waiting)?.runId).toBe("r1");
    expect(hooks.bindings.get(nova.id)).toBe("sess-B");
  });

  it("a binding to a forgotten session counts as unbound", async () => {
    const { rt, hooks } = setup();
    const nova = mk("Nova");
    await rt.claim("sess-A", 0);
    hooks.bindings.set(nova.id, "sess-A");
    await rt.forget("sess-A");
    void rt.run(req("r1", nova), () => undefined, sig());
    expect((await rt.claim("sess-B", 0))?.runId).toBe("r1");
  });

  it("/agenticview-work <agent> binds (and re-binds) the named agent to the session", async () => {
    const { rt, hooks } = setup();
    const nova = mk("Nova");
    hooks.agents.set(nova.id, "Nova");
    hooks.bindings.set(nova.id, "sess-A");
    await rt.claim("sess-A", 0);
    await rt.claim("sess-B", 0, undefined, { agent: "nova" });
    expect(hooks.bindings.get(nova.id)).toBe("sess-B");
    void rt.run(req("r1", nova), () => undefined, sig());
    expect(await rt.claim("sess-A", 0)).toBeNull();
    expect((await rt.claim("sess-B", 0, undefined, { agent: "nova" }))?.runId).toBe("r1");
    // Once bound by name, a later office re-bind is not undone by the next poll.
    hooks.bindings.set(nova.id, "sess-A");
    await rt.claim("sess-B", 0, undefined, { agent: "nova" }).catch(() => null);
    expect(hooks.bindings.get(nova.id)).toBe("sess-A");
  });

  it("re-delivers the held task when a session reconnects mid-task", async () => {
    const { rt } = setup();
    const nova = mk("Nova");
    void rt.run(req("r1", nova), () => undefined, sig());
    expect((await rt.claim("sess-A", 0))?.runId).toBe("r1");
    const again = await rt.claim("sess-A", 0);
    expect(again).toMatchObject({ runId: "r1", redelivered: true });
  });

  it("keeps session records (model, cwd, name), lists online state and current task, renames and forgets", async () => {
    let now = 5_000_000;
    const { rt, saved } = setup({ now: () => now });
    const changes: number[] = [];
    rt.onSessionsChanged = () => changes.push(1);
    void rt.run(req("r1", mk("Nova")), () => undefined, sig());
    await rt.claim("11111111-2222-3333-4444-555555555555", 0, undefined, { model: "claude-sonnet-5", cwd: "/work/app" });
    const [s] = rt.sessionList();
    expect(s).toMatchObject({ id: "11111111-2222-3333-4444-555555555555", name: "app · 111111", model: "claude-sonnet-5", cwd: "/work/app", online: true, currentTaskId: "t_r1" });
    expect(saved.at(-1)?.[0]).toMatchObject({ model: "claude-sonnet-5" });
    expect(changes.length).toBeGreaterThan(0);
    await rt.rename(s!.id, "Frontend tab");
    expect(rt.session(s!.id)).toMatchObject({ name: "Frontend tab", named: true });
    // A renamed session keeps its name when the cwd changes.
    await rt.claim(s!.id, 0, undefined, { cwd: "/elsewhere" }).catch(() => null);
    expect(rt.session(s!.id)?.name).toBe("Frontend tab");
    rt.complete("r1", { text: "done" }, s!.id);
    now += 120_000;
    expect(rt.sessionList()[0]?.online).toBe(false);
    await rt.forget(s!.id);
    expect(rt.sessionList()).toEqual([]);
    expect(saved.at(-1)).toEqual([]);
  });

  it("loads remembered sessions on attach (offline until they poll)", async () => {
    const rt = new SessionRuntime();
    const hooks = memoryHooks();
    rt.attach(hooks, [{ id: "s1", name: "Old tab", model: "opus", cwd: "/p", firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-01T00:00:00.000Z", named: true }]);
    expect(rt.sessionList()).toMatchObject([{ id: "s1", name: "Old tab", online: false }]);
    await rt.claim("s1", 0);
    expect(rt.sessionList()[0]).toMatchObject({ online: true, name: "Old tab" });
  });

  it("reports which session runs a run (for the manager deadlock guard)", async () => {
    const { rt } = setup();
    void rt.run(req("m1", mk("Boss")), () => undefined, sig());
    await rt.claim("sess-M", 0);
    expect(rt.sessionOfRun("m1")).toBe("sess-M");
    expect(rt.sessionOfRun("nope")).toBeUndefined();
  });
});
