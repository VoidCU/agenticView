import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { Effort, PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { type Which } from "./which.js";
/**
 * Google Antigravity CLI (`agy`) runtime.
 *
 * Runs `agy -p <prompt> --output-format stream-json` headless. The CLI uses the user's Antigravity
 * sign-in (no API key). Bridge tools (delegate, report, ...) reach agy as a *workspace plugin*:
 * agy loads every `<cwd>/.agents/plugins/<name>/` that holds a `plugin.json`, and starts the MCP
 * servers in that plugin's `mcp_config.json`. Each run writes its own `agenticview-<runId>` plugin
 * and removes it afterwards, so the user's global `~/.gemini/config/mcp_config.json` is never
 * touched. agy caches tool schemas under `~/.gemini/antigravity-cli/mcp/<plugin>_<server>/`; that
 * cache directory is removed with the plugin.
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
}
/**
 * Permission handling (verified against agy 1.2.11 in headless `-p` mode):
 * - default mode auto-approves file edits inside the workspace and denies shell commands;
 * - `--mode accept-edits` behaves the same headless (edits yes, commands denied);
 * - `--mode plan` makes the agent plan first and denies commands (it can still write files when told to);
 * - `--dangerously-skip-permissions` approves everything.
 * So: ask -> default, auto-edit -> accept-edits, auto -> skip permissions (unless the agent may not use
 * the shell, then accept-edits), and read-only agents (no edit, no shell) -> plan.
 */
export declare function modeArgs(mode: PermissionMode, tools: ToolAllowance): string[];
export declare function buildAgyArgs(input: AgyArgsInput): string[];
/** Plain-language limits for allowances agy has no flag for; appended to the prompt. */
export declare function allowanceNotes(tools: ToolAllowance): string[];
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
/**
 * Write `<cwd>/.agents/plugins/agenticview-<runId>/` (plugin.json + mcp_config.json). Returns a
 * function that removes it again, plus `.agents/plugins` and `.agents` when this run created them
 * and they are empty, plus agy's tool-schema cache for the server.
 */
export declare function installBridgePlugin(cwd: string, runId: string, server: {
    command: string;
    args: string[];
    env: Record<string, string>;
}, home?: string): Promise<() => Promise<void>>;
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
