import React, { useEffect, useRef, useState } from "react";
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

// ── Changes view ──────────────────────────────────────────────────────────────

interface ChangesData {
  files: { path: string; kind: string }[];
  diff: string;
  truncated: boolean;
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return <span className="diff-file-header">{line}</span>;
  }
  if (line.startsWith("@@")) {
    return <span className="diff-hunk">{line}</span>;
  }
  if (line.startsWith("+")) {
    return <span className="diff-add">{line}</span>;
  }
  if (line.startsWith("-")) {
    return <span className="diff-del">{line}</span>;
  }
  return <span className="diff-ctx">{line}</span>;
}

function ChangesView({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [data, setData] = useState<ChangesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/changes`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ChangesData>;
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [taskId]);

  const toggleFile = (key: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Split diff into per-file sections
  const fileSections = (() => {
    if (!data?.diff) return [];
    const sections: { header: string; lines: string[] }[] = [];
    let current: { header: string; lines: string[] } | null = null;
    for (const line of data.diff.split("\n")) {
      if (line.startsWith("diff --git")) {
        if (current) sections.push(current);
        current = { header: line, lines: [line] };
      } else if (current) {
        current.lines.push(line);
      } else {
        current = { header: line, lines: [line] };
      }
    }
    if (current) sections.push(current);
    return sections;
  })();

  return (
    <div className="changes-view" data-testid="changes-view">
      <div className="changes-view-head">
        <h4>Changes</h4>
        <button type="button" className="icon-btn icon-btn-xs" onClick={onClose} aria-label="Close changes">
          <CloseIcon />
        </button>
      </div>
      {loading && <p className="changes-loading">Loading changes…</p>}
      {error && <p className="changes-error">Could not load changes: {error}</p>}
      {data && !loading && (
        <>
          {data.truncated && (
            <p className="changes-truncated">Diff is large and has been truncated. Only the first portion is shown.</p>
          )}
          {data.files.length > 0 && (
            <ul className="changes-file-list" aria-label="Changed files">
              {data.files.map((f) => (
                <li key={f.path} className={`changes-file-item changes-file-${f.kind}`} title={f.path}>
                  <span className="changes-file-kind">{f.kind[0]?.toUpperCase()}</span>
                  <span className="changes-file-path">{f.path.split(/[\\/]/).pop() ?? f.path}</span>
                </li>
              ))}
            </ul>
          )}
          {fileSections.length > 0 ? (
            <div className="changes-diff">
              {fileSections.map((sec, i) => {
                const key = `${i}-${sec.header}`;
                const collapsed = collapsedFiles.has(key);
                const title = sec.lines.find((l) => l.startsWith("+++ ") || l.startsWith("--- ")) ?? sec.header;
                return (
                  <details key={key} className="diff-file-section" open={!collapsed}>
                    <summary className="diff-file-summary" onClick={() => toggleFile(key)}>
                      {title.replace(/^[+-]{3} [ab]\//, "")}
                    </summary>
                    <pre className="diff-body">
                      {sec.lines.map((line, j) => (
                        <DiffLine key={j} line={line} />
                      ))}
                    </pre>
                  </details>
                );
              })}
            </div>
          ) : data.diff ? (
            <pre className="diff-body diff-plain">
              {data.diff.split("\n").map((line, i) => <DiffLine key={i} line={line} />)}
            </pre>
          ) : (
            <p className="changes-empty">No diff available.</p>
          )}
        </>
      )}
    </div>
  );
}

function agentInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function MarkSolvedForm({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const doneTasks = Object.values(tasks).filter((t) => t.id !== taskId && t.status === "done");
  const [byTaskId, setByTaskId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ byTaskId: byTaskId || undefined, note: note.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDone();
    } catch (err: unknown) {
      setError(String(err));
      setSaving(false);
    }
  };

  return (
    <form className="kanban-mark-solved-form" onSubmit={handleSubmit} data-testid="mark-solved-form">
      <h4>Mark as solved</h4>
      {doneTasks.length > 0 && (
        <label className="kanban-form-label">
          Fixed by task (optional)
          <select
            value={byTaskId}
            onChange={(e) => setByTaskId(e.target.value)}
            className="kanban-form-select"
            aria-label="Fixed by task"
          >
            <option value="">None</option>
            {doneTasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </label>
      )}
      <label className="kanban-form-label">
        Note
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="kanban-form-textarea"
          placeholder="Why is this failure resolved?"
          rows={3}
          required
          aria-label="Resolution note"
        />
      </label>
      {error && <p className="kanban-form-error">{error}</p>}
      <div className="kanban-form-actions">
        <button type="submit" className="btn btn-primary btn-xs" disabled={saving || !note.trim()}>
          {saving ? "Saving…" : "Mark solved"}
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

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
  const tasks = useStore((s) => s.tasks);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [showMarkSolved, setShowMarkSolved] = useState(false);

  const isSolved = task.status === "failed" && !!task.resolution;
  const resolutionTask = isSolved && task.resolution?.byTaskId
    ? (tasks[task.resolution.byTaskId] ?? null)
    : null;

  // Focus first interactive element on mount
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    (first ?? el).focus();
  }, [task.id]);

  // Close on Escape (handled by parent Modal's key listener, but also intercept here)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (showChanges) setShowChanges(false);
        else if (showMarkSolved) setShowMarkSolved(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, showChanges, showMarkSolved]);

  const session = agent ? sessions.find((s) => s.agentIds.includes(agent.id)) : undefined;

  const handleUndoSolved = async () => {
    try {
      await fetch(`/api/tasks/${encodeURIComponent(task.id)}/resolve`, { method: "DELETE" });
    } catch { /* WS update will arrive */ }
  };

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
        <span className={`kanban-status-badge board-${boardColumn(task) ?? "queued"}${isSolved ? " kanban-status-solved" : ""}`}>
          {isSolved ? "Solved" : BOARD_LABELS[boardColumn(task) ?? "queued"]}
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

        {/* Resolution */}
        {isSolved && task.resolution && (
          <div className="kanban-drawer-section kanban-drawer-resolution" data-testid="resolution-section">
            <h4>Resolution</h4>
            {resolutionTask && (
              <p className="kanban-resolution-bytask">
                Fixed by: <strong>{resolutionTask.title}</strong>
              </p>
            )}
            <p className="kanban-resolution-note">{task.resolution.note}</p>
          </div>
        )}

        {/* Files changed */}
        {filesChanged.length > 0 && (
          <div className="kanban-drawer-section">
            <div className="kanban-drawer-files-head">
              <h4>Files changed ({filesChanged.length})</h4>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setShowChanges(true)}
                aria-label="View diff"
                data-testid="changes-button"
              >
                Changes
              </button>
            </div>
            <ul className="kanban-drawer-files" aria-label="Files changed">
              {filesChanged.map((f) => (
                <li key={f} title={f}>{basename(f)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="kanban-drawer-actions">
          {filesChanged.length === 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setShowChanges(true)}
              aria-label="View changes"
              data-testid="changes-button"
            >
              Changes
            </button>
          )}
          {task.status === "failed" && !isSolved && (
            <RetryButton taskId={task.id} taskTitle={task.title} />
          )}
          {task.status === "failed" && !isSolved && !showMarkSolved && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setShowMarkSolved(true)}
              data-testid="mark-solved-btn"
            >
              Mark solved…
            </button>
          )}
          {isSolved && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={handleUndoSolved}
              data-testid="undo-solved-btn"
            >
              Undo solved
            </button>
          )}
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

        {/* Mark solved form */}
        {showMarkSolved && (
          <MarkSolvedForm taskId={task.id} onDone={() => setShowMarkSolved(false)} />
        )}

        {/* Changes panel */}
        {showChanges && (
          <ChangesView taskId={task.id} onClose={() => setShowChanges(false)} />
        )}
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
  const isSolved = task.status === "failed" && !!task.resolution;
  const col = boardColumn(task) ?? "queued";
  const label = isSolved ? "Solved" : BOARD_LABELS[col];

  return (
    <button
      type="button"
      className={`kanban-card board-${col}${selected ? " kanban-card-selected" : ""}${isSolved ? " kanban-card-solved" : ""}`}
      onClick={onClick}
      aria-label={`${task.title}, ${label}`}
      aria-pressed={selected}
      data-testid="kanban-card"
    >
      <div className="kanban-card-top">
        <span className="kanban-card-title">{task.title}</span>
        {isSolved && <span className="kanban-solved-badge" aria-label="Solved">solved</span>}
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
