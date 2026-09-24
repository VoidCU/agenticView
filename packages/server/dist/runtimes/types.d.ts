import type { z } from "zod";
import type { Agent, PermissionMode, PromptPart, Provider, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
/** A custom tool exposed to an agent for one run (Manager tools, screenshot, ...). */
export interface BridgeTool {
    name: string;
    description: string;
    schema: Record<string, z.ZodTypeAny>;
    handler: (args: Record<string, unknown>) => Promise<string>;
}
export interface PermissionRequest {
    id: string;
    tool: string;
    input: unknown;
}
export interface RunRequest {
    runId: string;
    agent: Agent;
    cwd: string;
    prompt: PromptPart[];
    systemPrompt: string;
    sessionId?: string;
    tools: ToolAllowance;
    bridgeTools: BridgeTool[];
    permissionMode: PermissionMode;
    model?: string;
    maxTurns?: number;
    /** Called by runtimes that support interactive permission prompts. Resolves true to allow. */
    onPermission?: (req: PermissionRequest) => Promise<boolean>;
}
export type EventSink = (e: RunEvent) => void;
export interface Runtime {
    readonly provider: Provider;
    check(): Promise<ProviderStatus>;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
