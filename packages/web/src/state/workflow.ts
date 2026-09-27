/**
 * Timeline workflows: the story of one user request, derived on demand from what the office already
 * stores (task tree via parentId, task logs, assignees / tiers). No new storage.
 */
import type { Agent, Task } from "@agenticview/shared";

export type WorkflowStepKind = "asked" | "received" | "delegate" | "question" | "failover" | "reply" | "final";

export interface WorkflowStep {
  id: string;
  kind: WorkflowStepKind;
  /** ms since epoch. */
  ts: number;
  /** One-line headline, e.g. "Atlas → Pixel (Claude / Sonnet): Build the form". */
  title: string;
  /** Short body (first line of a result, a question...). */
  summary?: string;
  /** Full text when the summary was shortened (expandable). */
  full?: string;
  /** Task the step belongs to (clicking opens its drawer). */
  taskId: string;
  /** Agent the step is about (colour dot). */
  agentId?: string;
  /** For delegations / replies: how long that piece took (ms). */
  durationMs?: number;
  ok?: boolean;
  /** Tool calls worth mentioning (manager receiving a request). */
  tools?: string[];
  /** Two-party steps: who acted and toward whom ("user" = you). Delegation: delegator -> assignee; reply: assignee -> delegator. */
  fromId?: string;
  toId?: string;
  /** A delegation that re-assigns work that failed before (retry / failover). */
  retry?: boolean;
}

