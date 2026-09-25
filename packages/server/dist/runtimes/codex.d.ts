import type { PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { Codex as CodexClass, ThreadEvent, SandboxMode } from "@openai/codex-sdk";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { type Which } from "./which.js";
export interface CodexSdk {
    Codex: typeof CodexClass;
}
export interface CodexRuntimeOptions {
    sdk?: CodexSdk;
    bridgeEntry: string;
    bridgeUrl: () => string;
    apiKey?: string;
    which?: Which;
}
export declare const CODEX_MISSING_REASON = "Install the Codex CLI (npm i -g @openai/codex) and sign in with `codex login` or set CODEX_API_KEY.";
/**
 * Permission mode → Codex sandbox. `ask` cannot prompt through the SDK, so it is read-only (the most
 * restrictive setting). Codex's Windows sandbox cannot write files, so `auto-edit` needs full access there.
 */
export declare function sandboxFor(mode: PermissionMode, platform?: NodeJS.Platform, tools?: ToolAllowance): SandboxMode;
/** Pure mapping from Codex thread events to RunEvents. `started` tracks tool items that already emitted tool_start. */
export declare function mapCodexEvent(ev: ThreadEvent, started: Set<string>): RunEvent[];
export declare class CodexRuntime implements Runtime {
    private readonly opts;
    readonly provider: "codex";
    private sdk?;
    private readonly which;
    constructor(opts: CodexRuntimeOptions);
    check(): Promise<ProviderStatus>;
    private loadSdk;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
/** ThreadOptions for a run: sandbox, plus model and `modelReasoningEffort` when the agent sets them. */
export declare function codexThreadOptions(req: RunRequest, platform: NodeJS.Platform): Record<string, unknown>;
