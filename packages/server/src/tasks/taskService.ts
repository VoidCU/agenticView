import {
  TaskSchema,
  TASK_LOG_CAP,
  isTerminal,
  newId,
  xpFor,
  levelFor,
  type Task,
  type TaskKind,
  type TaskLogEntry,
  type TaskStatus,
  type TaskWorker,
} from "@agenticview/shared";
import { JsonStore } from "../store/jsonStore.js";
import { assertTransition } from "./transitions.js";
import type { AgentRegistry } from "../agents/registry.js";

export interface CreateTaskInput {
  kind: TaskKind;
  title: string;
  description: string;
  createdBy: string;
  assigneeId: string;
  projectPath: string;
  parentId?: string;
  images?: string[];
}

export type TaskPatch = Partial<Pick<Task, "result" | "error" | "session">>;

/** `state`: status/result/session changed (worth broadcasting). `log`: only the log grew. */
export type TaskChangeKind = "state" | "log";

/** Persists tasks, enforces the transition table, and serialises writes per task id. */
export class TaskService {
  private readonly store: JsonStore<Task>;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    dir: string,
    private readonly onChange: (t: Task, kind: TaskChangeKind) => void,
  ) {
    this.store = new JsonStore(dir, TaskSchema);
  }

  private locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const task: Task = {
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
    if (input.parentId) task.parentId = input.parentId;
    await this.store.write(task.id, task);
    this.onChange(task, "state");
    return task;
  }

  get(id: string): Promise<Task | undefined> {
    return this.store.read(id);
  }

  list(): Promise<Task[]> {
    return this.store.list();
  }

  async children(id: string): Promise<Task[]> {
    return (await this.list()).filter((t) => t.parentId === id);
  }

  transition(id: string, to: TaskStatus, patch: TaskPatch = {}): Promise<Task> {
    return this.locked(id, async () => {
      const cur = await this.store.read(id);
      if (!cur) throw new Error(`Unknown task ${id}`);
      assertTransition(cur.status, to);
      const now = new Date().toISOString();
      const next: Task = { ...cur, ...patch, status: to };
      if (to === "running" && !cur.startedAt) next.startedAt = now;
      if (isTerminal(to)) next.finishedAt = now;
      await this.store.write(id, next);
      this.onChange(next, "state");
      return next;
    });
  }

  log(id: string, type: string, text: string): Promise<void> {
    return this.locked(id, async () => {
      const cur = await this.store.read(id);
      if (!cur) return;
      const next: Task = { ...cur, log: [...cur.log, { ts: new Date().toISOString(), type, text }].slice(-TASK_LOG_CAP) };
      await this.store.write(id, next);
      this.onChange(next, "log");
    });
  }

  /** Merge who worked on a task (claude-session attribution) without changing its status. */
  setWorker(id: string, worker: TaskWorker): Promise<Task | undefined> {
    return this.locked(id, async () => {
      const cur = await this.store.read(id);
      if (!cur) return undefined;
      const merged: TaskWorker = cur.worker?.runId === worker.runId ? { ...cur.worker, ...worker } : worker;
      const next: Task = { ...cur, worker: merged };
      await this.store.write(id, next);
      this.onChange(next, "state");
      return next;
    });
  }

  /** Replace the most recent log entry (used to coalesce streamed text). No-op when the log is empty. */
  replaceLastLog(id: string, entry: TaskLogEntry): Promise<void> {
    return this.locked(id, async () => {
      const cur = await this.store.read(id);
      if (!cur || cur.log.length === 0) return;
      const next: Task = { ...cur, log: [...cur.log.slice(0, -1), entry] };
      await this.store.write(id, next);
      this.onChange(next, "log");
    });
  }

  /** Called on boot: anything still running or waiting was interrupted by a server restart. */
  async recoverInterrupted(): Promise<Task[]> {
    const out: Task[] = [];
    for (const t of await this.list()) {
      if (t.status === "running" || t.status === "waiting") {
        out.push(await this.transition(t.id, "failed", { error: "interrupted" }));
      }
    }
    return out;
  }

  /** Award XP and bump counters on the assignee for a terminal task. */
  async awardXp(registry: AgentRegistry, task: Task): Promise<void> {
    const agent = await registry.get(task.assigneeId);
    if (!agent) return;
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
