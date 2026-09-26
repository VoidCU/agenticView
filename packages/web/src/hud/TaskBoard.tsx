import { useEffect, useId, useMemo, useState } from "react";
import { planOffice, type Task, type TaskStatus } from "@agenticview/shared";
import { useStore, useAgentStatus } from "../state/store";
import { filterTasksByRoom, groupTasksByAgent, isTaskInProject } from "../state/taskGroups";
import { RetryButton } from "./LimitChip";
import { timeAgo } from "./ui";

const STATUS_WORD: Record<TaskStatus, string> = {
  running: "running",
  queued: "queued",
  assigned: "assigned",
  waiting: "waiting on you",
  done: "Done",
  failed: "failed",
  cancelled: "cancelled",
};

function TaskRow({ task, onOpenInbox }: { task: Task; onOpenInbox?: () => void }) {
  const agent = useStore((s) => s.agents[task.assigneeId]);
  const tasks = useStore((s) => s.tasks);
  const questions = useStore((s) => s.questions);
  const send = useStore((s) => s.send);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selectedAgentId === task.assigneeId);
  const when = task.finishedAt ?? task.startedAt ?? task.createdAt;
  const cancellable = ["queued", "assigned", "running", "waiting"].includes(task.status);
  const isSolved = task.status === "failed" && !!task.resolution;
  const retryable = task.status === "failed" && !isSolved;
  const isWaiting = task.status === "waiting";
  const question = isWaiting ? questions.find((q) => q.taskId === task.id) : undefined;
  const questionText = question?.question || (task.description && task.description !== task.title ? task.description : undefined);

  const resolutionTask = isSolved && task.resolution?.byTaskId
    ? (tasks[task.resolution.byTaskId] ?? null)
    : null;

  const handleOpenInbox = () => {
    onOpenInbox?.();
    window.dispatchEvent(new CustomEvent("agenticview:open-inbox"));
  };

  return (
    <li className={`task task-${task.status}${isSolved ? " task-solved" : ""} ${selected ? "task-selected" : ""}`} data-kind={task.kind}>
      <div className="task-row">
        <span className="task-dot" aria-hidden="true" style={agent ? { background: agent.appearance.color } : undefined} />
        <div className="task-main">
          <button
            type="button"
            className="task-title task-select"
            disabled={!agent}
            onClick={() => select(task.assigneeId)}
            aria-label={`View ${task.title}`}
          >
            {task.title}
          </button>
          <div className="task-meta">
            <span className="task-status">
              {isSolved ? "Solved" : STATUS_WORD[task.status]}
            </span>
            <time dateTime={when}>{timeAgo(when)}</time>
          </div>
          {isSolved && (
            <div
              className="task-resolution"
              title={task.resolution!.note}
            >
              {resolutionTask ? (
                <button
                  type="button"
                  className="task-resolution-link"
                  onClick={() => select(resolutionTask.assigneeId)}
                  aria-label={`Solved by task: ${resolutionTask.title}`}
                >
                  Solved by {resolutionTask.title}
                </button>
              ) : (
                <span className="task-resolution-note">Solved</span>
              )}
            </div>
          )}
          {task.error && !isSolved && <div className="task-error">{task.error}</div>}
          {isWaiting && (
            <div className="task-waiting-box">
              {questionText && <p className="task-waiting-question">{questionText}</p>}
              <button
                type="button"
                className="btn btn-primary btn-xs task-inbox-btn"
                onClick={handleOpenInbox}
                aria-label={`Open question in Inbox for ${task.title}`}
              >
                Open in Inbox
              </button>
            </div>
          )}
        </div>
        {cancellable && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => send({ type: "task.cancel", id: task.id })}
            aria-label={`Cancel ${task.title}`}
          >
            Cancel
          </button>
        )}
        {retryable && <RetryButton taskId={task.id} taskTitle={task.title} />}
      </div>
    </li>
  );
}

// ── Agent group status helpers ────────────────────────────────────────────────

type GroupStatus = "working" | "waiting" | "break" | "limited" | "error" | "idle";

const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  working: "Working",
  waiting: "Waiting on you",
  break: "On a break",
  limited: "Limited",
  error: "Error",
  idle: "Idle",
};

const GROUP_STATUS_COLOR: Record<GroupStatus, string> = {
  working: "var(--thinking)",
  waiting: "var(--waiting)",
  break: "#ff8a65",
  limited: "var(--error)",
  error: "var(--error)",
  idle: "var(--idle)",
};

