import { type Task, type TaskKind, type TaskLogEntry, type TaskStatus, type TaskWorker } from "@agenticview/shared";
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
    readOnly?: boolean;
}
export type TaskPatch = Partial<Pick<Task, "result" | "error" | "session">>;
/** `state`: status/result/session changed (worth broadcasting). `log`: only the log grew. */
export type TaskChangeKind = "state" | "log";
/** Persists tasks, enforces the transition table, and serialises writes per task id. */
export declare class TaskService {
    private readonly onChange;
    private readonly store;
    private readonly locks;
    constructor(dir: string, onChange: (t: Task, kind: TaskChangeKind) => void);
    private locked;
    create(input: CreateTaskInput): Promise<Task>;
    get(id: string): Promise<Task | undefined>;
    list(): Promise<Task[]>;
    children(id: string): Promise<Task[]>;
    transition(id: string, to: TaskStatus, patch?: TaskPatch): Promise<Task>;
    log(id: string, type: string, text: string): Promise<void>;
    /** Merge who worked on a task (claude-session attribution) without changing its status. */
    setWorker(id: string, worker: TaskWorker): Promise<Task | undefined>;
    /** Replace the most recent log entry (used to coalesce streamed text). No-op when the log is empty. */
    replaceLastLog(id: string, entry: TaskLogEntry): Promise<void>;
    /** Called on boot: tasks that were running or waiting are failed; tasks that were assigned but
     *  not yet started are re-queued so they get picked up again. */
    recoverInterrupted(): Promise<Task[]>;
    /** Award XP and bump counters on the assignee for a terminal task. */
    awardXp(registry: AgentRegistry, task: Task): Promise<void>;
}
