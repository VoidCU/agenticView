import { type Task, type TaskKind, type TaskLogEntry, type TaskStatus } from "@agenticview/shared";
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
/** Persists tasks, enforces the transition table, and serialises writes per task id. */
export declare class TaskService {
    private readonly onChange;
    private readonly store;
    private readonly locks;
    constructor(dir: string, onChange: (t: Task) => void);
    private locked;
    create(input: CreateTaskInput): Promise<Task>;
    get(id: string): Promise<Task | undefined>;
    list(): Promise<Task[]>;
    children(id: string): Promise<Task[]>;
    transition(id: string, to: TaskStatus, patch?: TaskPatch): Promise<Task>;
    log(id: string, type: string, text: string): Promise<void>;
    /** Replace the most recent log entry (used to coalesce streamed text). No-op when the log is empty. */
    replaceLastLog(id: string, entry: TaskLogEntry): Promise<void>;
    /** Called on boot: anything still running or waiting was interrupted by a server restart. */
    recoverInterrupted(): Promise<Task[]>;
    /** Award XP and bump counters on the assignee for a terminal task. */
    awardXp(registry: AgentRegistry, task: Task): Promise<void>;
}
