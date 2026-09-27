import { useMemo, useState } from "react";
import type { Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { formatDuration, involvedAgents, mainTasks } from "../state/workflow";
import { STATUS_LABEL, WorkflowBoard } from "./WorkflowBoard";
import { timeAgo } from "./ui";

/**
 * Timeline: one row per user request (main task). Opening a row shows its workflow as a board (a large
 * overlay with the story as a numbered visual flow), derived on open from the task tree and logs.
 */

function RequestRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const involved = useMemo(() => involvedAgents(task, tasks).length, [task, tasks]);
  const end = task.finishedAt ? Date.parse(task.finishedAt) : NaN;
  const took = Number.isNaN(end) ? undefined : formatDuration(Math.max(0, end - Date.parse(task.createdAt)));
  return (
    <li className="tl-request" data-testid="tl-entry">
      <button type="button" className="tl-request-btn" aria-haspopup="dialog" onClick={onOpen}>
        <span className={`tl-status tl-status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
        <span className="tl-request-title">{task.title}</span>
        <span className="tl-request-meta">
          <time dateTime={task.createdAt}>{timeAgo(task.createdAt)}</time>
          <span>
            {involved} agent{involved === 1 ? "" : "s"}
          </span>
          {took && <span>took {took}</span>}
        </span>
      </button>
    </li>
  );
}

export function Timeline({ onClose }: { onClose: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [openId, setOpenId] = useState<string>();

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const requests = useMemo(() => {
    const all = mainTasks(tasks);
    if (!selectedAgent) return all;
    return all.filter((t) => involvedAgents(t, tasks).includes(selectedAgent));
  }, [tasks, selectedAgent]);
  const open = openId ? tasks[openId] : undefined;

  return (
    <div className="panel panel-timeline" aria-label="Activity timeline" data-testid="timeline-panel">
      <div className="panel-head">
        <h2>Timeline</h2>
        <span className="panel-count">{requests.length}</span>
        <div className="tl-filters">
          <select className="task-room-select" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} aria-label="Filter by agent">
            <option value="">All agents</option>
            {agentList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-ghost btn-xs tl-close" onClick={onClose} aria-label="Close timeline">
          Close
        </button>
      </div>
      <div className="panel-body tl-body">
        {requests.length === 0 ? (
          <p className="empty">No activity yet. Requests you give the office show up here as workflows.</p>
        ) : (
          <ol className="tl-list" aria-label="Requests">
            {requests.map((t) => (
              <RequestRow key={t.id} task={t} onOpen={() => setOpenId(t.id)} />
            ))}
          </ol>
        )}
      </div>
      {open && <WorkflowBoard root={open} onClose={() => setOpenId(undefined)} />}
    </div>
  );
}