/** Main tasks: one per user request (to the Manager, or a direct chat with a worker), newest first. */
export function mainTasks(tasks: Record<string, Task>): Task[] {
  const out: Task[] = [];
  for (const id in tasks) {
    const t = tasks[id]!;
    if ((t.kind === "request" || t.kind === "chat") && (!t.parentId || !tasks[t.parentId])) out.push(t);
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Every task below `root` in the parentId tree, in creation order. */
export function descendants(root: Task, tasks: Record<string, Task>): Task[] {
  const byParent = new Map<string, Task[]>();
  for (const id in tasks) {
    const t = tasks[id]!;
    if (!t.parentId) continue;
    let list = byParent.get(t.parentId);
    if (!list) byParent.set(t.parentId, (list = []));
    list.push(t);
  }
  const out: Task[] = [];
  const seen = new Set<string>([root.id]);
  const walk = (id: string) => {
    for (const c of (byParent.get(id) ?? []).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    }
  };
  walk(root.id);
  return out;
}

/** Agents that worked on a request (assignees of the root and every descendant). */
export function involvedAgents(root: Task, tasks: Record<string, Task>): string[] {
  const ids = new Set<string>([root.assigneeId]);
  for (const t of descendants(root, tasks)) ids.add(t.assigneeId);
  return [...ids].filter(Boolean);
}

const NOISE_TOOLS = new Set(["assign_task", "await_tasks", "list_agents", "list_tasks", "get_task", "ask_user"]);
const LIMIT_RE = /\b(limit|quota|rate[- ]?limit|429|overloaded|failover|fail(ed)? over|revived?|switched to|moved to)\b/i;

export function shorten(text: string, max = 140): { summary: string; full?: string } {
  const clean = text.trim();
  const firstLine = clean.split("\n").find((l) => l.trim()) ?? "";
  let summary = firstLine.trim();
  if (summary.length > max) summary = summary.slice(0, max - 1).trimEnd() + "…";
  return summary === clean ? { summary } : { summary, full: clean };
}

function toolName(logText: string): string {
  return logText.split(/\s/, 1)[0] ?? "";
}

/** The question text of an ask_user tool log line (`ask_user {"question":"..."}`; may be truncated). */
export function askedQuestion(logText: string): string {
  const m = /"question"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(logText);
  if (!m) return logText.slice(toolName(logText).length).trim();
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function providerModel(task: Task, agent: Agent | undefined, label: (provider: string | null | undefined) => string): string {
  const provider = task.tier?.provider ?? agent?.provider ?? null;
  const model = task.tier?.model ?? (agent?.provider === "claude-session" ? agent?.sessionModel ?? agent?.model : agent?.model) ?? null;
  const p = label(provider);
  return model ? `${p} / ${model}` : p;
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/**
 * The ordered story of one request:
 * You asked → Manager received it (+ key tools) → each delegation → questions → failovers →
 * each reply → the final report.
 */
export function buildWorkflow(
  root: Task,
  tasks: Record<string, Task>,
  agents: Record<string, Agent>,
  label: (provider: string | null | undefined) => string = (p) => p ?? "Automatic",
): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const name = (id: string) => agents[id]?.name ?? id;
  const owner = name(root.assigneeId);

  const userLine = root.log.find((l) => l.type === "user")?.text ?? root.description ?? root.title;
  const asked = shorten(userLine, 200);
  steps.push({ id: `${root.id}:asked`, kind: "asked", ts: ms(root.createdAt), title: "You asked", summary: asked.summary, full: asked.full, taskId: root.id, fromId: "user", toId: root.assigneeId });

  const pushTaskSignals = (t: Task) => {
    for (let i = 0; i < t.log.length; i++) {
      const l = t.log[i]!;
      if (l.type === "tool_start" && toolName(l.text) === "ask_user") {
        const q = shorten(askedQuestion(l.text), 160);
        steps.push({ id: `${t.id}:q${i}`, kind: "question", ts: ms(l.ts), title: `${name(t.assigneeId)} asked you`, summary: q.summary, full: q.full, taskId: t.id, agentId: t.assigneeId });
      } else if (l.type === "status" && LIMIT_RE.test(l.text)) {
        const s = shorten(l.text, 160);
        steps.push({ id: `${t.id}:s${i}`, kind: "failover", ts: ms(l.ts), title: `${name(t.assigneeId)}: ${s.summary}`, full: s.full, taskId: t.id, agentId: t.assigneeId });
      }
    }
  };

  const tools: string[] = [];
  for (const l of root.log) {
    if (l.type !== "tool_start") continue;
    const n = toolName(l.text);
    if (n && !NOISE_TOOLS.has(n) && !tools.includes(n)) tools.push(n);
  }
  steps.push({
    id: `${root.id}:received`,
    kind: "received",
    ts: ms(root.startedAt ?? root.createdAt),
    title: `${owner} received it`,
    taskId: root.id,
    agentId: root.assigneeId,
    tools: tools.length ? tools : undefined,
  });
  pushTaskSignals(root);

  const children = descendants(root, tasks);
  const seenTitles = new Map<string, Task>();
  for (const t of children) {
    const fromId = t.createdBy === "user" ? root.assigneeId : t.createdBy;
    const from = name(fromId);
    const to = name(t.assigneeId);
    const earlier = seenTitles.get(t.title.trim().toLowerCase());
    const retry = !!earlier && (earlier.status === "failed" || earlier.status === "cancelled");
    seenTitles.set(t.title.trim().toLowerCase(), t);
    steps.push({
      id: `${t.id}:delegate`,
      kind: "delegate",
      ts: ms(t.createdAt),
      title: `${from} → ${to} (${providerModel(t, agents[t.assigneeId], label)}): ${t.title}`,
      taskId: t.id,
      agentId: t.assigneeId,
      retry: retry || undefined,
      fromId,
      toId: t.assigneeId,
    });
    pushTaskSignals(t);
    const end = ms(t.finishedAt);
    if (!Number.isNaN(end)) {
      const start = ms(t.startedAt ?? t.createdAt);
      const failed = t.status !== "done";
      const body = failed ? t.error ?? t.status : t.result ?? "done";
      const s = shorten(body);
      const hitLimit = failed && LIMIT_RE.test(body);
      steps.push({
        id: `${t.id}:reply`,
        kind: hitLimit ? "failover" : "reply",
        ts: end,
        title: hitLimit ? `${to} hit a limit` : `${to} → ${from}${failed ? ` (${t.status})` : ""}`,
        summary: s.summary,
        full: s.full,
        taskId: t.id,
        agentId: t.assigneeId,
        durationMs: Number.isNaN(start) ? undefined : Math.max(0, end - start),
        ok: !failed,
        fromId: t.assigneeId,
        toId: fromId,
      });
    }
  }

  const done = ms(root.finishedAt);
  if (!Number.isNaN(done)) {
    const body = root.status === "done" ? root.result ?? "Done." : root.error ?? root.status;
    const s = shorten(body, 200);
    steps.push({
      id: `${root.id}:final`,
      kind: "final",
      ts: done,
      title: root.status === "done" ? `${owner}'s final report` : `${owner} stopped (${root.status})`,
      summary: s.summary,
      full: s.full,
      taskId: root.id,
      agentId: root.assigneeId,
      durationMs: Math.max(0, done - ms(root.createdAt)),
      ok: root.status === "done",
    });
  }
  // A step without a readable time sits right after the step before it in the narrative.
  let lastTs = ms(root.createdAt);
  for (const s of steps) {
    if (Number.isNaN(s.ts)) s.ts = lastTs;
    else lastTs = s.ts;
  }
  // Stable order by time; ties keep the narrative order above.
  return steps.map((s, i) => ({ s, i })).sort((a, b) => (a.s.ts - b.s.ts) || a.i - b.i).map(({ s }) => s);
}

/** "42s", "3m 05s", "1h 12m". */
export function formatDuration(msDur: number): string {
  const s = Math.round(msDur / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
