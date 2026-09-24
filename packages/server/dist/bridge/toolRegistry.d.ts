import type { BridgeTool } from "../runtimes/types.js";
export declare class BridgeAuthError extends Error {
    constructor();
}
export interface ToolDescription {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
/** Per-run registry of custom tools, guarded by a per-run token. Released tools are unreachable. */
export declare class ToolRegistry {
    private readonly runs;
    register(runId: string, tools: BridgeTool[]): {
        token: string;
    };
    release(runId: string): void;
    private auth;
    describe(runId: string, token: string): ToolDescription[];
    call(runId: string, token: string, name: string, args: unknown): Promise<string>;
}
