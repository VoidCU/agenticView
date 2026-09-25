import { AgentSchema, defaultAgent, MANAGER_TOOLS, planOffice, } from "@agenticview/shared";
import { join } from "node:path";
import { JsonStore } from "../store/jsonStore.js";
import { globalRoot, projectRoot } from "../store/paths.js";
export class ScopeError extends Error {
    constructor(msg) {
        super(msg);
        this.name = "ScopeError";
    }
}
/** Loads and edits agents across the global store and (in a project world) the project store. */
export class AgentRegistry {
    world;
    global;
    project;
    constructor(world) {
        this.world = world;
        this.global = new JsonStore(join(globalRoot(), "agents"), AgentSchema);
        if (world.kind === "project") {
            this.project = new JsonStore(join(projectRoot(world.projectPath), "agents"), AgentSchema);
        }
    }
    storeFor(scope) {
        if (scope === "global")
            return this.global;
        if (!this.project)
            throw new ScopeError("Project-scoped agents are not available in the hub");
        return this.project;
    }
    /** Project world: project agents plus global workers. Hub: every global agent. */
    async list() {
        const globals = (await this.global.list()).filter((a) => a.role !== "manager" || this.world.kind === "hub");
        if (!this.project)
            return globals;
        return [...(await this.project.list()), ...globals];
    }
    async get(id) {
        return (await this.project?.read(id)) ?? this.global.read(id);
    }
    async create(input) {
        const scope = input.scope ?? (this.world.kind === "project" ? "project" : "global");
        const store = this.storeFor(scope);
        const agent = defaultAgent({
            ...input,
            role: input.role ?? "worker",
            scope,
            provider: input.provider ?? null,
            model: input.model ?? null,
        });
        if (agent.role === "worker") {
            // Take the next free desk now so the seat is stable even as the roster changes around it.
            const seat = planOffice([...(await this.list()), agent]).placements[agent.id];
            if (seat)
                agent.placement = seat;
        }
        await store.write(agent.id, agent);
        return agent;
    }
    async update(id, patch) {
        const cur = await this.get(id);
        if (!cur)
            throw new Error(`Unknown agent ${id}`);
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
    async copyToProject(id) {
        if (this.world.kind !== "project" || !this.project)
            throw new ScopeError("copyToProject requires a project world");
        const src = await this.get(id);
        if (!src)
            throw new Error(`Unknown agent ${id}`);
        if (src.scope !== "global")
            throw new ScopeError("Only global agents can be copied into a project");
        const { id: _id, stats: _stats, createdAt: _c, updatedAt: _u, originId: _o, placement: _p, ...rest } = src;
        const copy = defaultAgent({ ...rest, scope: "project", originId: src.id });
        await this.project.write(copy.id, copy);
        return copy;
    }
    /**
     * Persist the resolved desk of every worker that has none yet (their auto-seat depends on who else
     * is seated, so it would shift when someone moves). Returns the agents that changed.
     */
    async pinPlacements() {
        const all = await this.list();
        const { placements } = planOffice(all);
        const changed = [];
        for (const a of all) {
            const p = placements[a.id];
            if (a.role === "worker" && !a.placement && p)
                changed.push(await this.update(a.id, { placement: p }));
        }
        return changed;
    }
    async remove(id) {
        const cur = await this.get(id);
        if (!cur)
            return;
        if (cur.role === "manager")
            throw new ScopeError("The manager cannot be removed");
        await this.storeFor(cur.scope).delete(id);
    }
    async ensureManager() {
        const wantScope = this.world.kind === "project" ? "project" : "global";
        const existing = (await this.list()).find((a) => a.role === "manager" && a.scope === wantScope);
        if (existing)
            return existing;
        return this.create({
            name: this.world.kind === "project" ? "Atlas" : "Overseer",
            specialty: "manager",
            role: "manager",
            tools: { ...MANAGER_TOOLS },
            permissionMode: "auto",
        });
    }
    async managerId() {
        return (await this.ensureManager()).id;
    }
}
//# sourceMappingURL=registry.js.map