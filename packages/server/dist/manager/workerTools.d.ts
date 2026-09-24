import type { Agent } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import { type ScreenshotOptions } from "../screenshot/screenshot.js";
export interface WorkerToolContext {
    projectPath: string;
    agent: Agent;
    screenshot?: (url: string, outDir: string, opts: ScreenshotOptions) => Promise<{
        path: string;
    }>;
}
/** Bridge tools available to a worker run, gated by the agent's tool allowance. */
export declare function workerTools(ctx: WorkerToolContext): BridgeTool[];
