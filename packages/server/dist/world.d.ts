import { type GlobalConfig, type ProjectSettings, type Provider, type ProviderStatus, type Snapshot, type WorldInfo, type WorkerSessionInfo, type Effort, type LimitsReport, type UsageReport, type GamesData } from "@agenticview/shared";
import { UsageTracker } from "./manager/usageTracker.js";
import { SessionRuntime } from "./runtimes/session.js";
import { type SyncResult } from "./agents/subagents.js";
import { AgentRegistry, type WorldRef } from "./agents/registry.js";
import { TaskService } from "./tasks/taskService.js";
import { Orchestrator, type ResolvedSettings } from "./manager/orchestrator.js";
import type { Runtime, BridgeTool } from "./runtimes/types.js";
import type { ToolRegistry } from "./bridge/toolRegistry.js";
import type { EventBus } from "./events/bus.js";
import { type Agent, type Task } from "@agenticview/shared";
export interface WorldOptions {
    runtimes: Map<Provider, Runtime>;
    bus: EventBus;
    toolRegistry: ToolRegistry;
    bridgeUrl: () => string;
    workerTools?: (agent: Agent, task: Task) => BridgeTool[];
}
export interface World {
    ref: WorldRef;
    root: string;
    registry: AgentRegistry;
    tasks: TaskService;
    orchestrator: Orchestrator;
    bus: EventBus;
    runtimes: Map<Provider, Runtime>;
    settings: () => ResolvedSettings;
    updateSettings: (patch: Partial<ProjectSettings>) => Promise<ProjectSettings>;
    info: () => Promise<WorldInfo>;
    snapshot: () => Promise<Snapshot>;
    providerStatuses: () => Promise<ProviderStatus[]>;
    /** Claude Code sessions known to this world, with live state and the agents bound to each. */
    sessions: () => Promise<WorkerSessionInfo[]>;
    /** Rewrite the project's claude-session subagent files (project worlds; no-op in the hub). */
    syncSubagents: () => Promise<SyncResult | undefined>;
    /** The claude-session runtime, when configured. */
    sessionRuntime?: SessionRuntime;
    /** Push fresh provider availability (and the Automatic choice) to every client. */
    emitProviders: () => Promise<void>;
    /** Tracker for token usage, rate limits, and provider limit states. */
    usageTracker: UsageTracker;
    switchAgent: (id: string, patch: {
        provider?: Provider | null;
        model?: string | null;
        effort?: Effort | null;
    }) => Promise<Agent>;
    switchProvider: (fromProvider: Provider, opts: {
        toProvider: Provider;
        toModel?: string | null;
    }) => Promise<{
        count: number;
        agents: Agent[];
    }>;
    retryTask: (taskId: string) => Promise<Task>;
    resolveTask: (taskId: string, byTaskId: string | undefined, note: string) => Promise<Task>;
    unresolveTask: (taskId: string) => Promise<Task>;
    getLimits: () => Promise<LimitsReport>;
    getUsage: () => Promise<UsageReport>;
    getGames: () => Promise<GamesData>;
    playUser: (opponentId: string, matchId: string | undefined, move: import("@agenticview/shared").Move) => Promise<import("@agenticview/shared").GameRoundResult>;
    /**
     * Add a new room to the office layout.
     * Returns {ok:true, spaceId} on success or {ok:false, message} when the office is full.
     */
    addRoom: (kind: "pod" | "meeting" | "lounge", name: string) => Promise<{
        ok: true;
        spaceId: string;
    } | {
        ok: false;
        message: string;
    }>;
    /**
     * Remove an empty room from the office layout. Refuses if any agents are seated there.
     */
    removeRoom: (spaceId: string) => Promise<{
        ok: true;
    } | {
        ok: false;
        message: string;
    }>;
}
export declare function globalConfigPath(): string;
export declare function readGlobalConfig(): Promise<GlobalConfig>;
export declare function rememberProject(projectPath: string): Promise<GlobalConfig>;
/** Wire persistence, registry, tasks, and the orchestrator for one project or the hub. */
export declare function createWorld(ref: WorldRef, opts: WorldOptions): Promise<World>;
/** Wire form of a task: identical minus the (potentially large) log. */
export declare function toWire(task: Task): Task;
