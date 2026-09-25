import type { ProviderStatus, RunEvent, RunResult } from "@agenticview/shared";
import type { query as sdkQuery, tool as sdkTool, createSdkMcpServer as sdkCreateServer } from "@anthropic-ai/claude-agent-sdk";
import type { EventSink, Runtime, RunRequest } from "./types.js";
export interface ClaudeSdk {
    query: typeof sdkQuery;
    tool: typeof sdkTool;
    createSdkMcpServer: typeof sdkCreateServer;
}
export interface ClaudeRuntimeOptions {
    sdk?: ClaudeSdk;
    apiKey?: string;
}
export declare const CLAUDE_CREDENTIAL_ENV: readonly ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_ANTHROPIC_AWS"];
export declare const CLAUDE_MISSING_KEY_REASON = "Claude (API) needs ANTHROPIC_API_KEY (or a cloud provider env); it does not use the Claude Code login. Max/Pro subscribers: use the \"Claude Code session\" provider by running /agenticview-work in Claude Code.";
export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions";
export interface ClaudeOptionSubset {
    /** Which built-in tools exist for this run (availability). */
    tools: string[];
    /** Tools that never prompt: read-only tools and our own bridge tools. Edit/Bash are deliberately absent so `canUseTool` sees them. */
    allowedTools: string[];
    disallowedTools: string[];
    permissionMode: ClaudePermissionMode;
    allowDangerouslySkipPermissions?: boolean;
}
export declare function claudeOptionsFor(req: RunRequest): ClaudeOptionSubset;
type ToolUseInfo = {
    name: string;
    input: Record<string, unknown>;
};
/** Pure mapping from one SDK message to zero or more RunEvents. `pending` pairs tool results with their tool_use. */
export declare function mapClaudeMessage(raw: unknown, pending: Map<string, ToolUseInfo>): RunEvent[];
export declare class ClaudeRuntime implements Runtime {
    readonly provider: "claude";
    private sdk?;
    private readonly apiKey?;
    constructor(opts?: ClaudeRuntimeOptions);
    private hasCredential;
    check(): Promise<ProviderStatus>;
    private loadSdk;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
export {};
