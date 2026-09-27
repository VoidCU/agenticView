import { AgentSchema, defaultAgent, MANAGER_TOOLS, buildSpacesFromLayout, defaultLayout, designatedSeats, isDeskKind, nextPlacement, planOffice, placementKey, seatLabel, } from "@agenticview/shared";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { JsonStore } from "../store/jsonStore.js";
import { globalRoot, projectRoot } from "../store/paths.js";
/**
 * Invariants applied to every stored agent:
 * - a claude-session agent inherits model and effort from the session that serves it, so none is stored;
 * - `sessionModel` is wire-only and never persisted.
 */
export function normalizeAgent(agent) {
    const out = { ...agent };
    delete out.sessionModel;
    if (out.provider === "claude-session") {
        out.model = null;
        out.effort = null;
    }
    return out;
}
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
    layout;
    ensureDesk;
    /**
     * The desk lock: every operation that changes a workSeat (create, copy, an update carrying workSeat,
     * move/swap, the workSeat migration) runs through this one queue, so the "is this desk free?" check and
     * the write that takes it are atomic. It is reentrant for the holder's own async chain (a move that
     * calls update, a create that grows the layout and re-runs the migration) via AsyncLocalStorage; the
     * token must still be the active holder, so a stray continuation after release queues normally.
     */
    deskQueue = Promise.resolve();
    deskHolder = null;
    deskContext = new AsyncLocalStorage();
    withDeskLock(fn) {
        const mine = this.deskContext.getStore();
        if (mine && mine === this.deskHolder)
            return fn();
        const token = {};
        const work = this.deskQueue.then(() => {
            this.deskHolder = token;
            return this.deskContext.run(token, fn);
        });
        this.deskQueue = work.then(() => { if (this.deskHolder === token)
            this.deskHolder = null; }, () => { if (this.deskHolder === token)
            this.deskHolder = null; });
        return work;
    }
    useLayout(layout, ensureDesk) {
        this.layout = layout;
        this.ensureDesk = ensureDesk;
    }
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
        return this.withDeskLock(() => this.createUnqueued(input));
    }
    async createUnqueued(input) {
        const scope = input.scope ?? (this.world.kind === "project" ? "project" : "global");
        const store = this.storeFor(scope);
        const agent = normalizeAgent(defaultAgent({
            ...input,
            role: input.role ?? "worker",
            scope,
            provider: input.provider ?? null,
            model: input.model ?? null,
        }));
        if (agent.role === "worker") {
            await this.ensureDesk?.((await this.list()).filter((a) => a.role === "worker").length + 1);
            // Take the next free desk now (nobody sits there and it is nobody's designated desk): it becomes
            // the new worker's workSeat, so the seat is stable even as the roster changes around it.
            const seat = nextPlacement(await this.list(), this.layout?.());
            if (seat) {
                agent.placement = { ...seat };
                agent.workSeat = { ...seat };
            }
        }
        await store.write(agent.id, agent);
        return agent;
    }
    async update(id, patch) {
        return "workSeat" in patch ? this.withDeskLock(() => this.updateUnlocked(id, patch)) : this.updateUnlocked(id, patch);
    }
    async updateUnlocked(id, patch) {
        const cur = await this.get(id);
        if (!cur)
            throw new Error(`Unknown agent ${id}`);
        if (patch.workSeat)
            await this.assertDeskFree(id, patch.workSeat);
        const next = normalizeAgent(AgentSchema.parse({
            ...cur,
            ...patch,
            id: cur.id,
            role: cur.role,
            scope: cur.scope,
            createdAt: cur.createdAt,
            updatedAt: new Date().toISOString(),
        }));
        await this.storeFor(cur.scope).write(id, next);
        return next;
    }
    /**
     * The office-wide invariants: two agents never share a designated desk (workSeat), and a designated desk
     * is a work desk (a seat of a pod, the Production Room or the Research Room). Call under the desk lock.
     */
    async assertDeskFree(id, seat) {
        const agents = await this.list();
        const spaces = buildSpacesFromLayout(this.layout?.() ?? defaultLayout(agents.filter((a) => a.role === "worker").length));
        const space = spaces.find((s) => s.id === seat.space);
        if (space && !isDeskKind(space.kind))
            throw new Error(`${space.name} has no work desks; a designated desk must be in a pod, the Production Room or the Research Room`);
        const owner = designatedSeats(agents, id).get(placementKey(seat));
        if (owner)
            throw new Error(`${seatLabel(spaces, seat)} is ${owner.name}'s designated desk`);
    }
    /** Clone a global agent into this project with fresh id and stats, remembering its origin. */
    async copyToProject(id) {
        return this.withDeskLock(() => this.copyToProjectUnlocked(id));
    }
    async copyToProjectUnlocked(id) {
        if (this.world.kind !== "project" || !this.project)
            throw new ScopeError("copyToProject requires a project world");
        const src = await this.get(id);
        if (!src)
            throw new Error(`Unknown agent ${id}`);
        if (src.scope !== "global")
            throw new ScopeError("Only global agents can be copied into a project");
        const { id: _id, stats: _stats, createdAt: _c, updatedAt: _u, originId: _o, placement: _p, workSeat: _w, ...rest } = src;
        const copy = defaultAgent({ ...rest, scope: "project", originId: src.id });
        if (copy.role === "worker") {
            const seat = nextPlacement(await this.list(), this.layout?.());
            if (seat) {
                copy.placement = { ...seat };
                copy.workSeat = { ...seat };
            }
        }
        await this.project.write(copy.id, copy);
        return copy;
    }
    /**
     * Persist the resolved desk of every worker that has none yet (their auto-seat depends on who else
     * is seated, so it would shift when someone moves). Returns the agents that changed.
     */
    async pinPlacements() {
        const all = await this.list();
        const { placements } = planOffice(all, this.layout?.());
        const changed = [];
        for (const a of all) {
            const p = placements[a.id];
            // Also re-pin a stale placement the plan ignored (a seat in a ring the office no longer has).
            const stale = a.placement && p && (a.placement.space !== p.space || a.placement.seat !== p.seat);
            if (a.role === "worker" && p && (!a.placement || stale))
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