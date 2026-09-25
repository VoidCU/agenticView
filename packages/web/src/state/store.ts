import { create } from "zustand";
import type { Agent, ClientMessage, ProjectSettings, Provider, ProviderStatus, RunEvent, ServerMessage, Task, WorldInfo } from "@agenticview/shared";

export type FeedItem = { ts: number; taskId: string; event: RunEvent } | { ts: number; taskId: string; user: string };
export type Bubble = { text: string; until: number };
export type Beam = { id: string; from: string; to: string; until: number };
export type PendingPermission = { id: string; agentId: string; taskId: string; tool: string; input: unknown };
export type PendingQuestion = { id: string; agentId: string; taskId: string; question: string };
export type MirrorItem = { kind: string; text: string; ts: string };
export type Celebration = { agentId: string; until: number };
export type UiError = { id: number; message: string; ref?: string; ts: number };
export type AgentStatus = "idle" | "thinking" | "editing" | "waiting" | "error";

export const FEED_CAP = 200;
export const MIRROR_CAP = 50;
export const BUBBLE_MS = 4000;
export const BEAM_MS = 1500;
export const CELEBRATION_MS = 2000;
export const EDITING_WINDOW_MS = 3000;
export const ERROR_WINDOW_MS = 10000;

export interface Store {
  connected: boolean;
  world?: WorldInfo;
  agents: Record<string, Agent>;
  tasks: Record<string, Task>;
  providers: ProviderStatus[];
  /** What "Automatic" resolves to on the server right now. */
  autoProvider: Provider | null;
  settings?: ProjectSettings;
  feed: Record<string, FeedItem[]>;
  bubbles: Record<string, Bubble>;
  beams: Beam[];
  permissions: PendingPermission[];
  questions: PendingQuestion[];
  mirror: MirrorItem[];
  selectedAgentId?: string;
  celebrations: Celebration[];
  errors: UiError[];
  /** Last url returned by `project.open` (hub). */
  opened?: string;

  apply(msg: ServerMessage): void;
  select(id?: string): void;
  send: (m: ClientMessage) => void;
  /** Record a line the user typed so the chat shows it immediately. */
  pushUser(agentId: string, text: string): void;
  /** Send a chat message and echo it into the feed. */
  sendChat(agentId: string, text: string, images?: string[], projectPath?: string): void;
  setConnected(connected: boolean): void;
  dismissError(id: number): void;
  /** Drop expired bubbles, beams and celebrations. */
  tick(now?: number): void;
  reset(): void;
}

let beamSeq = 0;
let errorSeq = 0;

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Bubble text for a run event, or undefined when the event should not surface on the robot. */
export function bubbleFor(event: RunEvent): string | undefined {
  switch (event.type) {
    case "text":
      return event.text.trim().slice(0, 90) || undefined;
    case "tool_start":
      return `⚙ ${event.name}`;
    case "file_changed":
      return `✎ ${basename(event.path)}`;
    case "status":
      return event.text.slice(0, 90);
    default:
      return undefined;
  }
}

function managerFor(agents: Record<string, Agent>, task: Task): string | undefined {
  const creator = agents[task.createdBy];
  if (creator?.role === "manager") return creator.id;
  return Object.values(agents).find((a) => a.role === "manager")?.id;
}

const initial = () => ({
  connected: false,
  world: undefined as WorldInfo | undefined,
  agents: {} as Record<string, Agent>,
  tasks: {} as Record<string, Task>,
  providers: [] as ProviderStatus[],
  autoProvider: null as Provider | null,
  settings: undefined as ProjectSettings | undefined,
  feed: {} as Record<string, FeedItem[]>,
  bubbles: {} as Record<string, Bubble>,
  beams: [] as Beam[],
  permissions: [] as PendingPermission[],
  questions: [] as PendingQuestion[],
  mirror: [] as MirrorItem[],
  selectedAgentId: undefined as string | undefined,
  celebrations: [] as Celebration[],
  errors: [] as UiError[],
  opened: undefined as string | undefined,
});

