import type { Agent, Task, ServerMessage } from "@agenticview/shared";

export function agent(over: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    role: "worker",
    scope: "project",
    specialty: "Frontend",
    description: "",
    provider: null,
    model: null,
    systemPrompt: "",
    tools: { edit: true, shell: true, web: false, screenshot: false },
    permissionMode: "auto-edit",
    appearance: { color: "#5b8cff", accent: "#ffffff", eyes: "round" },
    stats: { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...over,
  };
}

export const manager = agent({
  id: "m_00000001",
  name: "Atlas",
  role: "manager",
  specialty: "Manager",
  appearance: { color: "#ffd166", accent: "#ffd166", eyes: "visor" },
});
export const worker = agent({ id: "w_00000001", name: "Pixel" });
export const worker2 = agent({ id: "w_00000002", name: "Byte" });

export function task(over: Partial<Task> & { id: string }): Task {
  return {
    kind: "work",
    title: "Do a thing",
    description: "Do a thing",
    status: "queued",
    createdBy: manager.id,
    assigneeId: worker.id,
    projectPath: "C:/proj",
    images: [],
    log: [],
    createdAt: "2026-09-25T00:00:00.000Z",
    ...over,
  };
}

export function snapshot(agents: Agent[], tasks: Task[] = []): ServerMessage {
  return {
    type: "snapshot",
    world: { kind: "project", name: "proj", projectPath: "C:/proj", knownProjects: [] },
    agents,
    tasks,
    permissions: [],
    questions: [],
    providers: [
      { provider: "claude", ok: true, version: "1.0" },
      { provider: "claude-session", ok: false, reason: "Run /agenticview-work in a Claude Code session to connect it." },
      { provider: "codex", ok: false, reason: "codex CLI not installed" },
      { provider: "antigravity", ok: false, reason: "agy not installed" },
      { provider: "gemini", ok: true },
    ],
    autoProvider: "claude",
    settings: { defaultProvider: null, defaultModel: null, maxConcurrentRuns: 3, limitPolicy: "ask" as const, failoverOrder: [], loungeBreaks: true, preferCheapModels: true, idleLoungeMinutes: 3 },
  };
}
