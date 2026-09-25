import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAgent, type Agent } from "@agenticview/shared";
import {
  WORKER_MCP_TOOLS,
  generatedAgentId,
  renderSubagent,
  subagentModel,
  subagentNames,
  subagentSlug,
  subagentTools,
  syncSubagents,
  writeSubagent,
} from "../../src/agents/subagents.js";

let proj: string;
beforeEach(async () => {
  proj = await mkdtemp(join(tmpdir(), "av-sub-"));
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true });
});

const mk = (name: string, over: Partial<Agent> = {}): Agent => ({
  ...defaultAgent({ name, role: "worker", scope: "project", specialty: "frontend", provider: "claude-session" }),
  ...over,
});
const dir = () => join(proj, ".claude", "agents");
const read = (name: string) => readFile(join(dir(), `${name}.md`), "utf8");

describe("subagent file content", () => {
  it("slugs names and keeps the oldest agent on the plain name when slugs collide", () => {
    expect(subagentSlug("Nova Prime!")).toBe("nova-prime");
    expect(subagentSlug("Zoë")).toBe("zoe");
    expect(subagentSlug("***")).toBe("agent");
    const a = mk("Nova", { id: "w_aaaaaa111111", createdAt: "2026-01-01T00:00:00.000Z" });
    const b = mk("nova", { id: "w_bbbbbb222222", createdAt: "2026-02-01T00:00:00.000Z" });
    const names = subagentNames([b, a]);
    expect(names.get(a.id)).toBe("agenticview-nova");
    expect(names.get(b.id)).toBe("agenticview-nova-222222");
  });

  it("maps models to Claude aliases, else inherit", () => {
    expect(subagentModel("opus")).toBe("opus");
    expect(subagentModel("claude-sonnet-5")).toBe("sonnet");
    expect(subagentModel(null)).toBe("inherit");
    expect(subagentModel("gpt-6-sol")).toBe("inherit");
  });

  it("omits tools when edit, shell and web are all allowed, else lists them plus the worker MCP tools", () => {
    expect(subagentTools({ edit: true, shell: true, web: true, screenshot: false })).toBeUndefined();
    const t = subagentTools({ edit: true, shell: false, web: false, screenshot: false })!;
    expect(t).toEqual(expect.arrayContaining(["Read", "Edit", "Write", ...WORKER_MCP_TOOLS]));
    expect(t).not.toContain("Bash");
    expect(t).not.toContain("WebFetch");
    expect(t).toContain("mcp__plugin_agenticview_agenticview-worker__agenticview_report");
    expect(t).toContain("mcp__plugin_agenticview_agenticview-worker__agenticview_complete");
    expect(t).toContain("mcp__plugin_agenticview_agenticview-worker__agenticview_bridge");
    expect(t.some((x) => x.endsWith("agenticview_next_task"))).toBe(false);
  });

  it("renders frontmatter, the generated marker, the persona and the run_id protocol", () => {
    const a = mk("Nova", { model: "sonnet", description: 'Knows "React"', systemPrompt: "Prefer small diffs.", tools: { edit: true, shell: true, web: false, screenshot: false } });
    const text = renderSubagent(a, "agenticview-nova");
    const [, front] = text.split("---\n");
    expect(front).toContain("name: agenticview-nova\n");
    expect(front).toMatch(/description: ".*Nova: frontend\. Knows \\"React\\".*"/);
    expect(front).toContain("model: sonnet\n");
    expect(front).toMatch(/tools: Read, Grep, Glob, TodoWrite, Edit, Write, MultiEdit, NotebookEdit, Bash, BashOutput, KillShell, mcp__plugin_agenticview_agenticview-worker__agenticview_report/);
    expect(text.startsWith("---\nname:")).toBe(true);
    expect(generatedAgentId(text)).toBe(a.id);
    expect(text).toContain("Prefer small diffs.");
    expect(text).toContain("Pass `run_id`");
    expect(text).toContain("Never call `agenticview_next_task`");
    const all = renderSubagent({ ...a, tools: { edit: true, shell: true, web: true, screenshot: false } }, "agenticview-nova");
    expect(all).not.toMatch(/^tools:/m);
  });
});

describe("writing and syncing subagent files", () => {
  it("writes, refreshes and leaves unchanged files alone", async () => {
    const a = mk("Nova");
    expect(await writeSubagent(proj, a, "agenticview-nova")).toEqual({ name: "agenticview-nova", status: "written" });
    expect(await writeSubagent(proj, a, "agenticview-nova")).toEqual({ name: "agenticview-nova", status: "unchanged" });
    expect(await writeSubagent(proj, { ...a, model: "haiku" }, "agenticview-nova")).toMatchObject({ status: "written" });
    expect(await read("agenticview-nova")).toContain("model: haiku");
  });

  it("never overwrites or deletes a user-authored file", async () => {
    await mkdir(dir(), { recursive: true });
    await writeFile(join(dir(), "agenticview-nova.md"), "---\nname: agenticview-nova\ndescription: mine\n---\nMy own prompt\n");
    await writeFile(join(dir(), "agenticview-old.md"), "---\nname: agenticview-old\ndescription: mine too\n---\nhand written\n");
    await writeFile(join(dir(), "reviewer.md"), "---\nname: reviewer\n---\nx\n");
    const res = await syncSubagents(proj, [mk("Nova")]);
    expect(res.userFiles).toEqual(["agenticview-nova"]);
    expect(await read("agenticview-nova")).toContain("My own prompt");
    expect((await readdir(dir())).sort()).toEqual(["agenticview-nova.md", "agenticview-old.md", "reviewer.md"]);
  });

  it("removes files of agents that were deleted or left the provider, and old files after a rename", async () => {
    const nova = mk("Nova");
    const orion = mk("Orion");
    await syncSubagents(proj, [nova, orion]);
    expect((await readdir(dir())).sort()).toEqual(["agenticview-nova.md", "agenticview-orion.md"]);

    // Orion switched provider (not in the set, keep() says no); Nova renamed.
    const res = await syncSubagents(proj, [{ ...nova, name: "Nova Two" }]);
    expect(res.removed.sort()).toEqual(["agenticview-nova", "agenticview-orion"]);
    expect(res.written).toEqual(["agenticview-nova-two"]);
    expect(await readdir(dir())).toEqual(["agenticview-nova-two.md"]);
  });

  it("keeps generated files of agents that keep() still claims (e.g. a hub agent working here)", async () => {
    const hubAgent = mk("Scout", { scope: "global" });
    await writeSubagent(proj, hubAgent, "agenticview-scout");
    const res = await syncSubagents(proj, [], async (id) => id === hubAgent.id);
    expect(res.removed).toEqual([]);
    expect(await readdir(dir())).toEqual(["agenticview-scout.md"]);
  });

  it("falls back to an id-suffixed name when another agent's generated file holds the name", async () => {
    const a = mk("Nova", { id: "w_first0000001" });
    const b = mk("Nova", { id: "w_second000002" });
    await writeSubagent(proj, a, "agenticview-nova");
    const out = await writeSubagent(proj, b, "agenticview-nova");
    expect(out).toEqual({ name: "agenticview-nova-000002", status: "written" });
    expect(generatedAgentId(await read("agenticview-nova"))).toBe(a.id);
  });
});
