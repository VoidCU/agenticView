import { useId, useMemo, useState } from "react";
import type { Task, TaskStatus } from "@agenticview/shared";
import { useStore } from "../state/store";
import { groupTasksByBoard } from "../state/taskGroups";
import { timeAgo } from "./ui";

const STATUS_WORD: Record<TaskStatus, string> = {
  running: "running", queued: "queued", assigned: "assigned", waiting: "waiting on you",
  done: "done", failed: "failed", cancelled: "cancelled",
};

function TaskRow({ task }: { task: Task }) {
  const agent = useStore(s => s.agents[task.assigneeId]);
  const send = useStore(s => s.send);
  const select = useStore(s => s.select);
  const selected = useStore(s => s.selectedAgentId === task.assigneeId);
  const when = task.finishedAt ?? task.startedAt ?? task.createdAt;
  const cancellable = ["queued", "assigned", "running", "waiting"].includes(task.status);
  return (
    <li className={`task task-${task.status} ${selected ? "task-selected" : ""}`} data-kind={task.kind}>
      <div className="task-row">
        <span className="task-dot" aria-hidden="true" style={agent ? { background: agent.appearance.color } : undefined} />
        <div className="task-main">
          <button type="button" className="task-title task-select" disabled={!agent} onClick={() => select(task.assigneeId)} aria-label={`View ${task.title}`}>
            {task.title}
          </button>
          <div className="task-meta"><span className="task-status">{STATUS_WORD[task.status]}</span><time dateTime={when}>{timeAgo(when)}</time></div>
          {task.error && <div className="task-error">{task.error}</div>}
        </div>
        {cancellable && <button type="button" className="btn btn-ghost btn-xs" onClick={() => send({ type: "task.cancel", id: task.id })} aria-label={`Cancel ${task.title}`}>Cancel</button>}
      </div>
    </li>
  );
}

export function TaskBoard() {
  const tasks = useStore(s => s.tasks);
  const agents = useStore(s => s.agents);
  const world = useStore(s => s.world);
  const boards = useMemo(() => groupTasksByBoard(Object.values(tasks), world), [tasks, world]);
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();
  const total = Object.keys(tasks).length;
  return (
    <aside className={`panel panel-tasks${collapsed ? " panel-tasks-collapsed" : ""}`} aria-label="Task board">
      <div className="panel-head">
        <h2>Tasks</h2><span className="panel-count">{total}</span>
        <button type="button" className="btn btn-ghost btn-xs task-panel-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "Expand tasks" : "Collapse tasks"}</button>
      </div>
      <div id={bodyId} className="panel-body" hidden={collapsed}>
        {total === 0 && <p className="empty">No tasks yet. Ask the manager for something in the bar below and the work will show up here.</p>}
        {boards.map(board => (
          <details key={board.id} className="task-board-group" open>
            <summary aria-label={`Board: ${board.name}`}><span className="task-group-label">{board.name}</span><span className="panel-count">{board.tasks.length}</span></summary>
            {board.path && <div className="task-board-path" title={board.path}>{board.path}</div>}
            {!board.tasks.length && <p className="empty">No tasks loaded for this board.</p>}
            {[...board.agents].sort(([a], [b]) => (agents[a]?.name ?? a).localeCompare(agents[b]?.name ?? b)).map(([agentId, assigned]) => (
              <details key={agentId} className="task-agent-group" open>
                <summary aria-label={`Agent: ${agents[agentId]?.name ?? (agentId ? `Unknown agent (${agentId})` : "Unassigned")}`}>
                  <span className="task-dot" aria-hidden="true" style={agents[agentId] ? { background: agents[agentId].appearance.color } : undefined} />
                  <span className="task-group-label">{agents[agentId]?.name ?? (agentId ? `Unknown agent (${agentId})` : "Unassigned")}</span>
                  <span className="panel-count">{assigned.length}</span>
                </summary>
                <ul className="task-list">{assigned.map(task => <TaskRow key={task.id} task={task} />)}</ul>
              </details>
            ))}
          </details>
        ))}
      </div>
    </aside>
  );
}
