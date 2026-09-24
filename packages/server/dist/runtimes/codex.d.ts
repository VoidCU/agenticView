import type { ProviderStatus, RunEvent, RunResult } from "@agenticview/shared";
import type { Codex as CodexClass, ThreadEvent } from "@openai/codex-sdk";
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
