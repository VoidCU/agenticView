import { spawn as nodeSpawn } from "node:child_process";
import type { Effort, PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { type Which } from "./which.js";
/**
 * GitHub Copilot CLI (`copilot`) runtime.
 *
 * Runs `copilot -p <prompt> --output-format json` headless on the user's Copilot sign-in (no API
 * key; usage comes out of their Copilot plan). Everything below was verified against CLI 1.0.88.
 *
 * Output is JSONL: `{type, data, ephemeral?, id, timestamp}` session events, ending with
 * `{type:"result", sessionId, exitCode, usage}`. The events used here:
 * - `session.auto_mode_resolved` {chosenModel}: the model `--model auto` routed to.
 * - `assistant.message` {content, model, toolRequests}: one whole assistant message per turn (the
 *   `assistant.message_delta` stream is ignored, so the feed gets whole messages).
 * - `tool.execution_start` {toolCallId, toolName, arguments, mcpServerName?, mcpToolName?} and
 *   `tool.execution_complete` {toolCallId, success, result:{content}, error:{message, code}}. A tool
 *   blocked by a permission rule completes with success=false and error.code "denied".
 * - `session.error` / `error`: surfaced as status lines.
 * Token counts are not in the stream; `--usage-output-file` writes them (cumulative per session).
 *
 * Bridge tools. `--additional-mcp-config @<file>` adds MCP servers for one session only, so each
 * run writes `agenticview-<runId>` into a private temp dir and deletes it afterwards; the user's
 * ~/.copilot/mcp-config.json (what `copilot mcp add` edits) is never touched. Stale temp dirs from
 * a crashed server are swept at startup.
 *
 * Permissions. `--allow-all-tools` is required headless (otherwise anything needing approval is
 * denied, yet read-only shell commands still run), and `--deny-tool` rules beat it. So every run
 * allows all tools and denies what the agent may not do: `write` (file-writing tools, incl.
 * apply_patch), `shell` and `url`. auto-edit therefore maps to "edits yes, shell no" natively.
 */
export interface CopilotRuntimeOptions {
    bin?: string;
    bridgeEntry: string;
    bridgeUrl: () => string;
    spawn?: typeof nodeSpawn;
    which?: Which;
    platform?: NodeJS.Platform;
    /** Directory for per-run temp dirs (tests). */
    tmpDir?: string;
}
export declare const COPILOT_MISSING_REASON = "Install the GitHub Copilot CLI (npm i -g @github/copilot) and sign in with `copilot login`.";
/**
 * What an agent may do: `ask` cannot prompt headless, so (like Codex and Antigravity) it is read-only;
 * `auto-edit` edits without asking but runs no commands; `auto` does everything its allowances permit.
 */
export declare function effectiveAllowance(mode: PermissionMode, tools: ToolAllowance): {
    edit: boolean;
    shell: boolean;
    web: boolean;
};
/** `--deny-tool` rules for what the agent may not do (they take precedence over --allow-all-tools). */
export declare function denyRules(mode: PermissionMode, tools: ToolAllowance): string[];
export interface CopilotArgsInput {
    prompt: string;
    model?: string;
    effort?: Effort;
    sessionId?: string;
    permissionMode: PermissionMode;
    tools: ToolAllowance;
    /** Path of the per-run MCP config (bridge tools). */
    mcpConfig?: string;
    usageFile?: string;
    attachments?: string[];
}
export declare function buildCopilotArgs(input: CopilotArgsInput): string[];
/** Tells the model up front which tool groups are blocked, so it does not waste turns on them. */
export declare function allowanceNotes(mode: PermissionMode, tools: ToolAllowance): string[];
export declare function serverName(runId: string): string;
export interface CopilotMapState {
    /** toolCallId -> display name and raw tool name/arguments of tools started but not finished. */
    tools: Map<string, {
        name: string;
        raw: string;
        args: unknown;
    }>;
    /** Model already announced as a status line. */
    model?: string;
    denied: string[];
    cwd?: string;
}
export declare function newCopilotMapState(cwd?: string): CopilotMapState;
export interface CopilotLineResult {
    events: RunEvent[];
    sessionId?: string;
    result?: {
        exitCode: number;
    };
}
/** Files an apply_patch patch touches, from its `*** Add/Update/Delete File:` and `*** Move to:` headers. */
export declare function patchFiles(patch: string): Array<{
    path: string;
    kind: "create" | "modify" | "delete";
}>;
/** Pure mapping from one Copilot JSONL line to RunEvents. */
export declare function mapCopilotLine(line: string, state: CopilotMapState): CopilotLineResult;
export interface Tokens {
    inputTokens: number;
    outputTokens: number;
}
/** Session totals from a `--usage-output-file` report (sum over models). */
export declare function usageTotals(report: unknown): Tokens | undefined;
/**
 * The report is cumulative for the whole session, so a resumed run's usage is the difference from
 * the totals seen after the session's previous run. A resumed session whose earlier totals are
 * unknown (server restarted) reports no usage rather than double counting.
 */
export declare class SessionUsage {
    private readonly totals;
    delta(sessionId: string | undefined, resumed: boolean, totals: Tokens | undefined): Tokens | undefined;
}
/** Boot-time repair: remove per-run temp dirs (MCP config with a bridge token, prompt, usage) older than a day. */
export declare function cleanupCopilotTemp(dir?: string, now?: number): Promise<void>;
export declare class CopilotRuntime implements Runtime {
    private readonly opts;
    readonly provider: "copilot";
    private readonly spawn;
    private readonly which;
    private readonly platform;
    private readonly usage;
    constructor(opts: CopilotRuntimeOptions);
    /** The command to spawn: npm's Windows `.cmd` shim is unwrapped to `node <script>`. */
    private command;
    private version;
    check(): Promise<ProviderStatus>;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
    private attempt;
}
