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
export function findReplacement(f: Task, all: Task[]): Task | undefined {
  return all
    .filter((t) => t.id !== f.id && t.status === "done" && t.kind === f.kind && t.assigneeId === f.assigneeId && t.title === f.title && t.projectPath === f.projectPath && t.createdAt >= f.createdAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
}

/**
 * Guard for every retry path (retry_task, the office Retry, the Inbox limit answer): when failed task `taskId`
 * is already covered — it has a resolution, or a done replacement exists — it is not re-run. It is marked
 * solved instead (linking the replacement) and the cover is returned. Returns undefined for a genuine retry.
 */
export async function coverInsteadOfRetry(tasks: TaskService, taskId: string): Promise<RetryCover | undefined> {
  const f = await tasks.get(taskId);
  if (!f || f.status !== "failed") return undefined;
  if (f.resolution) {
    const by = f.resolution.byTaskId ? await tasks.get(f.resolution.byTaskId) : undefined;
    const what = by ? `${by.id} ("${by.title}")` : f.resolution.byTaskId ?? `its resolution${f.resolution.note ? ` (${f.resolution.note})` : ""}`;
    return { task: f, ...(f.resolution.byTaskId ? { byTaskId: f.resolution.byTaskId } : {}), message: `Task ${f.id} is already covered by ${what}: marked solved, not re-run.` };
  }
  const rep = findReplacement(f, await tasks.list());
  if (!rep) return undefined;
  const task = await tasks.setResolution(f.id, { byTaskId: rep.id, note: `Already covered by ${rep.id}; the retry was skipped`, at: new Date().toISOString() });
  return { task, byTaskId: rep.id, message: `Task ${f.id} is already covered by ${rep.id} ("${rep.title}"): marked solved, not re-run.` };
}
