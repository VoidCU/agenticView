import { basename, join } from "node:path";
import {
  GlobalConfigSchema,
  PROVIDER_ORDER,
  ProjectSettingsSchema,
  type GlobalConfig,
  type ProjectSettings,
  type Provider,
  type ProviderStatus,
  type Snapshot,
  type WorldInfo,
  type WorkerSessionInfo,
  WorkerSessionFileSchema,
} from "@agenticview/shared";
import { SessionRuntime, type RecentWork } from "./runtimes/session.js";
import { subagentNames, syncSubagents, writeSubagent, type SyncResult } from "./agents/subagents.js";
import { AgentRegistry, type WorldRef } from "./agents/registry.js";
import { TaskService } from "./tasks/taskService.js";
import { Orchestrator, type ResolvedSettings, type WorldDeps } from "./manager/orchestrator.js";
import type { Runtime, BridgeTool } from "./runtimes/types.js";
import type { ToolRegistry } from "./bridge/toolRegistry.js";
import type { EventBus } from "./events/bus.js";
import { readJsonFile, writeJsonFile } from "./store/jsonStore.js";
import { ensureProjectGitignore, globalRoot, projectRoot } from "./store/paths.js";
import { isTerminal, type Agent, type Task } from "@agenticview/shared";
import { cleanupGeminiSettings } from "./runtimes/gemini.js";

export interface WorldOptions {
  runtimes: Map<Provider, Runtime>;
  bus: EventBus;
  toolRegistry: ToolRegistry;
  bridgeUrl: () => string;
  workerTools?: (agent: Agent, task: Task) => BridgeTool[];
}

export interface World {
  ref: WorldRef;
  root: string;
  registry: AgentRegistry;
  tasks: TaskService;
  orchestrator: Orchestrator;
  bus: EventBus;
  runtimes: Map<Provider, Runtime>;
  settings: () => ResolvedSettings;
  updateSettings: (patch: Partial<ProjectSettings>) => Promise<ProjectSettings>;
  info: () => Promise<WorldInfo>;
  snapshot: () => Promise<Snapshot>;
  providerStatuses: () => Promise<ProviderStatus[]>;
  /** Claude Code sessions known to this world, with live state and the agents bound to each. */
  sessions: () => Promise<WorkerSessionInfo[]>;
  /** Rewrite the project's claude-session subagent files (project worlds; no-op in the hub). */
  syncSubagents: () => Promise<SyncResult | undefined>;
  /** The claude-session runtime, when configured. */
  sessionRuntime?: SessionRuntime;
  /** Push fresh provider availability (and the Automatic choice) to every client. */
  emitProviders: () => Promise<void>;
}

export function globalConfigPath(): string {
  return join(globalRoot(), "config.json");
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  return readJsonFile(globalConfigPath(), GlobalConfigSchema, GlobalConfigSchema.parse({}));
}

export async function rememberProject(projectPath: string): Promise<GlobalConfig> {
  const cfg = await readGlobalConfig();
  const now = new Date().toISOString();
  const rest = cfg.knownProjects.filter((p) => p.path !== projectPath);
  cfg.knownProjects = [{ path: projectPath, name: basename(projectPath) || projectPath, lastOpened: now }, ...rest].slice(0, 50);
  await writeJsonFile(globalConfigPath(), cfg);
  return cfg;
}

