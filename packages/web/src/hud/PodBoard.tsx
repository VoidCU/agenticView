import React, { useEffect, useRef, useState } from "react";
import type { Agent, Space, Task } from "@agenticview/shared";
import { useStore } from "../state/store";
import {
  BOARD_COLUMNS, BOARD_LABELS, boardColumn, countBranches, filesChangedForTask,
  latestProgress, managerBoard, podBoard, relativeTime, type TaskBranch,
} from "../state/boards";
import { CloseIcon, Modal } from "./ui";
import { RetryButton } from "./LimitChip";
import { SimpleMarkdown } from "./markdown";
import { WorkflowBoardBody, workflowTitle } from "./WorkflowBoard";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stable empty array used as a fallback in selectors to avoid new-reference churn. */
const NO_FEED: import("../state/store").FeedItem[] = [];

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return iso;
  }
}

function taskDuration(startedAt: string, finishedAt: string): string {
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (isNaN(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

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

// ── Mark solved form ───────────────────────────────────────────────────────────

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

// ── Task detail sheet (slides over board from right, board stays full width) ──

export function TaskDrawer({
  task,
  agent,
  filesChanged,
  onClose,
  onCloseBoard,
  onOpenInbox,
}: {
  task: Task;
  agent: Agent | undefined;
  filesChanged: string[];
  onClose: () => void;
  onCloseBoard?: () => void;
  onOpenInbox?: () => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const select = useStore((s) => s.select);
  // Only offer the Inbox when a real question or permission for this task is pending there.
  const hasPending = useStore((s) => s.questions.some((q) => q.taskId === task.id) || s.permissions.some((p) => p.taskId === task.id));
  const sheetRef = useRef<HTMLDivElement>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [showMarkSolved, setShowMarkSolved] = useState(false);

  const isSolved = task.status === "failed" && !!task.resolution;
  const resolutionTask = isSolved && task.resolution?.byTaskId
    ? (tasks[task.resolution.byTaskId] ?? null)
    : null;

  const session = agent ? sessions.find((s) => s.agentIds.includes(agent.id)) : undefined;
  // The run within the session that serves this agent (shows subagent identity)
  const servingRun = session?.runs.find((r) => r.agentId === task.assigneeId) ?? null;

  // Focus first interactive element on mount
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    (first ?? el).focus();
  }, [task.id]);

  // Esc key: close sub-panels first, then close sheet
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

  const handleUndoSolved = async () => {
    try {
      await fetch(`/api/tasks/${encodeURIComponent(task.id)}/resolve`, { method: "DELETE" });
    } catch { /* WS update will arrive */ }
  };

  const col = boardColumn(task) ?? "queued";
  const statusLabel = isSolved ? "Solved" : BOARD_LABELS[col];

  return (
    <div
      className="task-sheet"
      ref={sheetRef}
      role="complementary"
      aria-label="Task detail"
      data-testid="task-drawer"
      tabIndex={-1}
    >
      {/* Header */}
      <div className="task-sheet-head">
        <h3 className="task-sheet-title">{task.title}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close drawer">
          <CloseIcon />
        </button>
      </div>

      {/* Body */}
      <div className="task-sheet-body">
        {/* Status badge */}
        <span className={`kanban-status-badge board-${col}${isSolved ? " kanban-status-solved" : ""}`}>
          {statusLabel}
        </span>

        {/* Agent + model */}
        {agent && (
          <div className="task-sheet-section" style={{ marginTop: 10 }}>
            <h4>Agent</h4>
            <div className="task-sheet-agent">
              <span className="kanban-avatar" style={{ background: agent.appearance.color }} aria-hidden="true">
                {agentInitial(agent.name)}
              </span>
              <div className="task-sheet-agent-info">
                <strong>{agent.name}</strong>
                {(agent.provider ?? session?.model) && (
                  <span className="task-sheet-agent-meta">
                    {agent.provider ?? "claude"}{session?.model ? ` · ${session.model}` : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Timing */}
        <div className="task-sheet-section">
          <h4>Timing</h4>
          <dl className="task-sheet-timing">
            <dt>Created</dt>
            <dd>{formatDateTime(task.createdAt)}</dd>
            {task.startedAt && (
              <>
                <dt>Started</dt>
                <dd>{formatDateTime(task.startedAt)}</dd>
              </>
            )}
            {task.finishedAt && (
              <>
                <dt>Finished</dt>
                <dd>{formatDateTime(task.finishedAt)}</dd>
              </>
            )}
            {task.startedAt && task.finishedAt && (
              <>
                <dt>Duration</dt>
                <dd>{taskDuration(task.startedAt, task.finishedAt)}</dd>
              </>
            )}
          </dl>
        </div>

        {/* Served by */}
        {(session || servingRun) && (
          <div className="task-sheet-section">
            <h4>Served by</h4>
            <p className="task-sheet-served-by">
              {session ? (session.name || session.id) : null}
              {servingRun?.subagent && (
                <span className="task-sheet-subagent" title={servingRun.subagentId ?? undefined}>
                  {" "}· {servingRun.subagent}
                </span>
              )}
            </p>
          </div>
        )}

        {/* Description */}
        {task.description && task.description !== task.title && (
          <div className="task-sheet-section">
            <h4>Description</h4>
            <SimpleMarkdown text={task.description} />
          </div>
        )}

        {/* Result */}
        {task.result && (
          <div className="task-sheet-section">
            <h4>Result</h4>
            <SimpleMarkdown text={task.result} />
          </div>
        )}

        {/* Error */}
        {task.error && (
          <div className="task-sheet-section">
            <h4>Error</h4>
            <p className="task-sheet-error">{task.error}</p>
          </div>
        )}

        {/* Resolution */}
        {isSolved && task.resolution && (
          <div className="task-sheet-section kanban-drawer-resolution" data-testid="resolution-section">
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
          <div className="task-sheet-section">
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
            <ul className="task-sheet-files" aria-label="Files changed">
              {filesChanged.map((f) => (
                <li key={f} title={f}>{basename(f)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="task-sheet-actions">
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
          {agent && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                select(agent.id);
                onCloseBoard?.();
                onClose();
              }}
              aria-label={`Open chat with ${agent.name}`}
              data-testid="open-chat-btn"
            >
              Open agent chat
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
          {hasPending && onOpenInbox && (
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
  onCloseBoard,
}: {
  space: Space;
  onOpenInbox?: () => void;
  onCloseBoard?: () => void;
}) {
  const roomTaskLabel = space.kind === "production" ? "production" : space.kind === "research" ? "research" : null;
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const feed = useStore((s) => s.feed);
  const layout = useStore((s) => s.layout);
  const [now, setNow] = useState(Date.now);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filterAgents, setFilterAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const board = podBoard(space.id, Object.values(agents), Object.values(tasks), layout);

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
        <p className="board-empty">{roomTaskLabel ? `No ${roomTaskLabel} tasks yet` : "No workers seated in this pod yet."}</p>
      ) : (
        <>
          <AgentFilterChips
            agents={board.workers}
            selected={filterAgents}
            onToggle={toggleFilter}
            onAll={() => setFilterAgents(new Set())}
          />
          {/* kanban-layout fills remaining whiteboard height; sheet overlays it */}
          <div className="kanban-layout">
            {roomTaskLabel && BOARD_COLUMNS.every((col) => filteredColumns[col].length === 0) && (
              <p className="board-empty">No {roomTaskLabel} tasks yet</p>
            )}
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
            {/* Dim backdrop + sheet overlay — board stays full width */}
            {selectedTask && (
              <>
                <div
                  className="task-sheet-dim"
                  onClick={closeDrawer}
                  aria-hidden="true"
                />
                <TaskDrawer
                  task={selectedTask}
                  agent={selectedAgent}
                  filesChanged={selectedFiles}
                  onClose={closeDrawer}
                  onCloseBoard={onCloseBoard}
                  onOpenInbox={onOpenInbox}
                />
              </>
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

/** A small flow glyph (three steps joined by a line) for "View timeline". */
function TimelineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 3.5v9" />
      <circle cx="4" cy="3" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="4" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="4" cy="13" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8 3h5M8 8h5M8 13h3" />
    </svg>
  );
}

function ManagerKanban({
  manager,
  openIds,
  onToggle,
  onOpenWorkflow,
}: {
  manager: Agent | undefined;
  openIds: ReadonlySet<string>;
  onToggle: (taskId: string) => void;
  /** Show this request's workflow (the Timeline's WorkflowBoard) in the board's dialog. */
  onOpenWorkflow: (taskId: string) => void;
}) {
  const tasks = useStore((s) => s.tasks);
  const feed = useStore((s) => s.feed);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const requests = managerBoard(manager?.id, Object.values(tasks), feed[manager?.id ?? ""] ?? NO_FEED);

  if (!requests.length) {
    return <p className="board-empty">No requests yet. Tell the manager what you want to build.</p>;
  }

  return (
    <div className="kanban-manager-board" data-testid="manager-board">
      {requests.map(({ task, children, replies }) => {
        const isOpen = openIds.has(task.id);
        return (
          <div key={task.id} className="kanban-manager-row" data-testid="manager-row" data-request-id={task.id}>
            <div className="kanban-manager-head">
              {/* The title area opens the request's timeline (its workflow flow). */}
              <button
                type="button"
                className="kanban-manager-summary"
                onClick={() => onOpenWorkflow(task.id)}
                aria-label={task.title}
                aria-haspopup="dialog"
                title="View timeline"
              >
                <span className="kanban-manager-meta">You · {relativeTime(task.createdAt, now)}</span>
                <strong className="kanban-manager-title">{task.title}</strong>
                <ManagerProgressBar branches={children} />
                <span className="kanban-manager-count">{children.length} delegated</span>
              </button>
              <div className="kanban-manager-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs kanban-manager-timeline"
                  onClick={() => onOpenWorkflow(task.id)}
                  aria-haspopup="dialog"
                  aria-label={`View timeline: ${task.title}`}
                  data-testid="manager-view-timeline"
                >
                  <TimelineIcon />
                  View timeline
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs kanban-manager-toggle"
                  onClick={() => onToggle(task.id)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} details: ${task.title}`}
                >
                  {isOpen ? "Hide details" : "Details"}
                  <span aria-hidden="true" className="kanban-manager-chevron">{isOpen ? "▴" : "▾"}</span>
                </button>
              </div>
            </div>
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
  const pod = space.kind === "pod" || space.kind === "production" || space.kind === "research";
  const roomBoard = space.kind === "production" || space.kind === "research";
  const manager = Object.values(agents).find((a) => a.role === "manager");
  const displayName = spaceNames[space.id]?.trim() || space.name;
  // Manager board: which request rows are expanded, and which request's workflow is shown (if any).
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [workflowId, setWorkflowId] = useState<string>();
  const workflowRoot = useStore((s) => (workflowId ? s.tasks[workflowId] : undefined));
  const backRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<string | undefined>(undefined);

  // Swapping in the workflow moves focus to its Back button; coming back refocuses the request's row.
  useEffect(() => {
    if (workflowId) {
      returnTo.current = workflowId;
      backRef.current?.focus();
      return;
    }
    const id = returnTo.current;
    returnTo.current = undefined;
    if (!id) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-request-id]")).find((el) => el.dataset.requestId === id);
    row?.querySelector<HTMLElement>(".kanban-manager-summary")?.focus();
  }, [workflowId]);

  // My Office and lounges have no whiteboard; meeting rooms (like the manager's office) open the Manager board.
  if (space.kind === "myoffice" || space.kind === "lounge") return null;

  // A request's timeline replaces the board inside the SAME dialog (not a second dialog stacked on
  // top): one focus trap, one Escape handler and one walk-mode pointer release, so Esc, the close
  // button or the Back button step back to the Manager board, and closing the board then hands the
  // mouse back to walk mode as usual.
  if (!pod && workflowRoot) {
    const back = () => setWorkflowId(undefined);
    return (
      <Modal title={workflowTitle(workflowRoot)} onClose={back} wide>
        <WorkflowBoardBody
          root={workflowRoot}
          toolbar={
            <div className="wfb-toolbar">
              <button type="button" ref={backRef} className="btn btn-ghost btn-xs wfb-back" onClick={back} data-testid="workflow-back">
                <span aria-hidden="true">←</span> Back to Manager board
              </button>
            </div>
          }
        />
      </Modal>
    );
  }

  const toggleRow = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Modal title={roomBoard ? `${displayName} board` : pod ? `Pod board · ${displayName}` : "Manager board"} onClose={onClose} wide>
      <div className="whiteboard-panel">
        {pod ? (
          <PodKanban space={space} onOpenInbox={onOpenInbox} onCloseBoard={onClose} />
        ) : (
          <>
            <p className="board-caption">Your conversation with {manager?.name ?? "Atlas"} · newest requests first · open a request to see its timeline</p>
            <ManagerKanban manager={manager} openIds={openIds} onToggle={toggleRow} onOpenWorkflow={setWorkflowId} />
          </>
        )}
      </div>
    </Modal>
  );
}
