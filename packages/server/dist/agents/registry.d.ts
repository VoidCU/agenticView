import { type Agent, type Effort, type Role, type Scope, type Provider, type ToolAllowance, type PermissionMode, type Appearance } from "@agenticview/shared";
export type WorldRef = {
    kind: "project";
    projectPath: string;
} | {
    kind: "hub";
};
export interface CreateAgentInput {
    name: string;
    specialty: string;
    description?: string;
    provider?: Provider | null;
    model?: string | null;
    effort?: Effort | null;
    systemPrompt?: string;
    tools?: ToolAllowance;
    permissionMode?: PermissionMode;
    scope?: Scope;
    role?: Role;
    appearance?: Appearance;
}
export declare class ScopeError extends Error {
    constructor(msg: string);
}
/** Loads and edits agents across the global store and (in a project world) the project store. */
export declare class AgentRegistry {
    readonly world: WorldRef;
    private readonly global;
    private readonly project?;
    constructor(world: WorldRef);
    private storeFor;
    /** Project world: project agents plus global workers. Hub: every global agent. */
    list(): Promise<Agent[]>;
    get(id: string): Promise<Agent | undefined>;
    create(input: CreateAgentInput): Promise<Agent>;
    update(id: string, patch: Partial<Agent>): Promise<Agent>;
    /** Clone a global agent into this project with fresh id and stats, remembering its origin. */
    copyToProject(id: string): Promise<Agent>;
    /**
     * Persist the resolved desk of every worker that has none yet (their auto-seat depends on who else
     * is seated, so it would shift when someone moves). Returns the agents that changed.
     */
    pinPlacements(): Promise<Agent[]>;
    remove(id: string): Promise<void>;
    ensureManager(): Promise<Agent>;
    managerId(): Promise<string>;
}