export const useStore = create<Store>()((set, get) => ({
  ...initial(),
  send: () => undefined,

  apply(msg) {
    const now = Date.now();
    switch (msg.type) {
      case "snapshot": {
        const agents: Record<string, Agent> = {};
        for (const a of msg.agents) agents[a.id] = a;
        const tasks: Record<string, Task> = {};
        for (const t of msg.tasks) tasks[t.id] = t;
        set({
          world: msg.world,
          agents,
          tasks,
          providers: msg.providers,
          autoProvider: msg.autoProvider ?? null,
          settings: msg.settings,
          // The server is the source of truth for prompts still waiting on the user (reload / reconnect).
          permissions: (msg.permissions ?? []).map((p) => ({ id: p.id, agentId: p.agentId, taskId: p.taskId, tool: p.tool, input: p.input })),
          questions: (msg.questions ?? []).map((q) => ({ id: q.id, agentId: q.agentId, taskId: q.taskId, question: q.question })),
        });
        return;
      }
      case "providers.updated":
        set({ providers: msg.providers, autoProvider: msg.autoProvider });
        return;
      case "agent.updated":
        set((s) => ({ agents: { ...s.agents, [msg.agent.id]: msg.agent } }));
        return;
      case "agent.removed":
        set((s) => {
          const agents = { ...s.agents };
          delete agents[msg.id];
          return { agents, selectedAgentId: s.selectedAgentId === msg.id ? undefined : s.selectedAgentId };
        });
        return;
      case "task.updated": {
        const t = msg.task;
        set((s) => {
          const prev = s.tasks[t.id];
          const patch: Partial<Store> = { tasks: { ...s.tasks, [t.id]: t } };
          if (t.kind === "work" && t.status === "assigned" && prev?.status !== "assigned") {
            const from = managerFor(s.agents, t);
            if (from && t.assigneeId) patch.beams = [...s.beams, { id: `b_${++beamSeq}`, from, to: t.assigneeId, until: now + BEAM_MS }];
          }
          if (t.kind === "request" && t.status === "done" && prev?.status !== "done") {
            patch.celebrations = [...s.celebrations, { agentId: t.assigneeId, until: now + CELEBRATION_MS }];
          }
          return patch;
        });
        return;
      }
      case "run.event": {
        set((s) => {
          const list = [...(s.feed[msg.agentId] ?? []), { ts: now, taskId: msg.taskId, event: msg.event }];
          if (list.length > FEED_CAP) list.splice(0, list.length - FEED_CAP);
          const patch: Partial<Store> = { feed: { ...s.feed, [msg.agentId]: list } };
          const text = bubbleFor(msg.event);
          if (text) patch.bubbles = { ...s.bubbles, [msg.agentId]: { text, until: now + BUBBLE_MS } };
          return patch;
        });
        return;
      }
      case "permission.request":
        set((s) => ({ permissions: [...s.permissions.filter((p) => p.id !== msg.id), { id: msg.id, agentId: msg.agentId, taskId: msg.taskId, tool: msg.tool, input: msg.input }] }));
        return;
      case "permission.resolved":
        set((s) => ({ permissions: s.permissions.filter((p) => p.id !== msg.id) }));
        return;
      case "question.request":
        set((s) => ({ questions: [...s.questions.filter((q) => q.id !== msg.id), { id: msg.id, agentId: msg.agentId, taskId: msg.taskId, question: msg.question }] }));
        return;
      case "question.resolved":
        set((s) => ({ questions: s.questions.filter((q) => q.id !== msg.id) }));
        return;
      case "mirror.event":
        set((s) => ({ mirror: [msg.event, ...s.mirror].slice(0, MIRROR_CAP) }));
        return;
      case "error":
        set((s) => ({ errors: [...s.errors, { id: ++errorSeq, message: msg.message, ref: msg.ref, ts: now }].slice(-10) }));
        return;
      case "opened":
        set({ opened: msg.url });
        return;
    }
  },

  select(id) {
    set({ selectedAgentId: id });
  },

  pushUser(agentId, text) {
    set((s) => {
      const list = [...(s.feed[agentId] ?? []), { ts: Date.now(), taskId: "", user: text }];
      if (list.length > FEED_CAP) list.splice(0, list.length - FEED_CAP);
      return { feed: { ...s.feed, [agentId]: list } };
    });
  },

  sendChat(agentId, text, images = [], projectPath) {
    const msg: ClientMessage = { type: "chat.send", agentId, text, images };
    if (projectPath) msg.projectPath = projectPath;
    get().pushUser(agentId, text);
    get().send(msg);
  },

  setConnected(connected) {
    set({ connected });
  },

  dismissError(id) {
    set((s) => ({ errors: s.errors.filter((e) => e.id !== id) }));
  },

  tick(now = Date.now()) {
    const s = get();
    const beams = s.beams.filter((b) => b.until > now);
    const celebrations = s.celebrations.filter((c) => c.until > now);
    let bubbles = s.bubbles;
    let bubblesChanged = false;
    for (const [id, b] of Object.entries(s.bubbles)) {
      if (b.until <= now) {
        if (!bubblesChanged) bubbles = { ...bubbles };
        bubblesChanged = true;
        delete bubbles[id];
      }
    }
    if (beams.length !== s.beams.length || celebrations.length !== s.celebrations.length || bubblesChanged) {
      set({ beams, celebrations, bubbles });
    }
  },

  reset() {
    set({ ...initial(), send: () => undefined });
  },
}));

