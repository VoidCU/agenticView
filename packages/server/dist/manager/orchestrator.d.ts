import { type Agent, type Provider, type ProjectSettings, type PendingPermissionInfo, type PendingQuestionInfo, type PendingLimitInfo, type Task, type WorldInfo } from "@agenticview/shared";
import type { AgentRegistry, WorldRef } from "../agents/registry.js";
import type { TaskService } from "../tasks/taskService.js";
import type { BridgeTool, Runtime } from "../runtimes/types.js";
import type { ToolRegistry } from "../bridge/toolRegistry.js";
import type { EventBus } from "../events/bus.js";
export interface ResolvedSettings extends ProjectSettings {
    globalDefaultProvider: Provider | null;
    globalDefaultModel: string | null;
    providerModels: Partial<Record<Provider, string | undefined>>;
}
import type { UsageTracker } from "./usageTracker.js";
export interface WorldDeps {
    world: WorldRef;
    root: string;
    registry: AgentRegistry;
    tasks: TaskService;
    runtimes: Map<Provider, Runtime>;
    toolRegistry: ToolRegistry;
    bus: EventBus;
    settings: () => ResolvedSettings;
    info: () => Promise<WorldInfo>;
    bridgeUrl: () => string;
    knownProjects: () => {
        path: string;
        name: string;
        lastOpened: string;
    }[];
    /** Extra bridge tools for worker runs (e.g. take_screenshot). */
    workerTools?: (agent: Agent, task: Task) => BridgeTool[];
    spaceNames?: () => Record<string, string>;
    renameSpace?: (id: string, name: string) => Promise<void>;
    usageTracker?: UsageTracker;
    emitProviders?: () => Promise<void>;
    addRoom?: (kind: "pod" | "meeting" | "lounge", name: string) => Promise<{
        ok: true;
        spaceId: string;
    } | {
        ok: false;
        message: string;
    }>;
    /** Override the auto-revive delay (ms) for tests. Default 6000. */
    reviveDelayMs?: number;
    /** Override the revive-done clear delay (ms) for tests. Default 5000. */
    reviveClearMs?: number;
}
export interface UserMessageInput {
    agentId: string;
    text: string;
    images?: string[];
    projectPath?: string;
}
/** Runs tasks on runtimes, keeps the Manager's map truthful, and mediates permissions and questions. */
export declare class Orchestrator {
    private readonly deps;
    private readonly aborts;
    private readonly active;
    /** Agent+conversation keys a run is currently resuming (see execute). */
    private readonly resuming;
    private readonly queue;
    private readonly waiters;
    private readonly pendingPermissions;
    private readonly pendingQuestions;
    private readonly pendingLimits;
    private pumping;
    constructor(deps: WorldDeps);
    running(): number;
    /**
     * Provider and model for an agent. `auto` is what "Automatic" currently resolves to (see
     * autoProvider()); without it an unset default falls back to Claude.
     */
    resolveProvider(agent: Agent, auto?: Provider | null): {
        provider: Provider;
        model?: string;
    };
    /** True when no explicit provider applies to this agent, so "Automatic" decides. */
    private isAutomatic;
    /** "Automatic": the first provider in PROVIDER_ORDER whose check() is ok, or null when none is. */
    autoProvider(): Promise<Provider | null>;
    /** resolveProvider(), consulting the live provider checks when the agent is on Automatic. */
    resolveProviderLive(agent: Agent): Promise<{
        provider: Provider;
        model?: string;
    }>;
    /** Returns a human-readable problem when the agent's provider cannot run, else undefined. */
    providerProblem(agent: Agent): Promise<string | undefined>;
    emitAgent(agent: Agent): void;
    handleUserMessage(input: UserMessageInput): Promise<Task>;
    startTask(taskId: string): void;
    private pump;
    awaitTask(taskId: string): Promise<Task>;
    private settle;
    /** Cancel a task; a request also cancels every non-terminal child it spawned. */
    cancel(taskId: string): Promise<void>;
    /** Prompts currently waiting on the user, for snapshots and reconnecting tabs. */
    pending(): {
        permissions: PendingPermissionInfo[];
        questions: PendingQuestionInfo[];
        limits: PendingLimitInfo[];
    };
    respondLimit(id: string, answer: "accept" | "choose" | "dismiss", provider?: Provider, model?: string): void;
    /** Returns the cheapest available provider when preferCheapModels is on, or undefined. */
    cheapProvider(): Promise<{
        provider: Provider;
        model: string;
    } | undefined>;
    /**
     * Pick the next provider after `failedProvider` in the configured failoverOrder, skipping
     * providers that have no runtime or are currently limited.  Falls back to
     * REVIVE_CANDIDATES_FALLBACK when failoverOrder is empty.
     */
    pickReviveProvider(failedProvider: Provider): {
        provider: Provider;
        model?: string;
    } | undefined;
    /** Trigger the revive state machine for a worker agent after a quota/rate-limit failure. */
    private triggerRevive;
    /** Switch agent to a new provider and retry its last failed task. */
    reviveAgent(agentId: string, provider?: Provider, model?: string): Promise<void>;
    /** A task that ended (or was cancelled) can no longer be waiting on anyone: deny/close its prompts. */
    private resolvePendingFor;
    respondPermission(id: string, allow: boolean): void;
    respondQuestion(id: string, answer: string): void;
    private setWaiting;
    requestPermission(taskId: string, agentId: string, req: {
        id: string;
        tool: string;
        input: unknown;
    }): Promise<boolean>;
    askUser(taskId: string, agentId: string, question: string): Promise<string>;
    private sessionKey;
    private sessionFile;
    private loadSession;
    private saveSession;
    private buildPrompt;
    /**
     * claude-session deadlock guard for a Manager run `runId`. A session runs several tasks at once (one
     * subagent each), so a worker bound to the Manager's own session is fine as long as that session has
     * a slot the waiting Manager does not occupy. It is a deadlock only when the target's task could be
     * picked up by nothing but that session and every slot of it is held by a waiting Manager.
     */
    sessionConflict(runId: string, target: Agent): Promise<string | undefined>;
    private bridgeToolsFor;
    private appendLog;
    private finish;
    private execute;
}
