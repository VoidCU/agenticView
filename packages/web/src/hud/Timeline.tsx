import { useMemo, useState } from "react";
import { planOffice, type Task } from "@agenticview/shared";
import { useStore, type FeedItem } from "../state/store";
import { filterTasksByRoom, getAgentRoomId } from "../state/taskGroups";
import { timeAgo } from "./ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  ts: number;
  agentId: string;
  agentName: string;
  agentColor: string;
  kind: "task.created" | "task.started" | "task.done" | "task.failed" | "task.waiting" | "file.changed" | "question";
  label: string;
  detail?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function entryKindIcon(kind: TimelineEntry["kind"]): string {
  switch (kind) {
    case "task.created": return "·";
    case "task.started": return "▶";
    case "task.done": return "✓";
    case "task.failed": return "✗";
    case "task.waiting": return "?";
    case "file.changed": return "✎";
    case "question": return "❓";
  }
}

function entryKindClass(kind: TimelineEntry["kind"]): string {
  switch (kind) {
    case "task.created": return "tl-created";
    case "task.started": return "tl-started";
    case "task.done": return "tl-done";
    case "task.failed": return "tl-failed";
    case "task.waiting": return "tl-waiting";
    case "file.changed": return "tl-file";
    case "question": return "tl-question";
  }
}

// ── Build entries from store ──────────────────────────────────────────────────

/** Build timeline entries from tasks and the live feed. Newest first. */
export function buildTimeline(
  tasks: Record<string, Task>,
  feed: Record<string, FeedItem[]>,
  agents: Record<string, import("@agenticview/shared").Agent>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let seq = 0;

  for (const task of Object.values(tasks)) {
    const agent = agents[task.assigneeId];
    const name = agent?.name ?? task.assigneeId ?? "Unknown";
    const color = agent?.appearance.color ?? "#6b7280";
    const base = { agentId: task.assigneeId, agentName: name, agentColor: color };

    entries.push({
      ...base,
      id: `tc-${task.id}`,
      ts: Date.parse(task.createdAt),
      kind: "task.created",
      label: `Task created: ${task.title}`,
    });

    if (task.startedAt) {
      entries.push({
        ...base,
        id: `ts-${task.id}`,
        ts: Date.parse(task.startedAt),
        kind: "task.started",
        label: `Started: ${task.title}`,
      });
    }

    if (task.finishedAt) {
      if (task.status === "done") {
        entries.push({
          ...base,
          id: `td-${task.id}`,
          ts: Date.parse(task.finishedAt),
          kind: "task.done",
          label: `Done: ${task.title}`,
          detail: task.result ?? undefined,
        });
      } else if (task.status === "failed") {
        entries.push({
          ...base,
          id: `tf-${task.id}`,
          ts: Date.parse(task.finishedAt),
          kind: "task.failed",
          label: `Failed: ${task.title}`,
          detail: task.error ?? undefined,
        });
      }
    }

    if (task.status === "waiting") {
      entries.push({
        ...base,
        id: `tw-${task.id}`,
        ts: Date.parse(task.startedAt ?? task.createdAt),
        kind: "task.waiting",
        label: `Waiting on you: ${task.title}`,
      });
    }
  }

  // Add file changes and questions from feed
  for (const [agentId, items] of Object.entries(feed)) {
    const agent = agents[agentId];
    const name = agent?.name ?? agentId;
    const color = agent?.appearance.color ?? "#6b7280";

    for (const item of items) {
      if (!("event" in item)) continue;
      if (item.event.type === "file_changed") {
        entries.push({
          id: `fc-${agentId}-${item.ts}-${++seq}`,
          ts: item.ts,
          agentId,
          agentName: name,
          agentColor: color,
          kind: "file.changed",
          label: `File ${item.event.kind}: ${item.event.path.split(/[\\/]/).pop() ?? item.event.path}`,
          detail: item.event.path,
        });
      }
    }
  }

  // Sort newest first
  return entries.sort((a, b) => b.ts - a.ts).slice(0, 300);
}

// ── Timeline panel ────────────────────────────────────────────────────────────

export function Timeline({ onClose }: { onClose: () => void }) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const feed = useStore((s) => s.feed);
  const spaceNames = useStore((s) => s.spaceNames);
  const world = useStore((s) => s.world);

  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const plan = useMemo(() => planOffice(agentList), [agentList]);

  const rooms = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const s of plan.spaces) {
      seen.add(s.id);
      list.push({ id: s.id, name: spaceNames[s.id]?.trim() || s.name });
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

  const allEntries = useMemo(() => buildTimeline(tasks, feed, agents), [tasks, feed, agents]);

  // Filter by agent
  const agentFiltered = useMemo(() => {
    if (!selectedAgent) return allEntries;
    return allEntries.filter((e) => e.agentId === selectedAgent);
  }, [allEntries, selectedAgent]);

  // Filter by room — find agents in that room and filter by them
  const entries = useMemo(() => {
    if (!selectedRoom) return agentFiltered;
    const agentsInRoom = new Set(
      agentList
        .filter((a) => getAgentRoomId(a, plan.placements) === selectedRoom)
        .map((a) => a.id)
    );
    return agentFiltered.filter((e) => agentsInRoom.has(e.agentId));
  }, [agentFiltered, selectedRoom, agentList, plan.placements]);

  return (
    <div className="panel panel-timeline" aria-label="Activity timeline" data-testid="timeline-panel">
      <div className="panel-head">
        <h2>Timeline</h2>
        <span className="panel-count">{entries.length}</span>
        <div className="tl-filters">
          <select
            className="task-room-select"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            aria-label="Filter by agent"
          >
            <option value="">All agents</option>
            {agentList.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {rooms.length > 0 && (
            <select
              className="task-room-select"
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              aria-label="Filter by room"
            >
              <option value="">All rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-xs tl-close" onClick={onClose} aria-label="Close timeline">
          Close
        </button>
      </div>
      <div className="panel-body tl-body">
        {entries.length === 0 ? (
          <p className="empty">No activity yet.</p>
        ) : (
          <ol className="tl-list" aria-label="Activity log">
            {entries.map((e) => (
              <li key={e.id} className={`tl-entry ${entryKindClass(e.kind)}`} data-testid="tl-entry">
                <span
                  className="tl-avatar"
                  style={{ background: e.agentColor }}
                  aria-hidden="true"
                  title={e.agentName}
                >
                  {e.agentName.charAt(0).toUpperCase()}
                </span>
                <div className="tl-entry-body">
                  <span className="tl-icon" aria-hidden="true">{entryKindIcon(e.kind)}</span>
                  <span className="tl-label">{e.label}</span>
                  {e.detail && <span className="tl-detail" title={e.detail}>{e.detail}</span>}
                </div>
                <time className="tl-time" dateTime={new Date(e.ts).toISOString()}>
                  {timeAgo(new Date(e.ts).toISOString())}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
