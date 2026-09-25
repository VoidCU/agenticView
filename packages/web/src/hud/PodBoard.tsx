import { useEffect, useState } from "react";
import type { Agent, Space, Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { BOARD_COLUMNS, BOARD_LABELS, boardColumn, latestProgress, managerBoard, podBoard, relativeTime, type TaskBranch } from "../state/boards";
import { Modal } from "./ui";

function Assignee({ agent }: { agent?: Agent }) {
  return <span className="board-assignee"><i style={{ background: agent?.appearance.color ?? "#888" }} aria-hidden="true" />{agent?.name ?? "Unassigned"}</span>;
}
function TaskCard({ task, now }: { task: Task; now: number }) {
  const agent = useStore(s => s.agents[task.assigneeId]);
  const feed = useStore(s => s.feed[task.assigneeId]);
  const progress = latestProgress(task.id, feed ?? []);
  return <details className={`board-card board-${boardColumn(task) ?? "queued"}`}>
    <summary><strong>{task.title}</strong><span className="board-meta"><Assignee agent={agent} /><time dateTime={task.finishedAt ?? task.createdAt}>{relativeTime(task.finishedAt ?? task.createdAt, now)}</time></span>{progress && <span className="board-progress">{progress}</span>}</summary>
    <div className="board-detail"><p>{task.description || "No description."}</p>{task.result && <><b>Result</b><p>{task.result}</p></>}{task.error && <><b>Error</b><p>{task.error}</p></>}</div>
  </details>;
}
function Branches({ branches, now }: { branches: TaskBranch[]; now: number }) {
  return <ul className="board-tree">{branches.map(({ task, children }) => <li key={task.id}><span className="board-status">{task.status}</span><TaskCard task={task} now={now} />{children.length > 0 && <Branches branches={children} now={now} />}</li>)}</ul>;
}
export function PodBoard({ space, onClose }: { space: Space; onClose: () => void }) {
  const agents = useStore(s => s.agents);
  const tasks = useStore(s => s.tasks);
  const feed = useStore(s => s.feed);
  const spaceNames = useStore(s => s.spaceNames);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const pod = space.kind === "pod";
  const board = podBoard(space.id, Object.values(agents), Object.values(tasks));
  const manager = Object.values(agents).find(a => a.role === "manager");
  const requests = managerBoard(manager?.id, Object.values(tasks), feed[manager?.id ?? ""] ?? []);
  const displayName = spaceNames[space.id]?.trim() || space.name;
  return <Modal title={pod ? `Pod board · ${displayName}` : "Manager board"} onClose={onClose} wide>
    <div className="whiteboard-panel">
      {pod ? <><div className="board-roster">{board.workers.map(a => <Assignee key={a.id} agent={a} />)}</div>
        {!board.workers.length ? <p className="board-empty">No workers seated in this pod yet.</p> : <>
          {!BOARD_COLUMNS.some(c => board.columns[c].length) && <p className="board-empty">No tasks for this pod yet.</p>}
          <div className="board-columns">{BOARD_COLUMNS.map(c => <section key={c} aria-label={BOARD_LABELS[c]}><h3>{BOARD_LABELS[c]} <small>{board.columns[c].length}</small></h3>{board.columns[c].map(t => <TaskCard key={t.id} task={t} now={now} />)}{!board.columns[c].length && <p className="board-empty">No tasks</p>}</section>)}</div><p className="board-caption">Showing the 20 most recently completed tasks. Click a note to read more.</p></>}
      </> : <><p className="board-caption">Your conversation with {manager?.name ?? "Atlas"} · newest requests first</p>
        {!requests.length && <p className="board-empty">No requests yet. Tell the manager what you want to build.</p>}
        {requests.map(({ task, children, replies }) => <details className="board-request" key={task.id}><summary><span>You · {relativeTime(task.createdAt, now)}</span><strong>{task.title}</strong><span>{task.status} · {children.length} delegated tasks</span></summary><p>{task.description}</p>
          {(task.result || replies.length > 0) && <div className="board-reply"><b>{manager?.name ?? "Atlas"}</b>{task.result ? <p>{task.result}</p> : replies.map((r, i) => <p key={i}>{r.event.text}</p>)}</div>}{task.error && <p>{task.error}</p>}
          <h3>Delegated tasks</h3>{children.length ? <Branches branches={children} now={now} /> : <p className="board-empty">No delegated tasks yet.</p>}
        </details>)}</>}
    </div>
  </Modal>;
}
