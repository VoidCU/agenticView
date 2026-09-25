import { type Effort, type PermissionMode, type Provider, type ProviderStatus, type RunEvent, type RunResult, type ToolAllowance, type WorkerSession } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
/**
 * `claude-session` provider: work is done by the user's own Claude Code sessions running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for sessions that pull them over HTTP (see api/worker.ts) and relays what they report.
 *
 * Sessions are identified by Claude Code's own session id, so the office recognises a session
 * again after it is closed and resumed. Agents are bound to a session ("affinity"):
 * - a session claims tasks of agents bound to it first;
 * - a task of an unbound agent goes to any free session, which then becomes the agent's session;
 * - a task of an agent bound to another known session waits for that session.
 */
export declare const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";
/** What a worker receives when it claims a run. */
export interface SessionTask {
    runId: string;
    /** Office task id (for display). */
    taskId?: string;
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
    /** Model requested in the office (informational: only the user can switch a session's model). */
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
    /** The claiming session as the office knows it (its reported model drives the mismatch note). */
    session?: {
        id: string;
        name: string;
        model: string | null;
    };
    /** True when the office hands back a task this session already claimed (e.g. after a reconnect). */
    redelivered?: boolean;
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
/** What a session tells the office about itself on each poll. */
export interface ClaimInfo {
    model?: string;
    cwd?: string;
    /** Agent name (or id) the user named in `/agenticview-work <agent>`: bind it to this session. */
    agent?: string;
}
/** Where bindings and session records live (the world's agent registry and store). */
export interface SessionHooks {
    bindingOf(agentId: string): Promise<string | null | undefined>;
    bind(agentId: string, session: {
        id: string;
        name: string;
    } | null): Promise<void>;
    findAgent(ref: string): Promise<{
        id: string;
        name: string;
    } | undefined>;
    save(sessions: WorkerSession[]): Promise<void>;
}
/** In-memory hooks (tests, and before a world attaches its own). */
export declare function memoryHooks(): SessionHooks & {
    bindings: Map<string, string | null>;
    agents: Map<string, string>;
};
export interface SessionRuntimeOptions {
    /** A worker counts as connected when it was seen within this window. */
    liveMs?: number;
    /** Called when the connected-worker count changes (to refresh provider chips). */
    onWorkersChanged?: () => void;
    now?: () => number;
    hooks?: SessionHooks;
}
export declare class SessionRuntime implements Runtime {
    readonly provider: Provider;
    private readonly queue;
    private readonly runs;
    /** runIds cancelled recently, so a worker's next call is told to stop. */
    private readonly cancelled;
    private readonly seen;
    private readonly waiters;
    private readonly sessions;
    private readonly persistedSeen;
    /** `${sessionId}\n${agentRef}` pairs already bound by name, so a later office re-bind sticks. */
    private readonly namedBinds;
    private readonly liveMs;
    private readonly now;
    private hooks;
    private lock;
    private lastCount;
    private lastSignature;
    /** Called when the connected-worker count changes (to refresh provider chips). */
    onWorkersChanged?: () => void;
    /** Called when the session list (records, online state, current work) changes. */
    onSessionsChanged?: () => void;
    constructor(opts?: SessionRuntimeOptions);
    static newWorkerId(): string;
    /** Attach the world's persistence and load the sessions it remembers. */
    attach(hooks: SessionHooks, sessions?: WorkerSession[]): void;
    private serialize;
    isOnline(id: string): boolean;
    /** Every known session with live state. */
    sessionList(): (WorkerSession & {
        online: boolean;
        currentRunId: string | null;
        currentAgentId: string | null;
        currentTaskId: string | null;
    })[];
    session(id: string): WorkerSession | undefined;
    /** The session working on a run, if any (used by the manager deadlock guard). */
    sessionOfRun(runId: string): string | undefined;
    rename(id: string, name: string): Promise<WorkerSession | undefined>;
    /** Forget a session record (its agents should be unbound by the caller). */
    forget(id: string): Promise<boolean>;
    private persist;
    /** Register a poll from a session: update its record and liveness. */
    private touch;
    /** Re-evaluate time-based online state (call periodically). */
    pulse(): void;
    /** Re-run dispatch (after a binding changed in the office). */
    kick(): void;
    private notifySessions;
    /** Number of sessions connected right now (polling within the liveness window or working on a run). */
    workers(): number;
    queued(): number;
    check(): Promise<ProviderStatus>;
    private notifyCount;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
    private queuedStatus;
    /** Pick the run a session should take: its bound agents first, then any unbound agent's. */
    private choose;
    /** Assign a run to a session (caller holds the lock). */
    private take;
    /** Hand queued runs to waiting sessions. */
    private dispatch;
    /**
     * Long-poll for the next run for session `workerId`. Resolves null when nothing arrives within
     * `waitMs`. A session that already holds a run (it reconnected mid-task) gets that run again.
     */
    claim(workerId: string, waitMs?: number, signal?: AbortSignal, info?: ClaimInfo): Promise<SessionTask | null>;
    /** `/agenticview-work <agent>`: bind that agent to this session (once per session and name). */
    private bindNamed;
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
