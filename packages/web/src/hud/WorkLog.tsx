import { useMemo } from "react";
import type { Agent, Task, TaskStatus } from "@agenticview/shared";
import { useStore } from "../state/store";
import { timeAgo } from "./ui";

export const WORK_LOG_LIMIT = 10;

const STATUS_WORD: Record<TaskStatus, string> = {
  queued: "queued",
  assigned: "queued",
  running: "running",
  waiting: "waiting",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

/** The agent's tasks, newest first (what the Work log lists). */
export function agentWork(tasks: Record<string, Task>, agentId: string, limit = WORK_LOG_LIMIT): Task[] {
  return Object.values(tasks)
    .filter((t) => t.assigneeId === agentId)
    .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))
    .slice(0, limit);
}

function WorkItem({ task }: { task: Task }) {
  const when = task.finishedAt ?? task.startedAt ?? task.createdAt;
  const outcome = task.status === "done" ? task.result : (task.error ?? task.result);
  const w = task.worker;
  return (
    <li className="worklog-item" data-task={task.id}>
      <details>
        <summary>
          <span className={`worklog-status worklog-${task.status}`}>{STATUS_WORD[task.status]}</span>
          <span className="worklog-title">{task.title}</span>
          <span className="worklog-when">{timeAgo(when)}</span>
        </summary>
        <div className="worklog-body">
          {outcome ? <p className="worklog-result">{outcome}</p> : <p className="worklog-result empty">No result yet.</p>}
          {w && (
            <p className="worklog-by">
              Served by session <strong>{w.sessionName ?? w.sessionId}</strong>
              {w.subagent ? (
                <>
                  {" "}
                  as <code>{w.subagent}</code>
                </>
              ) : null}
              {w.subagentId ? (
                <>
                  {" "}
                  (id <code>{w.subagentId}</code>)
                </>
              ) : null}
            </p>
          )}
          {w?.files?.length ? (
            <p className="worklog-files">
              Files: {w.files.map((f) => <code key={f}>{f}</code>)}
            </p>
          ) : null}
          <p className="worklog-id">Task {task.id}</p>
        </div>
      </details>
    </li>
  );
}

/** Recent tasks of an agent with their results and who served them; click an entry to open it. */
export function WorkLog({ agent }: { agent: Agent }) {
  const tasks = useStore((s) => s.tasks);
  const work = useMemo(() => agentWork(tasks, agent.id), [tasks, agent.id]);
  if (work.length === 0) return null;
  return (
    <details className="worklog" data-testid="work-log">
      <summary>
        Work log <span className="worklog-count">{work.length}</span>
      </summary>
      <ul aria-label={`Work log of ${agent.name}`}>
        {work.map((t) => (
          <WorkItem key={t.id} task={t} />
        ))}
      </ul>
    </details>
  );
}
