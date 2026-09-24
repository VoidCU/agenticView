import { useMemo } from "react";
import type { Task, TaskStatus } from "@agenticview/shared";
import { useStore } from "../state/store";
import { timeAgo } from "./ui";

type Group = "Running" | "Queued" | "Waiting" | "Done" | "Failed";
const GROUPS: Group[] = ["Running", "Queued", "Waiting", "Done", "Failed"];
const GROUP_OF: Record<TaskStatus, Group> = {
  running: "Running",
  queued: "Queued",
  assigned: "Queued",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  cancelled: "Failed",
};
const STATUS_WORD: Record<TaskStatus, string> = {
  running: "running",
  queued: "queued",
  assigned: "assigned",
  waiting: "waiting on you",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};
const DONE_LIMIT = 25;

interface Node {
  task: Task;
  children: Node[];
}

/** Build a per-group forest: a task nests under its parent only when both sit in the same group. */
export function groupTasks(tasks: Task[]): Record<Group, Node[]> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Record<Group, Node[]> = { Running: [], Queued: [], Waiting: [], Done: [], Failed: [] };
  const nodes = new Map<string, Node>();
  const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const t of sorted) nodes.set(t.id, { task: t, children: [] });
  for (const t of sorted) {
    const node = nodes.get(t.id)!;
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    if (parent && GROUP_OF[parent.status] === GROUP_OF[t.status]) nodes.get(parent.id)!.children.push(node);
    else out[GROUP_OF[t.status]].push(node);
  }
  for (const n of nodes.values()) n.children.sort((a, b) => a.task.createdAt.localeCompare(b.task.createdAt));
  return out;
}

function isCancellable(status: TaskStatus): boolean {
  return status === "queued" || status === "assigned" || status === "running" || status === "waiting";
}

function TaskRow({ node, depth }: { node: Node; depth: number }) {
  const { task } = node;
  const agent = useStore((s) => s.agents[task.assigneeId]);
  const send = useStore((s) => s.send);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selectedAgentId === task.assigneeId);
  const when = task.finishedAt ?? task.startedAt ?? task.createdAt;
  return (
    <li className={`task task-${task.status} ${selected ? "task-selected" : ""}`} data-depth={depth} data-kind={task.kind}>
      <div className="task-row" onClick={() => select(task.assigneeId)} role="presentation">
        <span className="task-dot" aria-hidden="true" style={agent ? { background: agent.appearance.color } : undefined} />
        <div className="task-main">
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            {agent ? <span className="task-agent">{agent.name}</span> : <span className="task-agent">unassigned</span>}
            <span className="task-when">{STATUS_WORD[task.status]} {timeAgo(when)}</span>
          </div>
          {task.error && <div className="task-error">{task.error}</div>}
        </div>
        {isCancellable(task.status) && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "task.cancel", id: task.id });
            }}
            aria-label={`Cancel ${task.title}`}
          >
            Cancel
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="task-children">
          {node.children.map((c) => (
            <TaskRow key={c.task.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function countNodes(nodes: Node[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

export function TaskBoard() {
  const tasks = useStore((s) => s.tasks);
  const groups = useMemo(() => groupTasks(Object.values(tasks)), [tasks]);
  const total = Object.keys(tasks).length;

  return (
    <aside className="panel panel-tasks" aria-label="Task board">
      <div className="panel-head">
        <h2>Tasks</h2>
        <span className="panel-count">{total}</span>
      </div>
      <div className="panel-body">
        {total === 0 && (
          <p className="empty">
            No tasks yet. Ask the manager for something in the bar below and the work will show up here.
          </p>
        )}
        {GROUPS.map((g) => {
          const nodes = g === "Done" ? groups[g].slice(0, DONE_LIMIT) : groups[g];
          if (nodes.length === 0) return null;
          return (
            <section key={g} className={`task-group task-group-${g.toLowerCase()}`} aria-label={g}>
              <h3>
                {g} <span className="panel-count">{countNodes(groups[g])}</span>
              </h3>
              <ul className="task-list">
                {nodes.map((n) => (
                  <TaskRow key={n.task.id} node={n} depth={0} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
