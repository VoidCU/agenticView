import { it, expect } from "vitest";
import { defaultAgent, type Task } from "@agenticview/shared";
import { buildRosterPreamble } from "../../src/manager/preamble.js";

const task = (over: Partial<Task>): Task => ({
  id: "t_0", kind: "work", title: "", description: "", status: "queued", createdBy: "user", assigneeId: "w_1",
  projectPath: "C:/demo", images: [], log: [], createdAt: "", ...over,
});

it("lists roster and open tasks for a project world", () => {
  const m = defaultAgent({ id: "m_1", name: "Atlas", role: "manager", scope: "project", specialty: "manager" });
  const w = defaultAgent({ id: "w_1", name: "Nova", role: "worker", scope: "project", specialty: "frontend", provider: "gemini" });
  const g = defaultAgent({ id: "w_2", name: "Rover", role: "worker", scope: "global", specialty: "tests" });
  const out = buildRosterPreamble({ kind: "project", name: "demo", projectPath: "C:/demo", knownProjects: [] }, [m, w, g], [
    task({ id: "t_1", kind: "request", title: "Add dark mode", status: "running", assigneeId: "m_1" }),
    task({ id: "t_2", kind: "work", title: "CSS vars", status: "running", createdBy: "m_1", assigneeId: "w_1", parentId: "t_1" }),
    task({ id: "t_0", kind: "work", title: "old", status: "done", createdBy: "m_1" }),
  ]);
  expect(out).toContain("# AgenticView project world: demo");
  expect(out).toContain("Project path: C:/demo");
  expect(out).toContain("## Roster");
  expect(out).toContain('- w_1 "Nova" worker/project — frontend — gemini — running t_2');
  expect(out).toContain('- w_2 "Rover" worker/global — tests — default — idle');
  expect(out).not.toContain("Atlas");
  expect(out).toContain("## Open tasks");
  expect(out).toContain('- t_1 request "Add dark mode" (running) → m_1');
  expect(out).toContain('- t_2 work "CSS vars" (running) → w_1, parent t_1');
  expect(out).not.toContain('"old"');
});

it("explains an empty roster and lists known projects in the hub", () => {
  const out = buildRosterPreamble({ kind: "hub", name: "Hub", projectPath: null, knownProjects: [{ path: "C:/a", name: "a", lastOpened: "" }] }, [], []);
  expect(out).toContain("Known projects: a (C:/a)");
  expect(out).toContain("(no workers yet; use create_agent)");
  expect(out).toContain("- none");
});
