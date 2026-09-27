/**
 * Workflow board: one user request as a visual flow, in a large overlay (the board-sized Modal).
 * Numbered steps top to bottom joined by arrows; each step shows who acted (robot avatars, two with an
 * arrow when agents hand work to each other), what happened, when and how long it took. Replies expand
 * to full markdown; a step's title opens that task's drawer. Presentation only: the steps come from
 * buildWorkflow (state/workflow.ts).
 */
import { useMemo, useState } from "react";
import type { Agent, Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import { filesChangedForTask } from "../state/boards";
import { buildWorkflow, formatDuration, involvedAgents, type WorkflowStep } from "../state/workflow";
import { SimpleMarkdown, inlineMarkdown } from "./markdown";
import { TaskDrawer } from "./PodBoard";
import { Modal, providerLabel, timeAgo } from "./ui";

export const STATUS_LABEL: Record<Task["status"], string> = {
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

/** The coloured robot face used across the HUD; "user" is you. */
function Avatar({ id, agents }: { id: string | undefined; agents: Record<string, Agent> }) {
  if (id === "user") {
    return (
      <span className="wfb-avatar wfb-avatar-you" title="You">
        You
      </span>
    );
  }
  const a = id ? agents[id] : undefined;
  return (
    <span className="avatar wfb-avatar" style={{ background: a?.appearance.color ?? "#8a90a2" }} title={a?.name ?? "Unknown agent"}>
      <span className={`avatar-eyes eyes-${a?.appearance.eyes ?? "dots"}`} />
    </span>
  );
}

function nameOf(id: string | undefined, agents: Record<string, Agent>): string {
  if (id === "user") return "You";
  return (id && agents[id]?.name) || "Someone";
}

/** "Atlas → Nova (Codex / luna)", "Nova replied · 4m 12s", "Nova asked you", ... */
function actionLine(step: WorkflowStep, agents: Record<string, Agent>): string {
  switch (step.kind) {
    case "delegate": {
      // Title is "From → To (provider / model): task title"; the board shows the task title separately.
      const i = step.title.indexOf("): ");
      return i >= 0 ? step.title.slice(0, i + 1) : step.title;
    }
    case "reply": {
      const who = nameOf(step.fromId ?? step.agentId, agents);
      const failed = step.ok === false;
      return `${who} ${failed ? "stopped" : "replied"}${step.durationMs !== undefined ? ` · ${formatDuration(step.durationMs)}` : ""}`;
    }
    default:
      return step.title;
  }
}

/** Task title of a delegation (after "): "), if any. */
function delegatedTitle(step: WorkflowStep): string | undefined {
  if (step.kind !== "delegate") return undefined;
  const i = step.title.indexOf("): ");
  return i >= 0 ? step.title.slice(i + 3) : undefined;
}

function FlowStep({ step, n, agents, onOpen }: { step: WorkflowStep; n: number; agents: Record<string, Agent>; onOpen: (taskId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const bad = step.ok === false || step.kind === "failover";
  const pair = step.fromId !== undefined && step.toId !== undefined && step.fromId !== step.toId;
  const sub = delegatedTitle(step);
  return (
    <li className={`wfb-step wf-${step.kind}${bad ? " wf-bad" : ""}`} data-testid="wf-step" data-kind={step.kind}>
      <span className="wfb-num" aria-label={`Step ${n}`}>{n}</span>
      <div className="wfb-card">
        <div className="wfb-actors" aria-hidden="true">
          {pair ? (
            <>
              <Avatar id={step.fromId} agents={agents} />
              <span className="wfb-arrow">→</span>
              <Avatar id={step.toId} agents={agents} />
            </>
          ) : (
            <Avatar id={step.agentId ?? step.fromId} agents={agents} />
          )}
        </div>
        <div className="wfb-main">
          <button type="button" className="wfb-head" onClick={() => onOpen(step.taskId)} title="Open task details">
            <span className="wfb-action">{actionLine(step, agents)}</span>
            {step.retry && <span className="wf-tag">retry</span>}
          </button>
          {sub && <p className="wfb-task">{sub}</p>}
          <div className="wf-meta">
            <time dateTime={Number.isNaN(step.ts) ? undefined : new Date(step.ts).toISOString()}>{clock(step.ts)}</time>
            {step.durationMs !== undefined && step.kind !== "reply" && <span className="wf-dur">took {formatDuration(step.durationMs)}</span>}
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
      </div>
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

export function WorkflowBoard({ root, onClose }: { root: Task; onClose: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const [drawerId, setDrawerId] = useState<string>();
  // Derived only while open; recomputed when the task or agent maps change.
  const steps = useMemo(() => buildWorkflow(root, tasks, agents, (p) => providerLabel(p, "Automatic")), [root, tasks, agents]);
  const involved = useMemo(() => involvedAgents(root, tasks), [root, tasks]);
  const end = root.finishedAt ? Date.parse(root.finishedAt) : NaN;
  const took = Number.isNaN(end) ? undefined : formatDuration(Math.max(0, end - Date.parse(root.createdAt)));
  return (
    <Modal title={`Workflow · ${root.title}`} onClose={onClose} wide>
      <div className="workflow-board" data-testid="workflow-board">
        <div className="wfb-summary">
          <span className={`tl-status tl-status-${root.status}`}>{STATUS_LABEL[root.status]}</span>
          <time dateTime={root.createdAt}>{timeAgo(root.createdAt)}</time>
          <span>{steps.length} steps</span>
          <span className="wfb-involved">
            {involved.map((id) => <Avatar key={id} id={id} agents={agents} />)}
            {involved.length} agent{involved.length === 1 ? "" : "s"}
          </span>
          {took && <span>took {took}</span>}
        </div>
        <div className="wfb-scroll">
        <ol className="wfb-list" aria-label={`Workflow: ${root.title}`}>
          {steps.map((s, i) => (
            <FlowStep key={s.id} step={s} n={i + 1} agents={agents} onOpen={setDrawerId} />
          ))}
        </ol>
        </div>
        {drawerId && <Drawer taskId={drawerId} onClose={() => setDrawerId(undefined)} />}
      </div>
    </Modal>
  );
}
