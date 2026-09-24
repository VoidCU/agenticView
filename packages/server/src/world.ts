import { basename, join } from "node:path";
import {
  GlobalConfigSchema,
  ProjectSettingsSchema,
  type GlobalConfig,
  type ProjectSettings,
  type Provider,
  type ProviderStatus,
  type Snapshot,
  type WorldInfo,
} from "@agenticview/shared";
import { AgentRegistry, type WorldRef } from "./agents/registry.js";
import { TaskService } from "./tasks/taskService.js";
import { Orchestrator, type ResolvedSettings, type WorldDeps } from "./manager/orchestrator.js";
import type { Runtime, BridgeTool } from "./runtimes/types.js";
import type { ToolRegistry } from "./bridge/toolRegistry.js";
import type { EventBus } from "./events/bus.js";
import { readJsonFile, writeJsonFile } from "./store/jsonStore.js";
import { ensureProjectGitignore, globalRoot, projectRoot } from "./store/paths.js";
import type { Agent, Task } from "@agenticview/shared";
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

  const providerStatuses = async (): Promise<ProviderStatus[]> => {
    const out: ProviderStatus[] = [];
    for (const p of ["claude", "codex", "gemini"] as const) {
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
    updateSettings: async (patch) => {
      projectSettings = ProjectSettingsSchema.parse({ ...projectSettings, ...patch });
      if (ref.kind === "project") await writeJsonFile(settingsFile, projectSettings);
      else {
        const cfg = await readGlobalConfig();
        if (patch.maxConcurrentRuns) cfg.maxConcurrentRuns = patch.maxConcurrentRuns;
        if (patch.defaultProvider) cfg.defaultProvider = patch.defaultProvider;
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
      settings: projectSettings,
      ...orchestrator.pending(),
    }),
  };
}

/** Wire form of a task: identical minus the (potentially large) log. */
export function toWire(task: Task): Task {
  return { ...task, log: [] };
}
