import { useMemo, useState } from "react";
import type { Agent, Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { filesChangedForTask } from "../state/boards";
import { buildWorkflow, formatDuration, involvedAgents, mainTasks, type WorkflowStep } from "../state/workflow";
import { SimpleMarkdown, inlineMarkdown } from "./markdown";
import { TaskDrawer } from "./PodBoard";
import { providerLabel, timeAgo } from "./ui";

/**
 * Timeline: one row per user request (main task). Opening a row shows its workflow, the story in
 * order, derived on open from the task tree and logs (buildWorkflow, memoised on the store maps).
 */

const STEP_ICON: Record<WorkflowStep["kind"], string> = {
  asked: "›",
  received: "◆",
  delegate: "→",
  question: "?",
  failover: "⚡",
  reply: "←",
  final: "✓",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  queued: "Queued",
  assigned: "Assigned",
  running: "Running",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function clock(ts: number): string {
  if (Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Step({ step, agents, onOpen }: { step: WorkflowStep; agents: Record<string, Agent>; onOpen: (taskId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = step.agentId ? agents[step.agentId]?.appearance.color : undefined;
  const bad = step.ok === false || step.kind === "failover";
  return (
    <li className={`wf-step wf-${step.kind}${bad ? " wf-bad" : ""}`} data-testid="wf-step" data-kind={step.kind}>
      <span className="wf-rail" aria-hidden="true">
        <span className="wf-node" style={color ? { borderColor: color } : undefined}>
          {STEP_ICON[step.kind]}
        </span>
      </span>
      <div className="wf-card">
        <button type="button" className="wf-head" onClick={() => onOpen(step.taskId)} title="Open task details">
          <span className="wf-title">{step.title}</span>
          {step.retry && <span className="wf-tag">retry</span>}
        </button>
        <div className="wf-meta">
          <time dateTime={new Date(step.ts).toISOString()}>{clock(step.ts)}</time>
          {step.durationMs !== undefined && <span className="wf-dur">took {formatDuration(step.durationMs)}</span>}
          {step.tools && <span className="wf-tools">used {step.tools.join(", ")}</span>}
        </div>
        {step.summary && !expanded && <p className="wf-summary">{inlineMarkdown(step.summary)}</p>}
        {step.full && (
          <>
            {expanded && <SimpleMarkdown text={step.full} className="wf-full" />}
            <button type="button" className="link wf-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show all"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Workflow({ root, onOpen }: { root: Task; onOpen: (taskId: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  // Derived only while open; recomputed when the task or agent maps change.
  const steps = useMemo(() => buildWorkflow(root, tasks, agents, (p) => providerLabel(p, "Automatic")), [root, tasks, agents]);
  return (
    <ol className="wf-list" aria-label={`Workflow: ${root.title}`}>
      {steps.map((s) => (
        <Step key={s.id} step={s} agents={agents} onOpen={onOpen} />
      ))}
    </ol>
  );
}

function RequestRow({ task, open, onToggle, onOpenTask }: { task: Task; open: boolean; onToggle: () => void; onOpenTask: (taskId: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  const involved = useMemo(() => involvedAgents(task, tasks).length, [task, tasks]);
  const end = task.finishedAt ? Date.parse(task.finishedAt) : NaN;
  const took = Number.isNaN(end) ? undefined : formatDuration(Math.max(0, end - Date.parse(task.createdAt)));
  return (
    <li className={`tl-request${open ? " tl-open" : ""}`} data-testid="tl-entry">
      <button type="button" className="tl-request-btn" aria-expanded={open} onClick={onToggle}>
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
      {open && <Workflow root={task} onOpen={onOpenTask} />}
    </li>
  );
}

function Drawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useStore((s) => s.tasks[taskId]);
  const agent = useStore((s) => (task ? s.agents[task.assigneeId] : undefined));
  const feed = useStore((s) => (task ? s.feed[task.assigneeId] : undefined));
  const files = useMemo(() => (task ? filesChangedForTask(task.id, feed ?? []) : []), [task, feed]);
  if (!task) return null;
  return (
    <>
      <div className="task-sheet-dim" onClick={onClose} aria-hidden="true" />
      <TaskDrawer task={task} agent={agent} filesChanged={files} onClose={onClose} />
    </>
  );
}

export function Timeline({ onClose }: { onClose: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [openId, setOpenId] = useState<string>();
  const [drawerId, setDrawerId] = useState<string>();

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const requests = useMemo(() => {
    const all = mainTasks(tasks);
    if (!selectedAgent) return all;
    return all.filter((t) => involvedAgents(t, tasks).includes(selectedAgent));
  }, [tasks, selectedAgent]);

  return (
    <div className={`panel panel-timeline${openId ? " tl-has-open" : ""}`} aria-label="Activity timeline" data-testid="timeline-panel">
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
              <RequestRow key={t.id} task={t} open={openId === t.id} onToggle={() => setOpenId((id) => (id === t.id ? undefined : t.id))} onOpenTask={setDrawerId} />
            ))}
          </ol>
        )}
      </div>
      {drawerId && <Drawer taskId={drawerId} onClose={() => setDrawerId(undefined)} />}
    </div>
  );
}
