import {
  AgentSchema,
  defaultAgent,
  MANAGER_TOOLS,
  type Agent,
  type Effort,
  type Role,
  type Scope,
  type Provider,
  type ToolAllowance,
  type PermissionMode,
  type Appearance,
} from "@agenticview/shared";
import { join } from "node:path";
import { JsonStore } from "../store/jsonStore.js";
import { globalRoot, projectRoot } from "../store/paths.js";

export type WorldRef = { kind: "project"; projectPath: string } | { kind: "hub" };

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

export class ScopeError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ScopeError";
  }
}

/** Loads and edits agents across the global store and (in a project world) the project store. */
export class AgentRegistry {
  private readonly global: JsonStore<Agent>;
  private readonly project?: JsonStore<Agent>;

  constructor(readonly world: WorldRef) {
    this.global = new JsonStore(join(globalRoot(), "agents"), AgentSchema);
    if (world.kind === "project") {
      this.project = new JsonStore(join(projectRoot(world.projectPath), "agents"), AgentSchema);
    }
  }

  private storeFor(scope: Scope): JsonStore<Agent> {
    if (scope === "global") return this.global;
    if (!this.project) throw new ScopeError("Project-scoped agents are not available in the hub");
    return this.project;
  }

  /** Project world: project agents plus global workers. Hub: every global agent. */
  async list(): Promise<Agent[]> {
    const globals = (await this.global.list()).filter((a) => a.role !== "manager" || this.world.kind === "hub");
    if (!this.project) return globals;
    return [...(await this.project.list()), ...globals];
  }

  async get(id: string): Promise<Agent | undefined> {
    return (await this.project?.read(id)) ?? this.global.read(id);
  }

  async create(input: CreateAgentInput): Promise<Agent> {
    const scope = input.scope ?? (this.world.kind === "project" ? "project" : "global");
    const store = this.storeFor(scope);
    const agent = defaultAgent({
      ...input,
      role: input.role ?? "worker",
      scope,
      provider: input.provider ?? null,
      model: input.model ?? null,
    });
    await store.write(agent.id, agent);
    return agent;
  }

  async update(id: string, patch: Partial<Agent>): Promise<Agent> {
    const cur = await this.get(id);
    if (!cur) throw new Error(`Unknown agent ${id}`);
    const next = AgentSchema.parse({
      ...cur,
      ...patch,
      id: cur.id,
      role: cur.role,
      scope: cur.scope,
      createdAt: cur.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.storeFor(cur.scope).write(id, next);
    return next;
  }

  /** Clone a global agent into this project with fresh id and stats, remembering its origin. */
  async copyToProject(id: string): Promise<Agent> {
    if (this.world.kind !== "project" || !this.project) throw new ScopeError("copyToProject requires a project world");
    const src = await this.get(id);
    if (!src) throw new Error(`Unknown agent ${id}`);
    if (src.scope !== "global") throw new ScopeError("Only global agents can be copied into a project");
    const { id: _id, stats: _stats, createdAt: _c, updatedAt: _u, originId: _o, ...rest } = src;
    const copy = defaultAgent({ ...rest, scope: "project", originId: src.id });
    await this.project.write(copy.id, copy);
    return copy;
  }

  async remove(id: string): Promise<void> {
    const cur = await this.get(id);
    if (!cur) return;
    if (cur.role === "manager") throw new ScopeError("The manager cannot be removed");
    await this.storeFor(cur.scope).delete(id);
  }

  async ensureManager(): Promise<Agent> {
    const wantScope: Scope = this.world.kind === "project" ? "project" : "global";
    const existing = (await this.list()).find((a) => a.role === "manager" && a.scope === wantScope);
    if (existing) return existing;
    return this.create({
      name: this.world.kind === "project" ? "Atlas" : "Overseer",
      specialty: "manager",
      role: "manager",
      tools: { ...MANAGER_TOOLS },
      permissionMode: "auto",
    });
  }

  async managerId(): Promise<string> {
    return (await this.ensureManager()).id;
  }
}