function AgentGroupHeader({
  agentId,
  count,
  collapsed,
  onToggle,
}: {
  agentId: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const agent = useStore((s) => s.agents[agentId]);
  const sessions = useStore((s) => s.sessions);
  const spaceNames = useStore((s) => s.spaceNames);
  const limits = useStore((s) => s.limits);
  const agentStatusVal = useAgentStatus(agentId);

  const session = agent ? sessions.find((s) => s.agentIds.includes(agentId)) : undefined;
  const model = session?.model ?? null;
  const spaceId = agent?.placement?.space;
  const room = spaceId ? (spaceNames[spaceId]?.trim() || spaceId) : undefined;

  const isLimited = limits.some((l) => l.agentId === agentId);
  const isLounge = !!agent?.lounging;

  let groupStatus: GroupStatus;
  if (isLimited) groupStatus = "limited";
  else if (agentStatusVal === "waiting") groupStatus = "waiting";
  else if (agentStatusVal === "thinking" || agentStatusVal === "editing") groupStatus = "working";
  else if (isLounge) groupStatus = "break";
  else if (agentStatusVal === "error") groupStatus = "error";
  else groupStatus = "idle";

  const label = agent?.name ?? (agentId ? `Unknown agent (${agentId})` : "Unassigned");
  const statusColor = GROUP_STATUS_COLOR[groupStatus];
  const statusLabel = GROUP_STATUS_LABEL[groupStatus];

  return (
    <button
      type="button"
      className="task-agent-group-btn"
      aria-expanded={!collapsed}
      onClick={onToggle}
      aria-label={`${label} — ${statusLabel}`}
    >
      <span
        className="task-dot"
        aria-hidden="true"
        style={agent ? { background: agent.appearance.color } : undefined}
      />
      <span className="task-group-label">{label}</span>
      <span className="panel-count">{count}</span>
      <span className="task-group-status-dot" aria-hidden="true" style={{ background: statusColor }} />
      <span className="task-group-status-word" style={{ color: statusColor }}>{statusLabel}</span>
      {model && <span className="task-group-model" title={model}>{model.split("/").pop() ?? model}</span>}
      {room && <span className="task-group-room">{room}</span>}
      <span className="task-group-chevron" aria-hidden="true">{collapsed ? "▶" : "▼"}</span>
    </button>
  );
}

// ── TaskBoard export ──────────────────────────────────────────────────────────

export function TaskBoard({
  onOpenInbox,
  externalCollapsed,
  onCollapseChange,
}: {
  onOpenInbox?: () => void;
  externalCollapsed?: boolean;
  onCollapseChange?: (v: boolean) => void;
} = {}) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const world = useStore((s) => s.world);
  const spaceNames = useStore((s) => s.spaceNames);

  const [selectedRoom, setSelectedRoom] = useState("");
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;
  const setCollapsed = (v: boolean) => {
    setInternalCollapsed(v);
    onCollapseChange?.(v);
  };
  const bodyId = useId();
  const roomSelectId = useId();

  // Per-group collapse state — persisted in localStorage
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const v = localStorage.getItem("av:task-groups-collapsed");
      return v ? new Set<string>(JSON.parse(v) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("av:task-groups-collapsed", JSON.stringify([...collapsedGroups]));
    } catch { /* ignore */ }
  }, [collapsedGroups]);

  const toggleGroup = (agentId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  };

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const plan = useMemo(() => planOffice(agentList), [agentList]);

  const rooms = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const s of plan.spaces) {
      seen.add(s.id);
      list.push({ id: s.id, name: spaceNames[s.id]?.trim() || s.name });
    }
    for (const [id, custom] of Object.entries(spaceNames ?? {})) {
      if (!seen.has(id) && custom?.trim()) {
        seen.add(id);
        list.push({ id, name: custom.trim() });
      }
    }
    for (const a of agentList) {
      const sp = a.placement?.space;
      if (sp && !seen.has(sp)) {
        seen.add(sp);
        list.push({ id: sp, name: spaceNames[sp]?.trim() || sp });
      }
    }
    return list;
  }, [plan.spaces, spaceNames, agentList]);

  const projectTasks = useMemo(() => {
    const byId = new Map(Object.values(tasks).map((t) => [t.id, t]));
    return Object.values(tasks).filter((t) => isTaskInProject(t, byId, world));
  }, [tasks, world]);

  const filteredTasks = useMemo(() => {
    return filterTasksByRoom(projectTasks, selectedRoom, agents, plan.placements);
  }, [projectTasks, selectedRoom, agents, plan.placements]);

  const agentGroups = useMemo(() => {
    return groupTasksByAgent(filteredTasks, agents);
  }, [filteredTasks, agents]);

  const total = filteredTasks.length;

  const collapseAll = () => setCollapsedGroups(new Set(agentGroups.map(([id]) => id)));
  const expandAll = () => setCollapsedGroups(new Set());

  return (
    <aside className={`panel panel-tasks${collapsed ? " panel-tasks-collapsed" : ""}`} aria-label="Task board">
      <div className="panel-head">
        <h2>Tasks</h2>
        <span className="panel-count">{total}</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs task-panel-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Expand tasks" : "Collapse tasks"}
        </button>
      </div>
      <div id={bodyId} className="panel-body" hidden={collapsed}>
        <div className="task-filter-bar">
          <label htmlFor={roomSelectId} className="sr-only">
            Filter by room
          </label>
          <select
            id={roomSelectId}
            className="task-room-select"
            value={selectedRoom}
            onChange={(e) => setSelectedRoom(e.target.value)}
            aria-label="Room"
          >
            <option value="">All rooms</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {projectTasks.length === 0 ? (
          <p className="empty">No tasks yet. Ask the manager for something in the bar below and the work will show up here.</p>
        ) : filteredTasks.length === 0 ? (
          <p className="empty">No tasks in this room.</p>
        ) : (
          <>
            {agentGroups.length > 1 && (
              <div className="task-groups-toolbar" role="toolbar" aria-label="Group controls">
                <button type="button" className="btn btn-ghost btn-xs" onClick={collapseAll}>
                  Collapse all
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={expandAll}>
                  Expand all
                </button>
              </div>
            )}
            {agentGroups.map(([agentId, assigned]) => {
              const isGroupCollapsed = collapsedGroups.has(agentId);
              return (
                <div key={agentId} className="task-agent-group">
                  <AgentGroupHeader
                    agentId={agentId}
                    count={assigned.length}
                    collapsed={isGroupCollapsed}
                    onToggle={() => toggleGroup(agentId)}
                  />
                  {/* Always render for DOM consistency; hide via CSS when collapsed */}
                  <ul
                    className={`task-list${isGroupCollapsed ? " task-list--collapsed" : ""}`}
                    aria-hidden={isGroupCollapsed || undefined}
                  >
                    {assigned.map((task) => (
                      <TaskRow key={task.id} task={task} onOpenInbox={onOpenInbox} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
