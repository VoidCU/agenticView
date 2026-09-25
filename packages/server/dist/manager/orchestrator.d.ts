import { type Agent, type Provider, type ProjectSettings, type PendingPermissionInfo, type PendingQuestionInfo, type Task, type WorldInfo } from "@agenticview/shared";
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
    private readonly queue;
    private readonly waiters;
    private readonly pendingPermissions;
    private readonly pendingQuestions;
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
    };
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
     * claude-session deadlock guard for a Manager run `runId`: the target agent's task could only be
     * picked up by the very session that is running the Manager (bound to it), which is busy until the
     * Manager finishes.
     */
    sessionConflict(runId: string, target: Agent): Promise<string | undefined>;
    private bridgeToolsFor;
    private appendLog;
    private finish;
    private execute;
}
