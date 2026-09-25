import type { Agent, Task } from "@agenticview/shared";
import type { FeedItem } from "../state/store";

/**
 * Returns a short string describing what the agent is currently doing,
 * or undefined when idle.
 * Truncated to ~40 characters as requested.
 */
export function agentActivityText(agent: Agent, tasks: Record<string, Task> | Task[], feed: FeedItem[] = []): string | undefined {
  const taskList = Array.isArray(tasks) ? tasks : Object.values(tasks);
  const mine = taskList.filter((t) => t.assigneeId === agent.id);
  const activeTask = mine.find((t) => t.status === "running" || t.status === "waiting");

  let text: string | undefined;

  if (activeTask) {
    // Look for latest progress in feed for this task
    for (let i = feed.length - 1; i >= 0; i--) {
      const item = feed[i]!;
      if ("event" in item && item.taskId === activeTask.id) {
        const e = item.event;
        if (e.type === "text" || e.type === "status") {
          text = e.text.trim();
        } else if (e.type === "tool_end") {
          text = e.summary.trim();
        } else if (e.type === "tool_start") {
          text = `Using ${e.name}`;
        } else if (e.type === "file_changed") {
          const parts = e.path.split(/[/\\]/);
          text = `Editing ${parts[parts.length - 1] || e.path}`;
        }
        if (text) break;
      }
    }
    // Fall back to active task title
    if (!text) {
      text = activeTask.title.trim();
    }
  } else {
    // Check if recently failed or error
    const terminal = mine
      .filter((t) => t.status === "failed")
      .sort((a, b) => Date.parse(b.finishedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.createdAt))[0];
    if (terminal) {
      const at = Date.parse(terminal.finishedAt ?? terminal.createdAt);
      if (!Number.isNaN(at) && Date.now() - at <= 10000) {
        text = terminal.error?.trim() || `Failed: ${terminal.title.trim()}`;
      }
    }
  }

  if (!text) return undefined;

  // Collapse whitespace/newlines
  text = text.replace(/\s+/g, " ");

  if (text.length > 40) {
    return text.slice(0, 39) + "…";
  }
  return text;
}
