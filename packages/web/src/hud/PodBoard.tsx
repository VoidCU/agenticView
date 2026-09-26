import { useEffect, useRef, useState } from "react";
import type { Agent, Space, Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import {
  BOARD_COLUMNS, BOARD_LABELS, boardColumn, countBranches, filesChangedForTask,
  latestProgress, managerBoard, podBoard, relativeTime, type TaskBranch,
} from "../state/boards";
import { CloseIcon, Modal } from "./ui";
import { RetryButton } from "./LimitChip";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stable empty array used as a fallback in selectors to avoid new-reference churn. */
const NO_FEED: import("../state/store").FeedItem[] = [];

function agentInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function TaskDrawer({
  task,
  agent,
  filesChanged,
  onClose,
  onOpenInbox,
}: {
  task: Task;
  agent: Agent | undefined;
  filesChanged: string[];
  onClose: () => void;
  onOpenInbox?: () => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Focus first interactive element on mount
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    (first ?? el).focus();
  }, [task.id]);

  // Close on Escape (handled by parent Modal's key listener, but also intercept here)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const session = agent ? sessions.find((s) => s.agentIds.includes(agent.id)) : undefined;

  return (
    <div className="kanban-drawer" ref={drawerRef} role="complementary" aria-label="Task detail" data-testid="task-drawer">
      <div className="kanban-drawer-head">
        <h3 id="drawer-title">{task.title}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close drawer">
          <CloseIcon />
        </button>
      </div>
      <div className="kanban-drawer-body">
        {/* Status badge */}
        <span className={`kanban-status-badge board-${boardColumn(task) ?? "queued"}`}>
          {BOARD_LABELS[boardColumn(task) ?? "queued"]}
        </span>

        {/* Agent info */}
        {agent && (
          <div className="kanban-drawer-agent">
            <span className="kanban-avatar" style={{ background: agent.appearance.color }} aria-hidden="true">
              {agentInitial(agent.name)}
            </span>
            <div className="kanban-drawer-agent-info">
              <strong>{agent.name}</strong>
              {(agent.provider ?? session?.model) && (
                <span className="kanban-drawer-meta">
                  {agent.provider ?? "claude"}{session?.model ? ` · ${session.model}` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Description */}
        {task.description && task.description !== task.title && (
          <div className="kanban-drawer-section">
            <h4>Description</h4>
            <p>{task.description}</p>
          </div>
        )}

        {/* Result */}
        {task.result && (
          <div className="kanban-drawer-section">
            <h4>Result</h4>
            <p>{task.result}</p>
          </div>
        )}

        {/* Error */}
        {task.error && (
          <div className="kanban-drawer-section kanban-drawer-error">
            <h4>Error</h4>
            <p>{task.error}</p>
          </div>
        )}

        {/* Files changed */}
        {filesChanged.length > 0 && (
          <div className="kanban-drawer-section">
            <h4>Files changed ({filesChanged.length})</h4>
            <ul className="kanban-drawer-files" aria-label="Files changed">
              {filesChanged.map((f) => (
                <li key={f} title={f}>{basename(f)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="kanban-drawer-actions">
          {task.status === "failed" && <RetryButton taskId={task.id} taskTitle={task.title} />}
          {task.status === "waiting" && onOpenInbox && (
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={() => {
                onOpenInbox();
                window.dispatchEvent(new CustomEvent("agenticview:open-inbox"));
              }}
            >
              Open in Inbox
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Compact kanban card ───────────────────────────────────────────────────────

function KanbanCard({
  task,
  agent,
  now,
  onClick,
  selected,
}: {
  task: Task;
  agent: Agent | undefined;
  now: number;
  onClick: () => void;
  selected: boolean;
}) {
  const feed = useStore((s) => s.feed[task.assigneeId] ?? NO_FEED);
  const progress = latestProgress(task.id, feed);

  return (
    <button
      type="button"
      className={`kanban-card board-${boardColumn(task) ?? "queued"}${selected ? " kanban-card-selected" : ""}`}
      onClick={onClick}
      aria-label={`${task.title}, ${BOARD_LABELS[boardColumn(task) ?? "queued"]}`}
      aria-pressed={selected}
      data-testid="kanban-card"
    >
      <div className="kanban-card-top">
        <span className="kanban-card-title">{task.title}</span>
        {agent && (
          <span className="kanban-avatar kanban-avatar-sm" style={{ background: agent.appearance.color }} aria-hidden="true" title={agent.name}>
            {agentInitial(agent.name)}
          </span>
        )}
      </div>
      <div className="kanban-card-meta">
        <time dateTime={task.finishedAt ?? task.createdAt}>
          {relativeTime(task.finishedAt ?? task.createdAt, now)}
        </time>
      </div>
      {progress && <p className="kanban-card-progress">{progress}</p>}
    </button>
  );
}

// ── Agent filter chips ────────────────────────────────────────────────────────

function AgentFilterChips({
  agents,
  selected,
  onToggle,
  onAll,
}: {
  agents: Agent[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
}) {
  if (agents.length <= 1) return null;
  return (
    <div className="kanban-filter-chips" role="group" aria-label="Filter by agent">
      <button
        type="button"
        className={`kanban-chip${selected.size === 0 ? " kanban-chip-active" : ""}`}
        onClick={onAll}
        aria-pressed={selected.size === 0}
        data-testid="filter-chip-all"
      >
        All
      </button>
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`kanban-chip${selected.has(a.id) ? " kanban-chip-active" : ""}`}
          onClick={() => onToggle(a.id)}
          aria-pressed={selected.has(a.id)}
          data-testid={`filter-chip-${a.id}`}
          style={selected.has(a.id) ? { borderColor: a.appearance.color, background: `${a.appearance.color}33` } : undefined}
        >
          <span className="kanban-avatar kanban-avatar-xs" style={{ background: a.appearance.color }} aria-hidden="true">
            {agentInitial(a.name)}
          </span>
          {a.name}
        </button>
      ))}
    </div>
  );
}

// ── Pod board (kanban) ────────────────────────────────────────────────────────

function PodKanban({
  space,
  onOpenInbox,
}: {
  space: Space;
  onOpenInbox?: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const feed = useStore((s) => s.feed);
  const [now, setNow] = useState(Date.now);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filterAgents, setFilterAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const board = podBoard(space.id, Object.values(agents), Object.values(tasks));

  // Apply agent filter
  const filteredColumns = (() => {
    if (filterAgents.size === 0) return board.columns;
    const result = { ...board.columns } as typeof board.columns;
    for (const col of BOARD_COLUMNS) {
      result[col] = board.columns[col].filter((t) => filterAgents.has(t.assigneeId));
    }
    return result;
  })();

  const selectedTask = selectedTaskId ? (Object.values(tasks).find((t) => t.id === selectedTaskId) ?? null) : null;
  const selectedAgent = selectedTask ? agents[selectedTask.assigneeId] : undefined;
  const selectedFiles = selectedTask
    ? filesChangedForTask(selectedTask.id, feed[selectedTask.assigneeId] ?? [])
    : [];

  const toggleFilter = (id: string) => {
    setFilterAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openCard = (taskId: string) => setSelectedTaskId((prev) => (prev === taskId ? null : taskId));
  const closeDrawer = () => setSelectedTaskId(null);

  return (
    <>
      <div className="board-roster">
        {board.workers.map((a) => (
          <span key={a.id} className="board-assignee">
            <i style={{ background: a.appearance.color }} aria-hidden="true" />
            {a.name}
          </span>
        ))}
      </div>

      {!board.workers.length ? (
        <p className="board-empty">No workers seated in this pod yet.</p>
      ) : (
        <>
          <AgentFilterChips
            agents={board.workers}
            selected={filterAgents}
            onToggle={toggleFilter}
            onAll={() => setFilterAgents(new Set())}
          />
          <div className={`kanban-layout${selectedTask ? " kanban-layout-split" : ""}`}>
            <div className="kanban-columns" data-testid="kanban-columns">
              {BOARD_COLUMNS.map((col) => (
                <section
                  key={col}
                  className="kanban-col"
                  aria-label={BOARD_LABELS[col]}
                  data-testid={`kanban-col-${col}`}
                >
                  <h3 className="kanban-col-head">
                    {BOARD_LABELS[col]}
                    <span className="kanban-col-count">{filteredColumns[col].length}</span>
                  </h3>
                  <div className="kanban-col-body">
                    {filteredColumns[col].length === 0 ? (
                      <p className="board-empty">No tasks</p>
                    ) : (
                      filteredColumns[col].map((t) => (
                        <KanbanCard
                          key={t.id}
                          task={t}
                          agent={agents[t.assigneeId]}
                          now={now}
                          onClick={() => openCard(t.id)}
                          selected={selectedTaskId === t.id}
                        />
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
            {selectedTask && (
              <TaskDrawer
                task={selectedTask}
                agent={selectedAgent}
                filesChanged={selectedFiles}
                onClose={closeDrawer}
                onOpenInbox={onOpenInbox}
              />
            )}
          </div>
          <p className="board-caption">Showing the 20 most recently completed tasks. Click a card to see details.</p>
        </>
      )}
    </>
  );
}

// ── Manager board ─────────────────────────────────────────────────────────────

function ManagerProgressBar({ branches }: { branches: TaskBranch[] }) {
  const { total, done } = countBranches(branches);
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="kanban-progress-bar" aria-label={`${done} of ${total} tasks done`} data-testid="manager-progress-bar">
      <div className="kanban-progress-fill" style={{ width: `${pct}%` }} />
      <span className="kanban-progress-label">{done}/{total}</span>
    </div>
  );
}

function DelegatedMiniCard({ branch, now }: { branch: TaskBranch; now: number }) {
  const col = boardColumn(branch.task) ?? "queued";
  return (
    <span className={`kanban-mini-card board-${col}`} title={branch.task.title}>
      {branch.task.title}
    </span>
  );
}

function ManagerKanban({ manager }: { manager: Agent | undefined }) {
  const tasks = useStore((s) => s.tasks);
  const feed = useStore((s) => s.feed);
  const [now, setNow] = useState(Date.now);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const requests = managerBoard(manager?.id, Object.values(tasks), feed[manager?.id ?? ""] ?? NO_FEED);

  const toggleRow = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!requests.length) {
    return <p className="board-empty">No requests yet. Tell the manager what you want to build.</p>;
  }

  return (
    <div className="kanban-manager-board" data-testid="manager-board">
      {requests.map(({ task, children, replies }) => {
        const isOpen = openIds.has(task.id);
        return (
          <div key={task.id} className="kanban-manager-row" data-testid="manager-row">
            <button
              type="button"
              className="kanban-manager-summary"
              onClick={() => toggleRow(task.id)}
              aria-expanded={isOpen}
              aria-label={task.title}
            >
              <span className="kanban-manager-meta">You · {relativeTime(task.createdAt, now)}</span>
              <strong className="kanban-manager-title">{task.title}</strong>
              <ManagerProgressBar branches={children} />
              <span className="kanban-manager-count">{children.length} delegated</span>
            </button>
            {isOpen && (
              <div className="kanban-manager-detail">
                {(task.result || replies.length > 0) && (
                  <div className="board-reply">
                    <b>{manager?.name ?? "Atlas"}</b>
                    {task.result ? <p>{task.result}</p> : replies.map((r, i) => <p key={i}>{r.event.text}</p>)}
                  </div>
                )}
                {task.error && <p className="kanban-drawer-error">{task.error}</p>}
                {children.length > 0 && (
                  <div className="kanban-mini-cards" aria-label="Delegated tasks" data-testid="delegated-cards">
                    {children.map((b) => <DelegatedMiniCard key={b.task.id} branch={b} now={now} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function PodBoard({
  space,
  onClose,
  onOpenInbox,
}: {
  space: Space;
  onClose: () => void;
  onOpenInbox?: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const spaceNames = useStore((s) => s.spaceNames);
  const pod = space.kind === "pod";
  const manager = Object.values(agents).find((a) => a.role === "manager");
  const displayName = spaceNames[space.id]?.trim() || space.name;

  return (
    <Modal title={pod ? `Pod board · ${displayName}` : "Manager board"} onClose={onClose} wide>
      <div className="whiteboard-panel">
        {pod ? (
          <PodKanban space={space} onOpenInbox={onOpenInbox} />
        ) : (
          <>
            <p className="board-caption">Your conversation with {manager?.name ?? "Atlas"} · newest requests first</p>
            <ManagerKanban manager={manager} />
          </>
        )}
      </div>
    </Modal>
  );
}