/** Wire persistence, registry, tasks, and the orchestrator for one project or the hub. */
export async function createWorld(ref: WorldRef, opts: WorldOptions): Promise<World> {
  const root = ref.kind === "project" ? projectRoot(ref.projectPath) : globalRoot();
  if (ref.kind === "project") await ensureProjectGitignore(ref.projectPath);

  let globalConfig = await readGlobalConfig();
  if (ref.kind === "project") globalConfig = await rememberProject(ref.projectPath);

  const settingsFile = join(root, "settings.json");
  let projectSettings: ProjectSettings =
    ref.kind === "project"
      ? await readJsonFile(settingsFile, ProjectSettingsSchema, ProjectSettingsSchema.parse({}))
      : ProjectSettingsSchema.parse({ defaultProvider: null, defaultModel: null, maxConcurrentRuns: globalConfig.maxConcurrentRuns });

  const settings = (): ResolvedSettings => ({
    ...projectSettings,
    globalDefaultProvider: globalConfig.defaultProvider,
    globalDefaultModel: globalConfig.defaultModel,
    providerModels: {
      claude: globalConfig.providers.claude.model,
      codex: globalConfig.providers.codex.model,
      gemini: globalConfig.providers.gemini.model,
    },
  });

  const registry = new AgentRegistry(ref);
  // Only state changes go on the wire, and never with the log: the web feed is built from run.events.
  const tasks = new TaskService(ref.kind === "project" ? join(root, "tasks") : join(root, "hub-tasks"), (task, kind) => {
    if (kind === "state") opts.bus.emit({ type: "task.updated", task: toWire(task) });
  });
  await tasks.recoverInterrupted();
  await registry.ensureManager();
  if (ref.kind === "project") await cleanupGeminiSettings(ref.projectPath);

  const info = async (): Promise<WorldInfo> => {
    const cfg = await readGlobalConfig();
    globalConfig = cfg;
    return {
      kind: ref.kind,
      name: ref.kind === "project" ? basename(ref.projectPath) || ref.projectPath : "Hub",
      projectPath: ref.kind === "project" ? ref.projectPath : null,
      knownProjects: cfg.knownProjects,
    };
  };

  const deps: WorldDeps = {
    world: ref,
    root,
    registry,
    tasks,
    runtimes: opts.runtimes,
    toolRegistry: opts.toolRegistry,
    bus: opts.bus,
    settings,
    info,
    bridgeUrl: opts.bridgeUrl,
    knownProjects: () => globalConfig.knownProjects,
    workerTools: opts.workerTools,
  };
  const orchestrator = new Orchestrator(deps);

  // Claude Code sessions (claude-session workers): records persist next to the agents, and the
  // agent<->session binding persists on each agent.
  const sessionRt = opts.runtimes.get("claude-session");
  const sessionRuntime = sessionRt instanceof SessionRuntime ? sessionRt : undefined;
  const sessionsFile = join(root, "worker-sessions.json");
  const sessions = async (): Promise<WorkerSessionInfo[]> => {
    if (!sessionRuntime) return [];
    const agents = await registry.list();
    return sessionRuntime.sessionList().map(({ currentRunId: _r, currentAgentId: _a, ...s }) => ({
      ...s,
      agentIds: agents.filter((a) => a.session?.id === s.id).map((a) => a.id),
    }));
  };
  // Subagent files (.claude/agents/agenticview-<slug>.md) for the claude-session agents: the session
  // launches each task in its agent's subagent. Writes are chained so syncs never interleave.
  const onSession = async (a: Agent) => (await orchestrator.resolveProviderLive(a)).provider === "claude-session";
  const sessionAgents = async () => {
    const out: Agent[] = [];
    for (const a of await registry.list()) if (await onSession(a)) out.push(a);
    return out;
  };
  let fileChain: Promise<unknown> = Promise.resolve();
  const chained = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = fileChain.then(fn, fn);
    fileChain = next.catch(() => undefined);
    return next;
  };
  const syncProjectSubagents = (): Promise<SyncResult | undefined> =>
    ref.kind !== "project"
      ? Promise.resolve(undefined)
      : chained(async () =>
          syncSubagents(ref.projectPath, await sessionAgents(), async (id) => {
            const a = await registry.get(id);
            return Boolean(a && (await onSession(a)));
          }),
        ).catch((e) => {
          console.error("[agenticview] syncing subagent files failed", e);
          return undefined;
        });

  /** The agent's last finished tasks, newest first, for the "Your recent work" digest. */
  const recentWork = async (agentId: string, exceptTaskId?: string): Promise<RecentWork[]> =>
    (await tasks.list())
      .filter((t) => t.assigneeId === agentId && t.id !== exceptTaskId && isTerminal(t.status))
      .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
      .slice(0, 5)
      .map((t) => {
        const files = t.worker?.files ?? [...new Set(t.log.filter((l) => l.type === "file_changed").map((l) => l.text.replace(/^\S+\s+/, "")))];
        const summary = (t.status === "done" ? t.result : (t.error ?? t.result)) ?? "";
        return {
          taskId: t.id,
          title: t.title,
          status: t.status,
          summary: summary.replace(/\s+/g, " ").trim().slice(0, 300),
          files: files.slice(0, 12),
          ...(t.finishedAt ? { finishedAt: t.finishedAt } : {}),
          ...(t.worker?.subagentId ? { subagentId: t.worker.subagentId } : {}),
          ...(t.worker?.sessionName ? { sessionName: t.worker.sessionName } : {}),
        };
      });

  if (sessionRuntime) {
    const saved = await readJsonFile(sessionsFile, WorkerSessionFileSchema, { sessions: [] }).catch(() => ({ sessions: [] }));
    sessionRuntime.attach(
      {
        bindingOf: async (id) => (await registry.get(id))?.session?.id ?? null,
        bind: async (id, s) => {
          const agent = await registry.update(id, { session: s });
          opts.bus.emit({ type: "agent.updated", agent });
        },
        findAgent: async (ref) => {
          const all = await registry.list();
          const k = ref.trim().toLowerCase();
          const a = all.find((x) => x.id === ref.trim()) ?? all.find((x) => x.name.toLowerCase() === k);
          return a ? { id: a.id, name: a.name } : undefined;
        },
        save: (list) => writeJsonFile(sessionsFile, { sessions: list }),
        prepare: async (req) => {
          const task = req.taskId ? await tasks.get(req.taskId) : undefined;
          const target = task?.projectPath || (ref.kind === "project" ? ref.projectPath : "");
          const work = await recentWork(req.agent.id, req.taskId);
          // Hub runs without a target project: no folder to put a subagent in, the session does it itself.
          if (!target) return { subagent: null, recentWork: work };
          if (ref.kind === "project") await syncProjectSubagents();
          const agent = (await registry.get(req.agent.id)) ?? req.agent;
          const peers = ref.kind === "project" ? await sessionAgents() : [];
          const names = subagentNames(peers.some((p) => p.id === agent.id) ? peers : [...peers, agent]);
          const out = await chained(() => writeSubagent(target, agent, names.get(agent.id)!));
          return { subagent: out.name, recentWork: work };
        },
        attribute: async (info) => {
          if (!info.taskId) return;
          await tasks.setWorker(info.taskId, {
            runId: info.runId,
            sessionId: info.sessionId,
            sessionName: info.sessionName,
            ...(info.subagent ? { subagent: info.subagent } : {}),
            ...(info.subagentId ? { subagentId: info.subagentId } : {}),
            ...(info.files ? { files: info.files } : {}),
          });
        },
      },
      saved.sessions,
    );
    sessionRuntime.onSessionsChanged = () => void sessions().then((list) => opts.bus.emit({ type: "sessions.updated", sessions: list }), () => undefined);
    // A binding changed in the office (or a new agent): a waiting session may now take its task.
    opts.bus.on((m) => {
      if (m.type === "agent.updated" || m.type === "agent.removed") {
        sessionRuntime.kick();
        // New, edited, re-providered or deleted agent: refresh its subagent file (or remove it).
        void syncProjectSubagents();
        void sessions().then((list) => opts.bus.emit({ type: "sessions.updated", sessions: list }), () => undefined);
      }
    });
  }

  if (sessionRuntime) await syncProjectSubagents();

  const providerStatuses = async (): Promise<ProviderStatus[]> => {
    const out: ProviderStatus[] = [];
    for (const p of PROVIDER_ORDER) {
      const rt = opts.runtimes.get(p);
      out.push(rt ? await rt.check() : { provider: p, ok: false, reason: "not configured" });
    }
    return out;
  };

  return {
    ref,
    root,
    registry,
    tasks,
    orchestrator,
    bus: opts.bus,
    runtimes: opts.runtimes,
    settings,
    info,
    providerStatuses,
    sessions,
    sessionRuntime,
    syncSubagents: syncProjectSubagents,
    emitProviders: async () => {
      opts.bus.emit({ type: "providers.updated", providers: await providerStatuses(), autoProvider: await orchestrator.autoProvider() });
    },
    updateSettings: async (patch) => {
      projectSettings = ProjectSettingsSchema.parse({ ...projectSettings, ...patch });
      if (ref.kind === "project") await writeJsonFile(settingsFile, projectSettings);
      else {
        const cfg = await readGlobalConfig();
        if (patch.maxConcurrentRuns) cfg.maxConcurrentRuns = patch.maxConcurrentRuns;
        if (patch.defaultProvider !== undefined) cfg.defaultProvider = patch.defaultProvider;
        if (patch.defaultModel !== undefined) cfg.defaultModel = patch.defaultModel;
        await writeJsonFile(globalConfigPath(), cfg);
        globalConfig = cfg;
      }
      return projectSettings;
    },
    snapshot: async () => ({
      world: await info(),
      agents: await registry.list(),
      tasks: (await tasks.list()).map(toWire),
      providers: await providerStatuses(),
      autoProvider: await orchestrator.autoProvider(),
      settings: projectSettings,
      sessions: await sessions(),
      ...orchestrator.pending(),
    }),
  };
}

/** Wire form of a task: identical minus the (potentially large) log. */
export function toWire(task: Task): Task {
  return { ...task, log: [] };
}
