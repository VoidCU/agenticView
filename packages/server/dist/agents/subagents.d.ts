import { type Agent } from "@agenticview/shared";
/**
 * Claude Code subagent files for `claude-session` agents.
 *
 * A Claude Code session running /agenticview-work is a coordinator: it launches each office task in a
 * background subagent of the agent's own type, several at once. Claude Code loads project subagents
 * from `<project>/.claude/agents/<name>.md` (YAML frontmatter `name`, `description`, optional `tools`
 * and `model`; the body is the system prompt). The office writes one file per agent, named
 * `agenticview-<slug>.md`, marks it as generated, and never touches a file without that marker.
 */
export declare const SUBAGENT_PREFIX = "agenticview-";
/**
 * Names under which Claude Code exposes the worker MCP tools. As a plugin server the name is
 * `mcp__plugin_<plugin>_<server>__<tool>` (observed live: `mcp__plugin_agenticview_agenticview-worker__agenticview_report`);
 * the plain `mcp__<server>__<tool>` form covers a checkout that registers the server in its own .mcp.json.
 * The subagents never claim tasks, so agenticview_next_task is left out on purpose.
 */
export declare const WORKER_MCP_TOOLS: string[];
/** Directory Claude Code reads project subagents from. */
export declare function subagentDir(projectPath: string): string;
/** "Nova Prime!" -> "nova-prime" (falls back to "agent"). */
export declare function subagentSlug(name: string): string;
/**
 * Subagent names for a set of agents: `agenticview-<slug>`, and the oldest agent keeps the plain
 * name when two slugs collide (the others get an id suffix).
 */
export declare function subagentNames(agents: Pick<Agent, "id" | "name" | "createdAt">[]): Map<string, string>;
/** The `tools` frontmatter line, or undefined to inherit every tool (including all MCP tools). */
export declare function subagentTools(tools: Agent["tools"]): string[] | undefined;
/** Subagent `model`: the agent's Claude family alias (opus, sonnet, haiku, fable), else inherit the session's. */
export declare function subagentModel(model: string | null | undefined): string;
/** Full file text of an agent's subagent. */
export declare function renderSubagent(agent: Agent, name: string): string;
/** The agent id in a generated file, or undefined for a user-authored file. */
export declare function generatedAgentId(text: string): string | undefined;
export type WriteOutcome = {
    name: string;
    status: "written" | "unchanged";
} | {
    name: string;
    status: "user-file";
};
/**
 * Write (or refresh) one agent's subagent file under `name`. A file there that the user wrote is left
 * alone (status "user-file"); a generated file that belongs to another agent makes this agent fall back
 * to an id-suffixed name.
 */
export declare function writeSubagent(projectPath: string, agent: Agent, name: string): Promise<WriteOutcome>;
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
export declare function syncSubagents(projectPath: string, agents: Agent[], keep?: (agentId: string) => Promise<boolean>): Promise<SyncResult>;
