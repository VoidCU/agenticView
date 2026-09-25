import { type Effort, type PermissionMode, type Provider, type ProviderStatus, type RunEvent, type RunResult, type SessionRunInfo, type ToolAllowance, type WorkerSession } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
/**
 * `claude-session` provider: work is done by the user's own Claude Code sessions running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for sessions that pull them over HTTP (see api/worker.ts) and relays what they report.
 *
 * A session is a coordinator: it claims several runs at once (up to its capacity) and runs each in a
 * background subagent of the agent's own type (`.claude/agents/agenticview-<slug>.md`). Every call
 * about a run names its run id, so the office tells the concurrent runs apart.
 *
 * Sessions are identified by Claude Code's own session id, so the office recognises a session
 * again after it is closed and resumed. Agents are bound to a session ("affinity"):
 * - a session claims tasks of agents bound to it first;
 * - a task of an unbound agent goes to any session with a free slot, which then becomes the agent's session;
 * - a task of an agent bound to another known session waits for that session;
 * - one agent runs one task at a time in a session (its subagent continues its own thread of work).
 */
export declare const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";
/** One earlier task of the agent, for the "Your recent work" digest. */
export interface RecentWork {
    taskId: string;
    title: string;
    status: string;
    /** Short result or error. */
    summary: string;
    files: string[];
    finishedAt?: string;
    subagentId?: string;
    sessionName?: string;
}
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
    /** Model requested in the office (a subagent with a Claude model alias really runs on it). */
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
    /** Claude Code subagent type to launch for this run (null: no file, do it in the main thread). */
    subagent?: string | null;
    /** The agent's previous tasks, newest first. */
    recentWork?: RecentWork[];
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
export interface ClaimOptions {
    /** Most new runs to hand out (default: every free slot). */
    max?: number;
    waitMs?: number;
    signal?: AbortSignal;
    info?: ClaimInfo;
    /**
     * Run ids the worker still tracks. Held runs missing from it are handed back (redelivered), and ids in
     * it that are no longer live for this session come back in `cancelled`. Omitted: legacy one-run worker.
     */
    holding?: string[];
}
export interface ClaimResult {
    tasks: SessionTask[];
    /** Run ids from `holding` that were cancelled in the office: stop their subagents. */
    cancelled: string[];
    /** Run ids from `holding` that are finished or unknown (completed elsewhere, office restarted): forget them. */
    gone: string[];
    capacity: number;
    /** Runs this session holds after the claim. */
    held: number;
}
/** What the office records about a run as it is claimed, reported on and finished. */
export interface RunAttribution {
    runId: string;
    taskId?: string;
    agentId: string;
    sessionId: string;
    sessionName: string;
    subagent?: string;
    subagentId?: string;
    files?: string[];
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
    save(sessions: WorkerSessionRecord[]): Promise<void>;
    /** Before a run is handed out: make sure its subagent file exists and collect the agent's recent work. */
    prepare?(req: RunRequest): Promise<{
        subagent: string | null;
        recentWork: RecentWork[];
    }>;
    /** A run was claimed, or its subagent id / changed files became known. */
    attribute?(info: RunAttribution): void | Promise<void>;
}
/** Session record as persisted (capacity may be missing in files written by older versions). */
export type WorkerSessionRecord = WorkerSession;
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
    /** Live runs a session holds, oldest claim first. */
    private held;
    /** How many runs a session may hold at once. */
    capacityOf(id: string): number;
    /** Free slots of a session right now. */
    freeSlots(id: string): number;
    /** Every known session with live state. */
    sessionList(): (WorkerSession & {
        online: boolean;
        currentRunId: string | null;
        currentAgentId: string | null;
        currentTaskId: string | null;
        runs: SessionRunInfo[];
    })[];
    session(id: string): WorkerSession | undefined;
    /** The session working on a run, if any (used by the manager deadlock guard). */
    sessionOfRun(runId: string): string | undefined;
    /**
     * Slots of `sessionId` that could ever run another task while the runs in `waitingRunIds` (Managers
     * blocked on their workers) keep theirs: capacity minus those held, waiting runs.
     */
    spareSlotsBeside(sessionId: string, waitingRunIds: string[]): number;
    rename(id: string, name: string): Promise<WorkerSession | undefined>;
    /** Change how many runs a session holds at once (persisted). */
    setCapacity(id: string, capacity: number): Promise<WorkerSession | undefined>;
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
    /** Assign a run to a session when it has a free slot (caller holds the lock). */
    private take;
    private attribute;
    private toTask;
    /** Hand queued runs to waiting sessions. */
    private dispatch;
    /**
     * Legacy single-run long-poll (one task per session): resolves null when nothing arrives within
     * `waitMs`. A session that already holds a run (it reconnected mid-task) gets that run again.
     */
    claim(workerId: string, waitMs?: number, signal?: AbortSignal, info?: ClaimInfo): Promise<SessionTask | null>;
    /**
     * Long-poll for up to `max` runs for session `workerId` (never more than its free slots). Returns as
     * soon as at least one run is available, a held run is cancelled, or `waitMs` passes.
     */
    claimMany(workerId: string, opts?: ClaimOptions): Promise<ClaimResult>;
    /** `/agenticview-work <agent>`: bind that agent to this session (once per session and name). */
    private bindNamed;
    private active;
    /** Remember the subagent instance a session reported for a run (shown in the office, kept on the task). */
    private noteSubagent;
    report(runId: string, events: WorkerReport[], workerId?: string, subagentId?: string): WorkerAck;
    complete(runId: string, outcome: {
        text?: string;
        error?: string;
        subagentId?: string;
    }, workerId?: string): WorkerAck;
    /** The per-run bridge token (for calling bridge tools on the run's behalf), if the run is live. */
    bridgeAccess(runId: string, workerId?: string): {
        token: string;
    } | WorkerAck;
    /** Mark a run's event as a tool call (used by the worker bridge route). */
    emit(runId: string, e: RunEvent): void;
}
