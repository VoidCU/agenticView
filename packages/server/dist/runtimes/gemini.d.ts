import { spawn as nodeSpawn } from "node:child_process";
import type { ProviderStatus, RunEvent, RunResult } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { type Which } from "./which.js";
export interface GeminiRuntimeOptions {
    bin?: string;
    bridgeEntry: string;
    bridgeUrl: () => string;
    apiKey?: string;
    spawn?: typeof nodeSpawn;
    which?: Which;
}
export declare const GEMINI_MISSING_REASON = "Install the Gemini CLI (npm i -g @google/gemini-cli) and sign in, or set GEMINI_API_KEY.";
/** Pure mapping from one Gemini stream-json line to RunEvents. Returns `result` when the line is the final result. */
export declare function mapGeminiLine(line: string): {
    events: RunEvent[];
    sessionId?: string;
    result?: {
        ok: boolean;
        error?: string;
    };
};
export declare class GeminiRuntime implements Runtime {
    private readonly opts;
    readonly provider: "gemini";
    private readonly spawn;
    private readonly which;
    constructor(opts: GeminiRuntimeOptions);
    check(): Promise<ProviderStatus>;
    /** Temporarily merge the bridge MCP server into <cwd>/.gemini/settings.json; returns a restore function. */
    private installBridgeSettings;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
