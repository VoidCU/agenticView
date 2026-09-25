import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { Effort, PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { type Which } from "./which.js";
/**
 * Google Antigravity CLI (`agy`) runtime.
 *
 * Runs `agy -p <prompt> --output-format stream-json` headless on the user's Antigravity sign-in
 * (no API key). Everything below was verified against agy 1.2.11.
 *
 * Per-run workspace plugin. agy only has a *global* MCP config (~/.gemini/config/mcp_config.json),
 * but it also loads every `<cwd>/.agents/plugins/<name>/` that holds a `plugin.json`, starting the
 * MCP servers in its `mcp_config.json` and the hooks in its `hooks.json`. Each run that needs it
 * writes `agenticview-<runId>` there and deletes it afterwards (plus agy's schema cache for the
 * server under ~/.gemini/antigravity-cli/mcp/), so the global config is never touched.
 *
 * Permissions. Headless agy denies anything that would need approval: default mode and
 * `--mode accept-edits` allow workspace edits but deny shell commands *and MCP tool calls*; hooks
 * returning "allow" cannot lift that. Only `--dangerously-skip-permissions` lets bridge tools run.
 * PreToolUse hooks returning "deny" *are* honoured in every mode, and a hook that fails blocks the
 * tool. So a run with bridge tools uses skip-permissions and enforces the agent's limits with
 * deny hooks; a run without bridge tools uses the native mode (default / accept-edits / skip) and
 * the same deny hooks on top.
 */
export interface AntigravityRuntimeOptions {
    bin?: string;
    bridgeEntry: string;
    bridgeUrl: () => string;
    spawn?: typeof nodeSpawn;
    which?: Which;
    /** Override the platform (tests). */
    platform?: NodeJS.Platform;
    /** Override environment lookups such as LOCALAPPDATA (tests). */
    env?: NodeJS.ProcessEnv;
    /** Home directory holding `.gemini/antigravity-cli` (tests). */
    home?: string;
}
export declare const ANTIGRAVITY_MISSING_REASON = "Install the Antigravity CLI (agy) and sign in by running `agy` once.";
export interface AgyArgsInput {
    prompt: string;
    model?: string;
    effort?: Effort;
    sessionId?: string;
    permissionMode: PermissionMode;
    tools: ToolAllowance;
    /** Whether the run exposes bridge tools over MCP (forces skip-permissions, see above). */
    bridge?: boolean;
}
export declare const AGY_EDIT_TOOLS: readonly ["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"];
export declare const AGY_SHELL_TOOLS: readonly ["run_command", "send_command_input", "notebook_execution"];
export declare const AGY_WEB_TOOLS: readonly ["search_web", "read_url_content", "open_browser_url", "read_browser_page", "list_browser_pages", "browser_subagent", "browser_click_element", "browser_drag_pixel_to_pixel", "browser_get_dom", "browser_get_network_request", "browser_input", "browser_list_network_requests", "browser_mouse_down", "browser_mouse_up", "browser_move_mouse", "browser_press_key", "browser_refresh_page", "browser_resize_window", "browser_scroll", "browser_scroll_dom", "browser_select_option", "capture_browser_console_logs", "capture_browser_screenshot", "click_browser_pixel", "execute_browser_javascript"];
/**
 * What an agent may do on agy: `ask` cannot prompt headless, so like Codex it is read-only;
 * `auto-edit` edits without asking but runs no commands; `auto` does everything its allowances permit.
 */
export declare function effectiveAllowance(mode: PermissionMode, tools: ToolAllowance): {
    edit: boolean;
    shell: boolean;
    web: boolean;
};
/** agy tool names a run must block with deny hooks. */
export declare function deniedTools(mode: PermissionMode, tools: ToolAllowance): string[];
/** Permission flags: skip-permissions when bridge tools must work or the mode is `auto`, else agy's native mode. */
export declare function modeArgs(mode: PermissionMode, bridge?: boolean): string[];
export declare function buildAgyArgs(input: AgyArgsInput): string[];
/** Tells the model up front which tool groups are blocked, so it does not waste turns on them. */
export declare function allowanceNotes(mode: PermissionMode, tools: ToolAllowance): string[];
export interface AgyMapState {
    /** step_index -> buffered text deltas of an agent_response step. */
    text: Map<number, string>;
    /** step indexes whose tool_start was already emitted. */
    started: Set<number>;
}
export declare function newAgyMapState(): AgyMapState;
export interface AgyLineResult {
    events: RunEvent[];
    sessionId?: string;
    result?: {
        ok: boolean;
        error?: string;
        response?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    };
}
/** Flush all buffered text (end of stream). */
export declare function flushAgyText(state: AgyMapState): RunEvent[];
/**
 * Pure mapping from one agy stream-json line to RunEvents. agent_response text arrives as small
 * `text_delta` chunks; they are buffered per step and emitted as one text event when the step is
 * DONE (or when another step starts), so the office feed gets whole messages.
 */
export declare function mapAgyLine(line: string, state: AgyMapState): AgyLineResult;
export declare function pluginName(runId: string): string;
/** The MCP server name agy shows for the bridge (`<plugin>_<server>`). */
export declare function bridgeServerName(runId: string): string;
export interface RunPluginSpec {
    /** Bridge MCP server; omitted when the run has no bridge tools. */
    server?: {
        command: string;
        args: string[];
        env: Record<string, string>;
    };
    /** agy tool names to block with PreToolUse deny hooks. */
    deny: readonly string[];
}
/**
 * The shell command agy runs for a deny hook. agy runs hook commands through `cmd /c` on Windows and
 * escapes any `"` in them, which breaks both quoted paths and inline JSON; so on Windows the JSON
 * lives in `deny.cmd` and the command is quote-free (`cd /d` takes paths with spaces unquoted, and
 * the `.\` prefix is needed because agy's environment stops cmd searching the current directory).
 * If the command ever fails, agy blocks the tool anyway.
 */
export declare function denyHookCommand(dir: string, platform?: NodeJS.Platform): string;
export declare function hooksConfig(dir: string, deny: readonly string[], platform?: NodeJS.Platform): Record<string, unknown>;
/**
 * Write `<cwd>/.agents/plugins/agenticview-<runId>/` (plugin.json, plus mcp_config.json for the
 * bridge and hooks.json + deny.cmd for blocked tools). Returns a function that removes it again,
 * plus `.agents/plugins` and `.agents` when this run created them and they are empty, plus agy's
 * tool-schema cache for the server.
 */
export declare function installRunPlugin(cwd: string, runId: string, spec: RunPluginSpec, home?: string, platform?: NodeJS.Platform): Promise<() => Promise<void>>;
/**
 * Boot-time repair: remove bridge plugins a crashed server left in `<project>/.agents/plugins`, and
 * agy schema caches for AgenticView servers older than a day (other projects may still be running).
 */
export declare function cleanupAntigravityPlugins(projectPath: string, home?: string): Promise<void>;
/** Kill a process and its children. On Windows `child.kill()` leaves agy's helpers running. */
export declare function killTree(child: ChildProcess, platform?: NodeJS.Platform, spawn?: typeof nodeSpawn): void;
export declare class AntigravityRuntime implements Runtime {
    private readonly opts;
    readonly provider: "antigravity";
    private readonly spawn;
    private readonly which;
    private readonly platform;
    private readonly env;
    private readonly home;
    constructor(opts: AntigravityRuntimeOptions);
    /** agy on PATH, else the default Windows install location (%LOCALAPPDATA%\agy\bin\agy.exe). */
    locate(): Promise<string | undefined>;
    private version;
    check(): Promise<ProviderStatus>;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
