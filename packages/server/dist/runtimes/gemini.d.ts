import { spawn as nodeSpawn } from "node:child_process";
import type { ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
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
/** Gemini tool names to exclude for each allowance that is off. */
export declare function excludedToolsFor(tools: ToolAllowance): string[];
/**
 * npm installs CLIs on Windows as `.cmd` shims that Node cannot spawn directly. Resolve the shim's
 * target script so we can run it with `process.execPath`. Returns undefined when the file is not a shim.
 */
export declare function resolveNodeShim(bin: string): Promise<string | undefined>;
/** Pure mapping from one Gemini stream-json line to RunEvents. Returns `result` when the line is the final result. */
export declare function mapGeminiLine(line: string): {
    events: RunEvent[];
    sessionId?: string;
    result?: {
        ok: boolean;
        error?: string;
    };
};
/** Boot-time repair: strip entries a crashed server left behind in <project>/.gemini/settings.json. */
export declare function cleanupGeminiSettings(projectPath: string): Promise<void>;
export declare class GeminiRuntime implements Runtime {
    private readonly opts;
    readonly provider: "gemini";
    private readonly spawn;
    private readonly which;
    constructor(opts: GeminiRuntimeOptions);
    check(): Promise<ProviderStatus>;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