/** Derive the robot's visual status from tasks, pending prompts and the recent feed. */
export function agentStatus(
  agent: Agent,
  tasks: Task[],
  permissions: PendingPermission[],
  questions: PendingQuestion[],
  feed: FeedItem[] = [],
  now: number = Date.now(),
): AgentStatus {
  if (permissions.some((p) => p.agentId === agent.id) || questions.some((q) => q.agentId === agent.id)) return "waiting";
  const mine = tasks.filter((t) => t.assigneeId === agent.id);
  const active = mine.find((t) => t.status === "running" || t.status === "waiting");
  if (active) {
    const last = feed[feed.length - 1];
    if (last && "event" in last && now - last.ts <= EDITING_WINDOW_MS && (last.event.type === "file_changed" || last.event.type === "tool_start")) {
      return "editing";
    }
    return "thinking";
  }
  const terminal = mine
    .filter((t) => t.status === "done" || t.status === "failed" || t.status === "cancelled")
    .sort((a, b) => Date.parse(b.finishedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.createdAt))[0];
  if (terminal?.status === "failed") {
    const at = Date.parse(terminal.finishedAt ?? terminal.createdAt);
    if (Number.isNaN(at) || now - at <= ERROR_WINDOW_MS) return "error";
  }
  return "idle";
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#6b7280",
  thinking: "#3b82f6",
  editing: "#22c55e",
  waiting: "#f59e0b",
  error: "#ef4444",
};

/** Hook: status for one agent, recomputed as the store changes. */
export function useAgentStatus(agentId: string): AgentStatus {
  return useStore((s) => {
    const agent = s.agents[agentId];
    if (!agent) return "idle";
    return agentStatus(agent, Object.values(s.tasks), s.permissions, s.questions, s.feed[agentId] ?? []);
  });
}

export const FILE_CHIP_MS = 6000;
export const FILE_CHIP_MAX = 3;

export interface FileChip {
  name: string;
  path: string;
  /** 1 when fresh, fading to 0 at FILE_CHIP_MS. */
  opacity: number;
}

/** The last few files an agent touched recently, for the chips floating above its desk. */
export function fileChipsFor(feed: FeedItem[], now: number = Date.now()): FileChip[] {
  const chips: FileChip[] = [];
  for (let i = feed.length - 1; i >= 0 && chips.length < FILE_CHIP_MAX; i--) {
    const item = feed[i]!;
    if (!("event" in item) || item.event.type !== "file_changed") continue;
    const age = now - item.ts;
    if (age >= FILE_CHIP_MS) break;
    chips.unshift({ name: basename(item.event.path), path: item.event.path, opacity: 1 - age / FILE_CHIP_MS });
  }
  return chips;
}

export function selectManager(s: Store): Agent | undefined {
  return Object.values(s.agents).find((a) => a.role === "manager");
}

export function sortedAgents(agents: Record<string, Agent>): Agent[] {
  return Object.values(agents).sort((a, b) => (a.role === b.role ? a.createdAt.localeCompare(b.createdAt) : a.role === "manager" ? -1 : 1));
}
