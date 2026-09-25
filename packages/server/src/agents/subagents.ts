import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { modelFamily, type Agent } from "@agenticview/shared";

/**
 * Claude Code subagent files for `claude-session` agents.
 *
 * A Claude Code session running /agenticview-work is a coordinator: it launches each office task in a
 * background subagent of the agent's own type, several at once. Claude Code loads project subagents
 * from `<project>/.claude/agents/<name>.md` (YAML frontmatter `name`, `description`, optional `tools`
 * and `model`; the body is the system prompt). The office writes one file per agent, named
 * `agenticview-<slug>.md`, marks it as generated, and never touches a file without that marker.
 */

export const SUBAGENT_PREFIX = "agenticview-";
/** Marker in every generated file; carries the agent id so renames and deletions can be tracked. */
const MARKER_RE = /<!-- agenticview:generated agent=([\w-]+) -->/;
const marker = (agentId: string) => `<!-- agenticview:generated agent=${agentId} -->`;

/**
 * Names under which Claude Code exposes the worker MCP tools. As a plugin server the name is
 * `mcp__plugin_<plugin>_<server>__<tool>` (observed live: `mcp__plugin_agenticview_agenticview-worker__agenticview_report`);
 * the plain `mcp__<server>__<tool>` form covers a checkout that registers the server in its own .mcp.json.
 * The subagents never claim tasks, so agenticview_next_task is left out on purpose.
 */
export const WORKER_MCP_TOOLS = ["agenticview_report", "agenticview_complete", "agenticview_bridge"].flatMap((t) => [
  `mcp__plugin_agenticview_agenticview-worker__${t}`,
  `mcp__agenticview-worker__${t}`,
]);

/** Directory Claude Code reads project subagents from. */
export function subagentDir(projectPath: string): string {
  return join(projectPath, ".claude", "agents");
}

/** "Nova Prime!" -> "nova-prime" (falls back to "agent"). */
export function subagentSlug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "agent";
}

/** Unique-ish fallback name used when the plain name is taken by another agent's file. */
function suffixed(agent: Pick<Agent, "id" | "name">): string {
  return `${SUBAGENT_PREFIX}${subagentSlug(agent.name)}-${agent.id.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()}`;
}

/**
 * Subagent names for a set of agents: `agenticview-<slug>`, and the oldest agent keeps the plain
 * name when two slugs collide (the others get an id suffix).
 */
export function subagentNames(agents: Pick<Agent, "id" | "name" | "createdAt">[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const a of [...agents].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))) {
    const plain = `${SUBAGENT_PREFIX}${subagentSlug(a.name)}`;
    const name = taken.has(plain) ? suffixed(a) : plain;
    taken.add(name);
    out.set(a.id, name);
  }
  return out;
}

/** The `tools` frontmatter line, or undefined to inherit every tool (including all MCP tools). */
export function subagentTools(tools: Agent["tools"]): string[] | undefined {
  if (tools.edit && tools.shell && tools.web) return undefined;
  return [
    "Read",
    "Grep",
    "Glob",
    "TodoWrite",
    ...(tools.edit ? ["Edit", "Write", "MultiEdit", "NotebookEdit"] : []),
    ...(tools.shell ? ["Bash", "BashOutput", "KillShell"] : []),
    ...(tools.web ? ["WebFetch", "WebSearch"] : []),
    ...WORKER_MCP_TOOLS,
  ];
}

/** Subagent `model`: the agent's Claude family alias (opus, sonnet, haiku, fable), else inherit the session's. */
export function subagentModel(model: string | null | undefined): string {
  return modelFamily(model) ?? "inherit";
}

function description(agent: Agent): string {
  const what = [agent.specialty, agent.description].map((s) => s?.trim()).filter(Boolean).join(". ");
  const base = `AgenticView office agent ${agent.name}${agent.role === "manager" ? " (manager)" : ""}${what ? `: ${what}` : ""}`;
  return `${base.replace(/\s+/g, " ").slice(0, 400)}. Launched by the /agenticview-work coordinator with an AgenticView task (run_id); not for general use.`;
}

