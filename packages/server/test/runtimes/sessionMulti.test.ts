import { describe, it, expect } from "vitest";
import { defaultAgent, type Agent, type RunResult } from "@agenticview/shared";
import { SessionRuntime, memoryHooks, type RunAttribution } from "../../src/runtimes/session.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const mk = (name: string, role: Agent["role"] = "worker"): Agent => defaultAgent({ name, role, scope: "project", specialty: "" });
const req = (runId: string, agent: Agent): RunRequest => ({
  runId,
  taskId: `t_${runId}`,
  agent,
  cwd: "/proj",
  prompt: [{ type: "text", text: `do ${runId}` }],
  systemPrompt: "",
  tools: { edit: true, shell: true, web: false, screenshot: false },
  bridgeTools: [],
  permissionMode: "auto",
});

function setup() {
  const hooks = memoryHooks();
  const attributions: RunAttribution[] = [];
  hooks.prepare = async (r) => ({ subagent: `agenticview-${r.agent.name.toLowerCase()}`, recentWork: [{ taskId: "t_old", title: "earlier", status: "done", summary: "did it", files: ["a.ts"] }] });
  hooks.attribute = (a) => void attributions.push({ ...a });
  const rt = new SessionRuntime({ hooks });
  return { rt, hooks, attributions };
}

