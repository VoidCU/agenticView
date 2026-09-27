import type { Task } from "@agenticview/shared";
import type { TaskService } from "./taskService.js";
/** Why a failed task must not be re-run: its work is already covered. */
export interface RetryCover {
    /** The failed task, now marked solved (its resolution set). */
    task: Task;
    /** The done task that covers it, when there is one. */
    byTaskId?: string;
    /** "already covered by t_x ("title"): marked solved" — the reply every retry path gives. */
    message: string;
}
/**
 * The done task that replaced failed task `f`: same kind, assignee, title and project, created at or after
 * `f` (an earlier auto-retry, or the Manager assigning the same work again), and finished successfully.
 * The newest such task wins.
 */
export declare function findReplacement(f: Task, all: Task[]): Task | undefined;
/**
 * Guard for every retry path (retry_task, the office Retry, the Inbox limit answer): when failed task `taskId`
 * is already covered — it has a resolution, or a done replacement exists — it is not re-run. It is marked
 * solved instead (linking the replacement) and the cover is returned. Returns undefined for a genuine retry.
 */
export declare function coverInsteadOfRetry(tasks: TaskService, taskId: string): Promise<RetryCover | undefined>;