/** Full file text of an agent's subagent. */
export function renderSubagent(agent: Agent, name: string): string {
  const tools = subagentTools(agent.tools);
  const front = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description(agent))}`,
    ...(tools ? [`tools: ${tools.join(", ")}`] : []),
    `model: ${subagentModel(agent.model)}`,
    "---",
  ];
  const persona = [
    `You are ${agent.name}, ${agent.role === "manager" ? "the manager" : `a ${agent.specialty || "generalist"} engineer`} on an AgenticView team.`,
    agent.description ? `About you: ${agent.description}` : "",
    agent.systemPrompt,
  ].filter(Boolean);
  const body = [
    marker(agent.id),
    "<!-- Generated by AgenticView from the office agent. Edit the agent in the office; changes here are overwritten. Delete the marker line above to keep your own copy (the office then leaves this file alone). -->",
    "",
    ...persona,
    "",
    "## AgenticView worker protocol",
    "",
    "The coordinator session hands you ONE office task. It starts with `# AgenticView task <run_id>` and carries the working directory, allowed tools, office tools, your recent work and the task itself.",
    "",
    "- Pass `run_id` (from the task heading) on EVERY call to `agenticview_report`, `agenticview_complete` and `agenticview_bridge`. Several tasks run at once in this session; the run_id is how the office tells them apart.",
    "- Report progress briefly with `agenticview_report` at meaningful steps (a one-line `text`, or `events` such as `{\"type\":\"file_changed\",\"path\":\"src/a.ts\",\"kind\":\"modify\"}` after editing a file).",
    "- Respect the task's Allowed tools strictly, work in its Working directory, and follow its Agent system prompt.",
    "- Use `agenticview_bridge {run_id, tool, args}` for the task's Office tools (for a manager: list_agents, assign_task, await_tasks, ask_user...). await_tasks returns after about 4 minutes with `stillRunning`: call it again with those ids.",
    "- Read `Your recent work` in the task: it is what you did before in this project; continue from it instead of redoing it.",
    "- When done, call `agenticview_complete {run_id, result}` exactly once with your final answer (what you did, files changed, how you verified), or `{run_id, error}` if it could not be done. Then stop and reply with the same summary.",
    "- If a tool says the task was cancelled, stop at once and reply that it was cancelled.",
    "- Never call `agenticview_next_task`: only the coordinator claims tasks.",
    "",
  ];
  return [...front, ...body].join("\n");
}

/** The agent id in a generated file, or undefined for a user-authored file. */
export function generatedAgentId(text: string): string | undefined {
  return MARKER_RE.exec(text)?.[1];
}

export type WriteOutcome = { name: string; status: "written" | "unchanged" } | { name: string; status: "user-file" };

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/**
 * Write (or refresh) one agent's subagent file under `name`. A file there that the user wrote is left
 * alone (status "user-file"); a generated file that belongs to another agent makes this agent fall back
 * to an id-suffixed name.
 */
export async function writeSubagent(projectPath: string, agent: Agent, name: string): Promise<WriteOutcome> {
  const dir = subagentDir(projectPath);
  let use = name;
  let existing = await readText(join(dir, `${use}.md`));
  if (existing !== undefined) {
    const owner = generatedAgentId(existing);
    if (!owner) return { name: use, status: "user-file" };
    if (owner !== agent.id) {
      use = suffixed(agent);
      existing = await readText(join(dir, `${use}.md`));
      if (existing !== undefined && generatedAgentId(existing) !== agent.id) return { name: use, status: "user-file" };
    }
  }
  const text = renderSubagent(agent, use);
  if (existing === text) return { name: use, status: "unchanged" };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${use}.md`), text, "utf8");
  return { name: use, status: "written" };
}

export interface SyncResult {
  /** agent id -> subagent name actually used (only agents whose file exists and is ours). */
  names: Map<string, string>;
  written: string[];
  removed: string[];
  /** Names skipped because the user owns a file with that name. */
  userFiles: string[];
}

/**
 * Make `<project>/.claude/agents` match `agents` (the claude-session agents of this project): write or
 * refresh their files and delete generated files of anyone else, unless `keep(agentId)` says that
 * agent still wants its file (e.g. a hub agent working in this project). User files are never touched.
 */
export async function syncSubagents(projectPath: string, agents: Agent[], keep: (agentId: string) => Promise<boolean> = async () => false): Promise<SyncResult> {
  const res: SyncResult = { names: new Map(), written: [], removed: [], userFiles: [] };
  const wanted = subagentNames(agents);
  for (const a of agents) {
    const out = await writeSubagent(projectPath, a, wanted.get(a.id)!);
    if (out.status === "user-file") res.userFiles.push(out.name);
    else {
      res.names.set(a.id, out.name);
      if (out.status === "written") res.written.push(out.name);
    }
  }
  const dir = subagentDir(projectPath);
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return res;
  }
  const current = new Set(res.names.values());
  for (const f of files) {
    if (!f.startsWith(SUBAGENT_PREFIX) || !f.endsWith(".md")) continue;
    const name = f.slice(0, -3);
    if (current.has(name)) continue;
    const text = await readText(join(dir, f));
    const owner = text === undefined ? undefined : generatedAgentId(text);
    if (!owner) continue;
    // A renamed agent leaves its old file behind: it goes even though the agent stays.
    if (!res.names.has(owner) && (await keep(owner))) continue;
    await rm(join(dir, f), { force: true });
    res.removed.push(name);
  }
  return res;
}
