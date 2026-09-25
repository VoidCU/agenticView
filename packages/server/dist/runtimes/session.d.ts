import type { Effort, Provider, ProviderStatus, RunEvent, RunResult, ToolAllowance, PermissionMode } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
/**
 * `claude-session` provider: work is done by the user's own Claude Code session running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for workers that pull them over HTTP (see api/worker.ts) and relays what they report.
 */
export declare const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";
/** What a worker receives when it claims a run. */
export interface SessionTask {
    runId: string;
    agent: {
        id: string;
        name: string;
        role: string;
        specialty: string;
    };
    cwd: string;
    systemPrompt: string;
    prompt: string;
    images: string[];
    model?: string;
    /** Requested reasoning effort; the session cannot change it, so it scales thoroughness instead. */
    effort?: Effort;
    tools: ToolAllowance;
    permissionMode: PermissionMode;
    bridgeTools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }[];
}
export type WorkerReport = {
    type: "text";
    text: string;
} | {
    type: "tool_start";
    name: string;
    input?: unknown;
} | {
    type: "tool_end";
    name: string;
    ok?: boolean;
    summary?: string;
} | {
    type: "file_changed";
    path: string;
    kind?: "create" | "modify" | "delete";
} | {
    type: "status";
    text: string;
};
export type WorkerAck = {
    ok: true;
} | {
    ok: false;
    cancelled?: boolean;
    error: string;
};
export interface SessionRuntimeOptions {
    /** A worker counts as connected when it was seen within this window. */
    liveMs?: number;
    /** Called when the connected-worker count changes (to refresh provider chips). */
    onWorkersChanged?: () => void;
    now?: () => number;
}
export declare class SessionRuntime implements Runtime {
    readonly provider: Provider;
    private readonly queue;
    private readonly runs;
    /** runIds cancelled recently, so a worker's next call is told to stop. */
    private readonly cancelled;
    private readonly seen;
    private readonly waiters;
    private readonly liveMs;
    private readonly now;
    private lastCount;
    /** Called when the connected-worker count changes (to refresh provider chips). */
    onWorkersChanged?: () => void;
    constructor(opts?: SessionRuntimeOptions);
    static newWorkerId(): string;
    /** Number of workers seen within the liveness window (polling or working on a run). */
    workers(): number;
    queued(): number;
    check(): Promise<ProviderStatus>;
    private touch;
    private notifyCount;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
    /** Hand queued runs to waiting workers. */
    private dispatch;
    /** Long-poll for the next run. Resolves null when nothing arrives within `waitMs`. */
    claim(workerId: string, waitMs?: number, signal?: AbortSignal): Promise<SessionTask | null>;
    private active;
    report(runId: string, events: WorkerReport[], workerId?: string): WorkerAck;
    complete(runId: string, outcome: {
        text?: string;
        error?: string;
    }, workerId?: string): WorkerAck;
    /** The per-run bridge token (for calling bridge tools on the run's behalf), if the run is live. */
    bridgeAccess(runId: string, workerId?: string): {
        token: string;
    } | WorkerAck;
    /** Mark a run's event as a tool call (used by the worker bridge route). */
    emit(runId: string, e: RunEvent): void;
}
