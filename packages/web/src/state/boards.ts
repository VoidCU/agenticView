import { planOffice, type Agent, type Task } from "@agenticview/shared";
import type { FeedItem } from "./store";

export const BOARD_COLUMNS = ["queued", "running", "waiting", "done", "failed"] as const;
export type BoardColumn = typeof BOARD_COLUMNS[number];
export const BOARD_LABELS: Record<BoardColumn, string> = { queued: "Queued", running: "In progress", waiting: "Waiting on you", done: "Done (recent)", failed: "Failed" };
export const BOARD_COLORS: Record<BoardColumn, string> = { queued: "#ffe49a", running: "#a9d6ff", waiting: "#e4c4ff", done: "#b5e5cb", failed: "#ffb9b1" };
export function boardColumn(task: Task): BoardColumn | undefined {
  return task.status === "assigned" ? "queued" : task.status === "cancelled" ? undefined : task.status;
}
export function podBoard(spaceId: string, agents: Agent[], tasks: Task[]) {
  const { placements } = planOffice(agents);
  const workers = agents.filter(a => a.role === "worker" && placements[a.id]?.space === spaceId)
    .sort((a, b) => placements[a.id]!.seat - placements[b.id]!.seat);
  const ids = new Set(workers.map(a => a.id));
  const columns: Record<BoardColumn, Task[]> = { queued: [], running: [], waiting: [], done: [], failed: [] };
  for (const t of [...tasks].sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt) || a.id.localeCompare(b.id))) {
    const col = boardColumn(t);
    if (ids.has(t.assigneeId) && col && (col !== "done" || columns.done.length < 20)) columns[col].push(t);
  }
  return { workers, columns };
}
export function latestProgress(taskId: string, feed: FeedItem[]): string | undefined {
  return feed.map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.ts - a.item.ts || b.index - a.index).flatMap(({ item }) => {
    if (item.taskId !== taskId || !("event" in item)) return [];
    const e = item.event;
    return e.type === "text" || e.type === "status" ? [e.text] : e.type === "tool_end" ? [e.summary] : e.type === "tool_start" ? [`Using ${e.name}`] : [];
  }).find(text => text.trim());
}
export interface TaskBranch { task: Task; children: TaskBranch[] }
export function delegatedTree(parentId: string, tasks: Task[], seen = new Set<string>()): TaskBranch[] {
  if (seen.has(parentId)) return [];
  const path = new Set(seen).add(parentId);
  return tasks.filter(t => t.parentId === parentId && !path.has(t.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(task => ({ task, children: delegatedTree(task.id, tasks, path) }));
}
export function managerBoard(managerId: string | undefined, tasks: Task[], feed: FeedItem[]) {
  return tasks.filter(t => t.kind === "request" && t.assigneeId === managerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map(task => ({ task, children: delegatedTree(task.id, tasks), replies: feed.filter((item): item is FeedItem & { event: { type: "text"; text: string } } => item.taskId === task.id && "event" in item && item.event.type === "text").sort((a, b) => a.ts - b.ts) }));
}
export function relativeTime(date: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(date)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
/** Unique file paths touched by a task, in encounter order, from file_changed feed events. */
export function filesChangedForTask(taskId: string, feed: FeedItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of feed) {
    if (item.taskId !== taskId || !("event" in item) || item.event.type !== "file_changed") continue;
    const path = item.event.path;
    if (!seen.has(path)) { seen.add(path); result.push(path); }
  }
  return result;
}
/** Recursively count total and done tasks in a branch tree. */
export function countBranches(branches: TaskBranch[]): { total: number; done: number } {
  let total = 0; let done = 0;
  for (const { task, children } of branches) {
    total++;
    if (task.status === "done") done++;
    const sub = countBranches(children);
    total += sub.total; done += sub.done;
  }
  return { total, done };
}
