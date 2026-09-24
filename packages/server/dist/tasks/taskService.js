import { TaskSchema, TASK_LOG_CAP, isTerminal, newId, xpFor, levelFor, } from "@agenticview/shared";
import { JsonStore } from "../store/jsonStore.js";
import { assertTransition } from "./transitions.js";
/** Persists tasks, enforces the transition table, and serialises writes per task id. */
export class TaskService {
    onChange;
    store;
    locks = new Map();
    constructor(dir, onChange) {
        this.onChange = onChange;
        this.store = new JsonStore(dir, TaskSchema);
    }
    locked(id, fn) {
        const prev = this.locks.get(id) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        this.locks.set(id, next.catch(() => undefined));
        return next;
    }
    async create(input) {
        const task = {
            id: newId("t"),
            kind: input.kind,
            title: input.title,
            description: input.description,
            status: "queued",
            createdBy: input.createdBy,
            assigneeId: input.assigneeId,
            projectPath: input.projectPath,
            images: input.images ?? [],
            log: [],
            createdAt: new Date().toISOString(),
        };
        if (input.parentId)
            task.parentId = input.parentId;
        await this.store.write(task.id, task);
        this.onChange(task, "state");
        return task;
    }
    get(id) {
        return this.store.read(id);
    }
    list() {
        return this.store.list();
    }
    async children(id) {
        return (await this.list()).filter((t) => t.parentId === id);
    }
    transition(id, to, patch = {}) {
        return this.locked(id, async () => {
            const cur = await this.store.read(id);
            if (!cur)
                throw new Error(`Unknown task ${id}`);
            assertTransition(cur.status, to);
            const now = new Date().toISOString();
            const next = { ...cur, ...patch, status: to };
            if (to === "running" && !cur.startedAt)
                next.startedAt = now;
            if (isTerminal(to))
                next.finishedAt = now;
            await this.store.write(id, next);
            this.onChange(next, "state");
            return next;
        });
    }
    log(id, type, text) {
        return this.locked(id, async () => {
            const cur = await this.store.read(id);
            if (!cur)
                return;
            const next = { ...cur, log: [...cur.log, { ts: new Date().toISOString(), type, text }].slice(-TASK_LOG_CAP) };
            await this.store.write(id, next);
            this.onChange(next, "log");
        });
    }
    /** Replace the most recent log entry (used to coalesce streamed text). No-op when the log is empty. */
    replaceLastLog(id, entry) {
        return this.locked(id, async () => {
            const cur = await this.store.read(id);
            if (!cur || cur.log.length === 0)
                return;
            const next = { ...cur, log: [...cur.log.slice(0, -1), entry] };
            await this.store.write(id, next);
            this.onChange(next, "log");
        });
    }
    /** Called on boot: anything still running or waiting was interrupted by a server restart. */
    async recoverInterrupted() {
        const out = [];
        for (const t of await this.list()) {
            if (t.status === "running" || t.status === "waiting") {
                out.push(await this.transition(t.id, "failed", { error: "interrupted" }));
            }
        }
        return out;
    }
    /** Award XP and bump counters on the assignee for a terminal task. */
    async awardXp(registry, task) {
        const agent = await registry.get(task.assigneeId);
        if (!agent)
            return;
        const xp = agent.stats.xp + (task.status === "done" ? xpFor(task.kind, agent.role) : 0);
        await registry.update(agent.id, {
            stats: {
                xp,
                level: levelFor(xp),
                tasksDone: agent.stats.tasksDone + (task.status === "done" ? 1 : 0),
                tasksFailed: agent.stats.tasksFailed + (task.status === "failed" ? 1 : 0),
            },
        });
    }
}
//# sourceMappingURL=taskService.js.map