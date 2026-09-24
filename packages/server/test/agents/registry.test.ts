import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry, ScopeError } from "../../src/agents/registry.js";

let home: string;
let proj: string;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-home-"));
  proj = await mkdtemp(join(tmpdir(), "av-proj-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

describe("AgentRegistry", () => {
  it("creates one manager per world, idempotently", async () => {
    const r = new AgentRegistry({ kind: "project", projectPath: proj });
    const m1 = await r.ensureManager();
    const m2 = await r.ensureManager();
    expect(m1.id).toBe(m2.id);
    expect(m1.role).toBe("manager");
    expect(m1.scope).toBe("project");
    expect(m1.name).toBe("Atlas");
    expect((await r.list()).filter((a) => a.role === "manager")).toHaveLength(1);
  });

  it("project world lists project + global workers; hub lists only global", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const h = new AgentRegistry({ kind: "hub" });
    await p.create({ name: "Nova", specialty: "frontend" });
    await h.create({ name: "Rover", specialty: "testing" });
    await h.ensureManager();
    expect((await p.list()).map((a) => a.name).sort()).toEqual(["Nova", "Rover"]);
    expect((await h.list()).map((a) => a.name).sort()).toEqual(["Overseer", "Rover"]);
  });

  it("copyToProject clones a global agent with originId and new id", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const g = await new AgentRegistry({ kind: "hub" }).create({ name: "Rover", specialty: "testing", provider: "gemini" });
    const c = await p.copyToProject(g.id);
    expect(c.id).not.toBe(g.id);
    expect(c.scope).toBe("project");
    expect(c.originId).toBe(g.id);
    expect(c.provider).toBe("gemini");
    expect(c.stats.xp).toBe(0);
    expect((await p.list()).filter((a) => a.name === "Rover")).toHaveLength(2);
    await expect(p.copyToProject(c.id)).rejects.toThrow(ScopeError);
    await expect(new AgentRegistry({ kind: "hub" }).copyToProject(g.id)).rejects.toThrow(ScopeError);
  });

  it("refuses to remove a manager, removes workers", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const m = await p.ensureManager();
    await expect(p.remove(m.id)).rejects.toThrow(ScopeError);
    const w = await p.create({ name: "X", specialty: "" });
    await p.remove(w.id);
    expect(await p.get(w.id)).toBeUndefined();
    await expect(p.remove("w_missing")).resolves.toBeUndefined();
  });

  it("update bumps updatedAt, keeps identity fields, validates", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const w = await p.create({ name: "X", specialty: "" });
    await new Promise((r) => setTimeout(r, 5));
    const u = await p.update(w.id, { name: "Y", role: "manager" } as never);
    expect(u.name).toBe("Y");
    expect(u.role).toBe("worker");
    expect(u.updatedAt > w.updatedAt).toBe(true);
    await expect(p.update(w.id, { name: "" })).rejects.toThrow();
    await expect(p.update("w_missing", { name: "Z" })).rejects.toThrow(/Unknown agent/);
  });

  it("hub cannot create project-scoped agents", async () => {
    const h = new AgentRegistry({ kind: "hub" });
    await expect(h.create({ name: "X", specialty: "", scope: "project" })).rejects.toThrow(ScopeError);
  });
});