describe("SessionRuntime: several runs per session", () => {
  it("hands one session several runs at once, each with its subagent and recent work", async () => {
    const { rt, attributions } = setup();
    const [nova, orion] = [mk("Nova"), mk("Orion")];
    const results: Promise<RunResult>[] = [rt.run(req("r1", nova), () => undefined, new AbortController().signal), rt.run(req("r2", orion), () => undefined, new AbortController().signal)];
    const res = await rt.claimMany("sess-A", { waitMs: 0, holding: [] });
    expect(res.tasks.map((t) => t.runId)).toEqual(["r1", "r2"]);
    expect(res.tasks[0]).toMatchObject({ subagent: "agenticview-nova", recentWork: [{ taskId: "t_old", files: ["a.ts"] }] });
    expect(res).toMatchObject({ capacity: 4, held: 2, cancelled: [] });
    expect(rt.sessionList()[0]!.runs.map((r) => [r.runId, r.agentId, r.subagent])).toEqual([
      ["r1", nova.id, "agenticview-nova"],
      ["r2", orion.id, "agenticview-orion"],
    ]);
    expect(attributions.map((a) => [a.runId, a.sessionId, a.subagent])).toEqual([
      ["r1", "sess-A", "agenticview-nova"],
      ["r2", "sess-A", "agenticview-orion"],
    ]);

    // Reports and completions route by run id, independently.
    expect(rt.report("r2", [{ type: "file_changed", path: "src/b.ts", kind: "modify" }], "sess-A", "agent-xyz")).toEqual({ ok: true });
    expect(rt.sessionList()[0]!.runs.find((r) => r.runId === "r2")?.subagentId).toBe("agent-xyz");
    expect(attributions.at(-1)).toMatchObject({ runId: "r2", subagentId: "agent-xyz", files: ["src/b.ts"] });
    rt.complete("r2", { text: "orion done" }, "sess-A");
    expect((await results[1]!).text).toBe("orion done");
    expect(rt.sessionList()[0]!.runs.map((r) => r.runId)).toEqual(["r1"]);
    rt.complete("r1", { text: "nova done" }, "sess-A");
    expect((await results[0]!).text).toBe("nova done");
  });

  it("never exceeds the session's capacity or max, and a freed slot is refilled", async () => {
    const { rt } = setup();
    const agents = ["A", "B", "C", "D", "E"].map((n) => mk(n));
    agents.forEach((a, i) => void rt.run(req(`r${i}`, a), () => undefined, new AbortController().signal));
    await rt.claimMany("sess-A", { waitMs: 0, holding: [], max: 0 }); // register
    await rt.setCapacity("sess-A", 3);
    const first = await rt.claimMany("sess-A", { waitMs: 0, holding: [], max: 2 });
    expect(first.tasks.map((t) => t.runId)).toEqual(["r0", "r1"]);
    const second = await rt.claimMany("sess-A", { waitMs: 0, holding: ["r0", "r1"] });
    expect(second.tasks.map((t) => t.runId)).toEqual(["r2"]);
    expect(second.held).toBe(3);
    // At capacity: a poll waits for a slot, and gets the next run as soon as one is completed.
    const waiting = rt.claimMany("sess-A", { waitMs: 5000, holding: ["r0", "r1", "r2"] });
    rt.complete("r1", { text: "ok" }, "sess-A");
    const third = await waiting;
    expect(third.tasks.map((t) => t.runId)).toEqual(["r3"]);
    expect(third).toMatchObject({ cancelled: [], gone: ["r1"] });
    expect(rt.capacityOf("sess-A")).toBe(3);
  });

  it("lets a Manager take a new request while its earlier one is still running (waiting on workers)", async () => {
    const { rt } = setup();
    const atlas = mk("Atlas", "manager");
    const nova = mk("Nova");
    void rt.run(req("m1", atlas), () => undefined, new AbortController().signal);
    const first = await rt.claimMany("sess-A", { waitMs: 0, holding: [] });
    expect(first.tasks.map((t) => t.runId)).toEqual(["m1"]);
    void rt.run(req("m2", atlas), () => undefined, new AbortController().signal);
    void rt.run(req("w1", nova), () => undefined, new AbortController().signal);
    void rt.run(req("w2", nova), () => undefined, new AbortController().signal);
    const second = await rt.claimMany("sess-A", { waitMs: 0, holding: ["m1"] });
    // The second request runs beside the first; a worker still gets only one task at a time.
    expect(second.tasks.map((t) => t.runId)).toEqual(["m2", "w1"]);
  });

  it("runs one task per agent at a time in a session", async () => {
    const { rt } = setup();
    const nova = mk("Nova");
    void rt.run(req("r1", nova), () => undefined, new AbortController().signal);
    void rt.run(req("r2", nova), () => undefined, new AbortController().signal);
    const res = await rt.claimMany("sess-A", { waitMs: 0, holding: [] });
    expect(res.tasks.map((t) => t.runId)).toEqual(["r1"]);
    rt.complete("r1", {}, "sess-A");
    expect((await rt.claimMany("sess-A", { waitMs: 0, holding: [] })).tasks.map((t) => t.runId)).toEqual(["r2"]);
  });

  it("tells a waiting poll about cancelled runs right away", async () => {
    const { rt } = setup();
    const ac = new AbortController();
    void rt.run(req("r1", mk("Nova")), () => undefined, ac.signal);
    await rt.claimMany("sess-A", { waitMs: 0, holding: [] });
    const poll = rt.claimMany("sess-A", { waitMs: 10_000, holding: ["r1"] });
    ac.abort();
    const res = await poll;
    expect(res.cancelled).toEqual(["r1"]);
    expect(res.tasks).toEqual([]);
    expect(rt.report("r1", [], "sess-A")).toMatchObject({ ok: false, cancelled: true });
  });

  it("hands back held runs the worker lost track of (restart), all of them", async () => {
    const { rt } = setup();
    void rt.run(req("r1", mk("Nova")), () => undefined, new AbortController().signal);
    void rt.run(req("r2", mk("Orion")), () => undefined, new AbortController().signal);
    await rt.claimMany("sess-A", { waitMs: 0, holding: [] });
    const again = await rt.claimMany("sess-A", { waitMs: 0, holding: ["r2"] });
    expect(again.tasks.map((t) => [t.runId, t.redelivered])).toEqual([["r1", true]]);
  });

  it("counts manager runs as blocked slots for the deadlock guard", async () => {
    const { rt } = setup();
    void rt.run(req("m1", mk("Atlas", "manager")), () => undefined, new AbortController().signal);
    await rt.claimMany("sess-M", { waitMs: 0, holding: [] });
    expect(rt.spareSlotsBeside("sess-M", ["m1"])).toBe(3);
    await rt.setCapacity("sess-M", 1);
    expect(rt.spareSlotsBeside("sess-M", ["m1"])).toBe(0);
    expect(rt.sessionList()[0]!.capacity).toBe(1);
  });
});
