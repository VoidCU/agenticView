import { join } from "node:path";
import { z } from "zod";
import {
  effectiveEffort,
  isTerminal,
  newId,
  ProviderSchema,
  PROVIDER_ORDER,
  WORK_COMMAND,
  type Agent,
  type PromptPart,
  type Provider,
  type ProjectSettings,
  type PendingPermissionInfo,
  type PendingQuestionInfo,
  type PendingLimitInfo,
  type RunEvent,
  type Task,
  type WorldInfo,
} from "@agenticview/shared";
import { classifyError } from "../runtimes/errors.js";
import type { AgentRegistry, WorldRef } from "../agents/registry.js";
import type { TaskService } from "../tasks/taskService.js";
import type { BridgeTool, Runtime, RunRequest } from "../runtimes/types.js";
import type { ToolRegistry } from "../bridge/toolRegistry.js";
import type { EventBus } from "../events/bus.js";
import { readJsonFile, writeJsonFile } from "../store/jsonStore.js";
import { buildRosterPreamble } from "./preamble.js";
import { SessionRuntime } from "../runtimes/session.js";
import { MANAGER_SYSTEM_PROMPT, managerTools, workerSystemPrompt } from "./tools.js";

export interface ResolvedSettings extends ProjectSettings {
  globalDefaultProvider: Provider | null;
  globalDefaultModel: string | null;
  providerModels: Partial<Record<Provider, string | undefined>>;
}

import type { UsageTracker } from "./usageTracker.js";

export interface WorldDeps {
  world: WorldRef;
  root: string;
  registry: AgentRegistry;
  tasks: TaskService;
  runtimes: Map<Provider, Runtime>;
  toolRegistry: ToolRegistry;
  bus: EventBus;
  settings: () => ResolvedSettings;
  info: () => Promise<WorldInfo>;
  bridgeUrl: () => string;
  knownProjects: () => { path: string; name: string; lastOpened: string }[];
  /** Extra bridge tools for worker runs (e.g. take_screenshot). */
  workerTools?: (agent: Agent, task: Task) => BridgeTool[];
  spaceNames?: () => Record<string, string>;
  renameSpace?: (id: string, name: string) => Promise<void>;
  usageTracker?: UsageTracker;
  emitProviders?: () => Promise<void>;
  addRoom?: (kind: "pod" | "meeting" | "lounge", name: string) => Promise<{ ok: true; spaceId: string } | { ok: false; message: string }>;
  /** Override the auto-revive delay (ms) for tests. Default 6000. */
  reviveDelayMs?: number;
  /** Override the revive-done clear delay (ms) for tests. Default 5000. */
  reviveClearMs?: number;
}

/** Provider preference order for revive (skip claude which just hit the limit). */
const REVIVE_CANDIDATES: readonly Provider[] = ["claude-session", "antigravity", "codex", "gemini", "claude"];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface UserMessageInput {
  agentId: string;
  text: string;
  images?: string[];
  projectPath?: string;
}

const SessionFileSchema = z.record(z.string(), z.object({ provider: ProviderSchema, sessionId: z.string() }));
type SessionFile = z.infer<typeof SessionFileSchema>;

const LOG_COALESCE_LIMIT = 2000;

/** Runs tasks on runtimes, keeps the Manager's map truthful, and mediates permissions and questions. */
export class Orchestrator {
  private readonly aborts = new Map<string, AbortController>();
  private readonly active = new Set<string>();
  /** Agent+conversation keys a run is currently resuming (see execute). */
  private readonly resuming = new Set<string>();
  private readonly queue: string[] = [];
  private readonly waiters = new Map<string, Array<(t: Task) => void>>();
  private readonly pendingPermissions = new Map<string, { info: PendingPermissionInfo; resolve: (allow: boolean) => void }>();
  private readonly pendingQuestions = new Map<string, { info: PendingQuestionInfo; resolve: (answer: string) => void }>();
  private readonly pendingLimits = new Map<string, { info: PendingLimitInfo; resolve: (answer: "accept" | "choose" | "dismiss", provider?: Provider, model?: string) => void }>();
  private pumping = false;

  constructor(private readonly deps: WorldDeps) {}

  running(): number {
    return this.active.size;
  }

  /**
   * Provider and model for an agent. `auto` is what "Automatic" currently resolves to (see
   * autoProvider()); without it an unset default falls back to Claude.
   */
  resolveProvider(agent: Agent, auto?: Provider | null): { provider: Provider; model?: string } {
    const s = this.deps.settings();
    if (agent.provider) {
      return { provider: agent.provider, model: agent.model ?? s.providerModels[agent.provider] ?? undefined };
    }
    const provider = s.defaultProvider ?? s.globalDefaultProvider ?? auto ?? "claude";
    const model = agent.model ?? s.defaultModel ?? s.globalDefaultModel ?? s.providerModels[provider] ?? undefined;
    return { provider, model: model ?? undefined };
  }

  /** True when no explicit provider applies to this agent, so "Automatic" decides. */
  private isAutomatic(agent: Agent): boolean {
    const s = this.deps.settings();
    return !agent.provider && !s.defaultProvider && !s.globalDefaultProvider;
  }

  /** "Automatic": the first provider in PROVIDER_ORDER whose check() is ok, or null when none is. */
  async autoProvider(): Promise<Provider | null> {
    for (const p of PROVIDER_ORDER) {
      const rt = this.deps.runtimes.get(p);
      if (rt && (await rt.check()).ok) return p;
    }
    return null;
  }

  /** resolveProvider(), consulting the live provider checks when the agent is on Automatic. */
  async resolveProviderLive(agent: Agent): Promise<{ provider: Provider; model?: string }> {
    return this.resolveProvider(agent, this.isAutomatic(agent) ? await this.autoProvider() : undefined);
  }

  /** Returns a human-readable problem when the agent's provider cannot run, else undefined. */
  async providerProblem(agent: Agent): Promise<string | undefined> {
    if (this.isAutomatic(agent) && !(await this.autoProvider())) {
      return "no provider available: set ANTHROPIC_API_KEY, run /agenticview-work in a Claude Code session, or sign in to the codex, agy (Antigravity) or gemini CLI";
    }
    const { provider } = await this.resolveProviderLive(agent);
    const runtime = this.deps.runtimes.get(provider);
    if (!runtime) return `provider ${provider} unavailable: not configured`;
    // Session runs wait in the queue until a worker connects instead of failing.
    if (provider === "claude-session") return undefined;
    const status = await runtime.check();
    if (!status.ok) return `provider ${provider} unavailable: ${status.reason ?? "unknown reason"}`;
    return undefined;
  }

  emitAgent(agent: Agent): void {
    this.deps.bus.emit({ type: "agent.updated", agent });
  }

  async handleUserMessage(input: UserMessageInput): Promise<Task> {
    const agent = await this.deps.registry.get(input.agentId);
    if (!agent) throw new Error(`Unknown agent ${input.agentId}`);
    const world = this.deps.world;
    let projectPath: string;
    if (world.kind === "project") {
      projectPath = world.projectPath;
    } else if (agent.role === "manager") {
      if (input.projectPath && !this.deps.knownProjects().some((p) => p.path === input.projectPath)) throw new Error(`${input.projectPath} is not a known project`);
      projectPath = input.projectPath ?? "";
    } else {
      if (!input.projectPath) throw new Error("projectPath is required to chat with a global agent from the hub");
      if (!this.deps.knownProjects().some((p) => p.path === input.projectPath)) throw new Error(`${input.projectPath} is not a known project`);
      projectPath = input.projectPath;
    }
    const isManager = agent.role === "manager";
    const task = await this.deps.tasks.create({
      kind: isManager ? "request" : "chat",
      title: input.text.length > 80 ? `${input.text.slice(0, 77)}...` : input.text,
      description: input.text,
      createdBy: "user",
      assigneeId: agent.id,
      projectPath,
      images: input.images ?? [],
    });
    await this.deps.tasks.log(task.id, "user", input.text);
    await this.deps.tasks.transition(task.id, "assigned");
    this.startTask(task.id);
    return task;
  }

  startTask(taskId: string): void {
    void (async () => {
      const cur = await this.deps.tasks.get(taskId);
      if (!cur) return;
      if (cur.status === "queued") await this.deps.tasks.transition(taskId, "assigned");
      this.queue.push(taskId);
      await this.pump();
    })().catch((e) => console.error("[agenticview] startTask failed", e));
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      let i = 0;
      while (i < this.queue.length) {
        const id = this.queue[i]!;
        const task = await this.deps.tasks.get(id);
        if (!task || task.status !== "assigned") {
          this.queue.splice(i, 1);
          continue;
        }
        const agent = await this.deps.registry.get(task.assigneeId);
        const isManager = agent?.role === "manager";
        // Claude Code session runs happen in the user's own sessions, which enforce their own per-session
        // capacity, so they neither wait for nor take up the office-wide worker slots.
        const inSession = !!agent && (await this.resolveProviderLive(agent)).provider === "claude-session";
        const limited = !isManager && !inSession;
        if (limited && this.active.size >= this.deps.settings().maxConcurrentRuns) {
          // Keep FIFO among limited tasks, but let managers and session tasks behind it start.
          i++;
          continue;
        }
        this.queue.splice(i, 1);
        if (limited) this.active.add(id);
        void this.execute(task).finally(() => {
          this.active.delete(id);
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  async awaitTask(taskId: string): Promise<Task> {
    const cur = await this.deps.tasks.get(taskId);
    if (!cur) throw new Error(`Unknown task ${taskId}`);
    if (isTerminal(cur.status)) return cur;
    return new Promise<Task>((resolve) => {
      const list = this.waiters.get(taskId) ?? [];
      list.push(resolve);
      this.waiters.set(taskId, list);
    });
  }

  private settle(task: Task): void {
    const list = this.waiters.get(task.id);
    this.waiters.delete(task.id);
    for (const fn of list ?? []) fn(task);
  }

  /** Cancel a task; a request also cancels every non-terminal child it spawned. */
  async cancel(taskId: string): Promise<void> {
    const cur = await this.deps.tasks.get(taskId);
    if (!cur || isTerminal(cur.status)) return;
    const idx = this.queue.indexOf(taskId);
    if (idx >= 0) this.queue.splice(idx, 1);
    this.aborts.get(taskId)?.abort();
    const next = await this.deps.tasks.transition(taskId, "cancelled");
    this.active.delete(taskId);
    this.resolvePendingFor(taskId);
    this.settle(next);
    if (cur.kind === "request") {
      for (const child of await this.deps.tasks.children(taskId)) if (!isTerminal(child.status)) await this.cancel(child.id);
    }
    void this.pump();
  }

  /** Prompts currently waiting on the user, for snapshots and reconnecting tabs. */
  pending(): { permissions: PendingPermissionInfo[]; questions: PendingQuestionInfo[]; limits: PendingLimitInfo[] } {
    return {
      permissions: [...this.pendingPermissions.values()].map((p) => p.info),
      questions: [...this.pendingQuestions.values()].map((q) => q.info),
      limits: [...this.pendingLimits.values()].map((l) => l.info),
    };
  }

  respondLimit(id: string, answer: "accept" | "choose" | "dismiss", provider?: Provider, model?: string): void {
    const entry = this.pendingLimits.get(id);
    if (!entry) return;
    this.pendingLimits.delete(id);
    this.deps.bus.emit({ type: "limit.resolved", id });
    entry.resolve(answer, provider, model);
  }

  /** Pick the best available provider to revive an agent on, skipping the one that just failed. */
  pickReviveProvider(failedProvider: Provider): { provider: Provider; model?: string } | undefined {
    const s = this.deps.settings();
    for (const p of REVIVE_CANDIDATES) {
      if (p === failedProvider) continue;
      const rt = this.deps.runtimes.get(p);
      if (!rt) continue;
      const lim = this.deps.usageTracker?.getProviderLimit(p);
      if (lim?.limited) continue;
      const model = s.providerModels[p] ?? undefined;
      return { provider: p, model };
    }
    return undefined;
  }

  /** Trigger the revive state machine for a worker agent after a quota/rate-limit failure. */
  private async triggerRevive(agent: Agent, failedProvider: Provider, failedTaskId: string, errorText: string, managerId?: string): Promise<void> {
    const { registry } = this.deps;
    try {
      const s = this.deps.settings();
      const suggested = this.pickReviveProvider(failedProvider);
      const fainted = await registry.update(agent.id, { revive: { phase: "fainted", managerId, suggested, failedTaskId } });
      this.emitAgent(fainted);

      if (s.limitPolicy === "auto" && suggested) {
        // Short delay then switch and retry automatically (only when an alternate provider is available).
        const revivingAgent = await registry.update(agent.id, { revive: { phase: "reviving", managerId, suggested, failedTaskId } });
        this.emitAgent(revivingAgent);
        await delay(this.deps.reviveDelayMs ?? 6000);
        await this.reviveAgent(agent.id, suggested.provider, suggested.model);
        return;
      }
      // No alternate provider available, or limitPolicy === "ask": prompt the user.
      {
        // Ask mode: create a pending limit request that the user resolves.
        const id = newId("lim");
        const info: PendingLimitInfo = { id, agentId: agent.id, taskId: failedTaskId, suggested, reason: errorText };
        this.deps.bus.emit({ type: "limit.request", ...info });
        const answer = await new Promise<{ answer: "accept" | "choose" | "dismiss"; provider?: Provider; model?: string }>((resolve) => {
          this.pendingLimits.set(id, { info, resolve: (answer, provider, model) => resolve({ answer, provider, model }) });
        });
        if (answer.answer === "dismiss") {
          const cur = await registry.get(agent.id);
          if (cur) {
            const cleared = await registry.update(agent.id, { revive: undefined });
            this.emitAgent(cleared);
          }
          return;
        }
        const chosenProvider = answer.answer === "choose" ? answer.provider : suggested?.provider;
        const chosenModel = answer.answer === "choose" ? answer.model : suggested?.model;
        const cur = await registry.get(agent.id);
        if (!cur) return;
        const revivingAgent = await registry.update(agent.id, { revive: { phase: "reviving", managerId, suggested, failedTaskId } });
        this.emitAgent(revivingAgent);
        await this.reviveAgent(agent.id, chosenProvider, chosenModel);
      }
    } catch (e) {
      console.error("[agenticview] triggerRevive failed", (e as Error).message);
    }
  }

  /** Switch agent to a new provider and retry its last failed task. */
  async reviveAgent(agentId: string, provider?: Provider, model?: string): Promise<void> {
    const { registry, tasks } = this.deps;
    try {
      const agent = await registry.get(agentId);
      if (!agent) return;
      const failedTaskId = agent.revive?.failedTaskId;
      // Switch provider.
      const updated = await registry.update(agentId, { provider: provider ?? null, model: model ?? null, limit: undefined, revive: { phase: "done", failedTaskId } });
      this.emitAgent(updated);
      // Retry the task.
      if (failedTaskId) {
        const task = await tasks.get(failedTaskId);
        if (task && task.status === "failed") {
          await tasks.transition(failedTaskId, "queued", { error: undefined, result: undefined });
          this.startTask(failedTaskId);
        }
      }
      // Clear revive state after a brief window so the client can show the "done" phase.
      const clearMs = this.deps.reviveClearMs ?? 5000;
      void delay(clearMs).then(async () => {
        const cur = await registry.get(agentId);
        if (cur?.revive?.phase === "done") {
          const cleared = await registry.update(agentId, { revive: undefined }).catch(() => undefined);
          if (cleared) this.emitAgent(cleared);
        }
      }).catch(() => undefined);
    } catch (e) {
      console.error("[agenticview] reviveAgent failed", (e as Error).message);
    }
  }

  /** A task that ended (or was cancelled) can no longer be waiting on anyone: deny/close its prompts. */
  private resolvePendingFor(taskId: string): void {
    for (const [id, p] of this.pendingPermissions) if (p.info.taskId === taskId) this.respondPermission(id, false);
    for (const [id, q] of this.pendingQuestions) if (q.info.taskId === taskId) this.respondQuestion(id, "");
  }

  respondPermission(id: string, allow: boolean): void {
    const entry = this.pendingPermissions.get(id);
    if (!entry) return;
    this.pendingPermissions.delete(id);
    this.deps.bus.emit({ type: "permission.resolved", id });
    entry.resolve(allow);
  }

  respondQuestion(id: string, answer: string): void {
    const entry = this.pendingQuestions.get(id);
    if (!entry) return;
    this.pendingQuestions.delete(id);
    this.deps.bus.emit({ type: "question.resolved", id });
    entry.resolve(answer);
  }

  private async setWaiting(taskId: string, waiting: boolean): Promise<void> {
    try {
      const cur = await this.deps.tasks.get(taskId);
      if (!cur) return;
      if (waiting && cur.status === "running") await this.deps.tasks.transition(taskId, "waiting");
      else if (!waiting && cur.status === "waiting") await this.deps.tasks.transition(taskId, "running");
    } catch {
      // The task was cancelled or finished meanwhile; nothing to restore.
    }
  }

  async requestPermission(taskId: string, agentId: string, req: { id: string; tool: string; input: unknown }): Promise<boolean> {
    await this.setWaiting(taskId, true);
    const info: PendingPermissionInfo = { id: req.id, agentId, taskId, tool: req.tool, input: req.input };
    this.deps.bus.emit({ type: "permission.request", ...info });
    const allow = await new Promise<boolean>((resolve) => this.pendingPermissions.set(req.id, { info, resolve }));
    await this.setWaiting(taskId, false);
    return allow;
  }

  async askUser(taskId: string, agentId: string, question: string): Promise<string> {
    const id = newId("u");
    await this.setWaiting(taskId, true);
    const info: PendingQuestionInfo = { id, agentId, taskId, question };
    this.deps.bus.emit({ type: "question.request", ...info });
    const answer = await new Promise<string>((resolve) => this.pendingQuestions.set(id, { info, resolve }));
    await this.setWaiting(taskId, false);
    return answer;
  }

  private sessionKey(task: Task, agent: Agent): string {
    if (agent.role === "manager") return this.deps.world.kind === "project" ? this.deps.world.projectPath : "hub";
    return task.projectPath || "hub";
  }

  private sessionFile(agentId: string): string {
    return join(this.deps.root, "sessions", `${agentId}.json`);
  }

  private async loadSession(agent: Agent, key: string, provider: Provider): Promise<string | undefined> {
    const file = await readJsonFile<SessionFile>(this.sessionFile(agent.id), SessionFileSchema, {});
    const entry = file[key];
    return entry && entry.provider === provider ? entry.sessionId : undefined;
  }

  private async saveSession(agent: Agent, key: string, provider: Provider, sessionId: string): Promise<void> {
    const file = await readJsonFile<SessionFile>(this.sessionFile(agent.id), SessionFileSchema, {});
    file[key] = { provider, sessionId };
    await writeJsonFile(this.sessionFile(agent.id), file);
  }

  private async buildPrompt(task: Task, agent: Agent): Promise<PromptPart[]> {
    let text: string;
    if (task.kind === "request") {
      const preamble = buildRosterPreamble(await this.deps.info(), await this.deps.registry.list(), await this.deps.tasks.list());
      const target = this.deps.world.kind === "hub" && task.projectPath ? `\n\nTarget project: ${task.projectPath} (pass this as projectPath to assign_task)` : "";
      text = `${preamble}${target}\n\n## User request\n${task.description}`;
    } else if (task.kind === "work") {
      text = `${task.title}\n\n${task.description}`;
    } else {
      text = task.description;
    }
    void agent;
    return [{ type: "text", text }, ...task.images.map((path): PromptPart => ({ type: "image", path }))];
  }

  /**
   * claude-session deadlock guard for a Manager run `runId`. A session runs several tasks at once (one
   * subagent each), so a worker bound to the Manager's own session is fine as long as that session has
   * a slot the waiting Manager does not occupy. It is a deadlock only when the target's task could be
   * picked up by nothing but that session and every slot of it is held by a waiting Manager.
   */
  async sessionConflict(runId: string, target: Agent): Promise<string | undefined> {
    const rt = this.deps.runtimes.get("claude-session");
    if (!(rt instanceof SessionRuntime)) return undefined;
    const mine = rt.sessionOfRun(runId);
    if (!mine) return undefined;
    const fresh = (await this.deps.registry.get(target.id)) ?? target;
    if ((await this.resolveProviderLive(fresh)).provider !== "claude-session") return undefined;
    if (fresh.session?.id !== mine) return undefined;
    if (rt.spareSlotsBeside(mine, [runId]) > 0) return undefined;
    const name = rt.session(mine)?.name ?? fresh.session.name ?? mine;
    const cap = rt.capacityOf(mine);
    return `${fresh.name} is bound to Claude Code session "${name}", the same session that is running you (the Manager), and that session runs only ${cap} task${cap === 1 ? "" : "s"} at once, all taken by you, so ${fresh.name}'s task could never start while you wait. Ask the user to raise that session's capacity in the office (Sessions panel), to open another Claude Code session for ${fresh.name} (Sessions panel > New session, or run ${WORK_COMMAND} ${fresh.name} in a new session), or to switch ${fresh.name} to "Any free session" or another session, then assign again.`;
  }

  private bridgeToolsFor(task: Task, agent: Agent, runId: string): BridgeTool[] {
    if (agent.role === "manager") {
      return managerTools({
        spaceNames: this.deps.spaceNames,
        renameSpace: this.deps.renameSpace,
        world: this.deps.world,
        registry: this.deps.registry,
        tasks: this.deps.tasks,
        requestTask: task,
        managerId: agent.id,
        knownProjects: () => this.deps.knownProjects(),
        startTask: (id) => this.startTask(id),
        cancelTask: (id) => this.cancel(id),
        awaitTask: (id) => this.awaitTask(id),
        askUser: (t, a, q) => this.askUser(t, a, q),
        setWaiting: (t, w) => this.setWaiting(t, w),
        emitAgent: (a) => this.emitAgent(a),
        checkProvider: (a) => this.providerProblem(a),
        sessionConflict: (a) => this.sessionConflict(runId, a),
        notify: (text) => this.deps.bus.emit({ type: "run.event", taskId: task.id, agentId: agent.id, event: { type: "status", text } }),
        reviveAgent: (agentId, provider, model) => this.reviveAgent(agentId, provider, model),
        addRoom: this.deps.addRoom,
        emitBrainstorm: (ev) => this.deps.bus.emit(ev),
      });
    }
    return task.readOnly ? [] : this.deps.workerTools?.(agent, task) ?? [];
  }

  private async appendLog(taskId: string, ev: RunEvent): Promise<void> {
    const cur = await this.deps.tasks.get(taskId);
    if (!cur) return;
    const last = cur.log[cur.log.length - 1];
    if (ev.type === "text" && last && last.type === "text" && last.text.length < LOG_COALESCE_LIMIT) {
      await this.deps.tasks.replaceLastLog(taskId, { ...last, text: last.text + ev.text });
      return;
    }
    const text =
      ev.type === "text" ? ev.text
      : ev.type === "tool_start" ? `${ev.name} ${JSON.stringify(ev.input).slice(0, 300)}`
      : ev.type === "tool_end" ? `${ev.name} ${ev.ok ? "ok" : "failed"}: ${ev.summary}`
      : ev.type === "file_changed" ? `${ev.kind} ${ev.path}`
      : ev.type === "permission" ? `${ev.tool} needs permission`
      : ev.text;
    await this.deps.tasks.log(taskId, ev.type, text);
  }

  private async finish(task: Task, status: "done" | "failed", patch: { result?: string; error?: string; session?: Task["session"] }): Promise<Task | undefined> {
    const cur = await this.deps.tasks.get(task.id);
    if (!cur || isTerminal(cur.status)) return cur;
    try {
      if (cur.status === "queued") await this.deps.tasks.transition(task.id, "assigned");
      if (cur.status === "queued" || cur.status === "assigned" || cur.status === "waiting") await this.deps.tasks.transition(task.id, "running");
      return await this.deps.tasks.transition(task.id, status, patch);
    } catch {
      return this.deps.tasks.get(task.id);
    }
  }

  private async execute(task: Task): Promise<void> {
    const { tasks, registry, bus } = this.deps;
    const ac = new AbortController();
    this.aborts.set(task.id, ac);
    const runId = newId("r");
    let final: Task | undefined;
    let releaseConvo = () => {};
    let runAgent: Agent | undefined;
    let runProvider: Provider | undefined;
    try {
      const savedAgent = await registry.get(task.assigneeId);
      const agent = savedAgent && task.readOnly ? { ...savedAgent, tools: { edit: false, shell: false, web: false, screenshot: false } } : savedAgent;
      if (!agent) {
        final = await this.finish(task, "failed", { error: `unknown agent ${task.assigneeId}` });
        return;
      }
      runAgent = agent;
      const problem = await this.providerProblem(agent);
      if (problem) {
        final = await this.finish(task, "failed", { error: problem });
        return;
      }
      const { provider, model } = await this.resolveProviderLive(agent);
      runProvider = provider;
      const runtime = this.deps.runtimes.get(provider)!;
      await tasks.transition(task.id, "running");
      const key = this.sessionKey(task, agent);
      // Managers take several requests at once. Only one run may resume a CLI conversation at a time, so a
      // request that starts while another run holds that conversation begins a fresh one instead.
      const convo = `${agent.id}\u0000${key}`;
      const resumeBusy = Boolean(task.readOnly) || this.resuming.has(convo);
      const sessionId = resumeBusy ? undefined : await this.loadSession(agent, key, provider);
      if (!resumeBusy) this.resuming.add(convo);
      releaseConvo = () => {
        if (!resumeBusy) this.resuming.delete(convo);
      };
      const cwd = task.projectPath || process.cwd();
      const bridgeTools = this.bridgeToolsFor(task, agent, runId);
      const { token: bridgeToken } = this.deps.toolRegistry.register(runId, bridgeTools);
      const req: RunRequest = {
        runId,
        taskId: task.id,
        readOnly: task.readOnly,
        agent,
        cwd,
        prompt: await this.buildPrompt(task, agent),
        systemPrompt: task.readOnly ? `You are ${agent.name}, an expert in ${agent.specialty || "general engineering"}. Give your expert view in 5-10 bullet points. Do not edit files or run commands.` : agent.role === "manager" ? MANAGER_SYSTEM_PROMPT : workerSystemPrompt(agent, cwd),
        sessionId,
        tools: agent.tools,
        bridgeTools,
        bridgeToken,
        permissionMode: agent.permissionMode,
        model,
        effort: effectiveEffort(provider, model, agent.effort) ?? undefined,
        onPermission: (p) => this.requestPermission(task.id, agent.id, p),
      };
      let chain = Promise.resolve();
      const sink = (ev: RunEvent) => {
        bus.emit({ type: "run.event", taskId: task.id, agentId: agent.id, event: ev });
        chain = chain.then(() => this.appendLog(task.id, ev)).catch(() => undefined);
      };
      let result;
      try {
        result = await runtime.run(req, sink, ac.signal);
      } finally {
        this.deps.toolRegistry.release(runId);
      }
      await chain;
      const usedSession = result.sessionId ?? sessionId;
      const session = usedSession ? { provider, sessionId: usedSession } : undefined;
      // A side conversation (started while the main one was busy) does not replace the saved main one.
      if (usedSession && !resumeBusy) await this.saveSession(agent, key, provider, usedSession);
      if (result.stopReason === "aborted") {
        final = await tasks.get(task.id);
        if (final && !isTerminal(final.status)) final = await this.finish(task, "failed", { error: "aborted", session });
        return;
      }
      if (result.stopReason === "done") {
        final = await this.finish(task, "done", { result: result.text, session });
        this.deps.usageTracker?.recordSuccess(agent, provider, req.model ?? agent.model ?? "default");
        const liveAgent = await registry.get(agent.id);
        if (liveAgent?.limit?.limited) {
          const cleared = await registry.update(agent.id, { limit: undefined });
          this.emitAgent(cleared);
        }
      } else {
        const errorText = result.error ?? result.stopReason;
        final = await this.finish(task, "failed", { error: errorText, result: result.text || undefined, session });
        if (this.deps.usageTracker) {
          const lim = this.deps.usageTracker.recordFailure(agent, provider, req.model ?? agent.model ?? "default", errorText);
          const updatedAgent = await registry.update(agent.id, { limit: lim });
          this.emitAgent(updatedAgent);
          await this.deps.emitProviders?.();
          // Trigger revive for workers whose provider hit a quota or rate-limit.
          const cls = classifyError(errorText ?? "");
          if (agent.role === "worker" && (cls === "quota" || cls === "rate-limit")) {
            void this.triggerRevive(agent, provider, task.id, errorText ?? "");
          }
        }
      }
      if (result.usage && this.deps.usageTracker) {
        await this.deps.usageTracker.recordRun({
          runId,
          taskId: task.id,
          agentId: agent.id,
          provider,
          model: req.model ?? agent.model ?? "default",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          timestamp: new Date().toISOString(),
        });
      }
      if (result.rateLimits && this.deps.usageTracker) {
        this.deps.usageTracker.recordRateLimits(provider, req.model ?? agent.model ?? "default", result.rateLimits);
      }
    } catch (e) {
      const errorText = (e as Error).message;
      final = await this.finish(task, "failed", { error: errorText });
      if (this.deps.usageTracker && runAgent && runProvider) {
        const lim = this.deps.usageTracker.recordFailure(runAgent, runProvider, runAgent.model ?? "default", errorText);
        const updatedAgent = await registry.update(runAgent.id, { limit: lim });
        this.emitAgent(updatedAgent);
        await this.deps.emitProviders?.();
        const cls = classifyError(errorText ?? "");
        if (runAgent.role === "worker" && (cls === "quota" || cls === "rate-limit")) {
          void this.triggerRevive(runAgent, runProvider, task.id, errorText ?? "");
        }
      }
    } finally {
      releaseConvo();
      this.aborts.delete(task.id);
      this.resolvePendingFor(task.id);
      const settled = final ?? (await tasks.get(task.id));
      if (settled && isTerminal(settled.status)) {
        if (settled.status !== "cancelled") await tasks.awardXp(registry, settled);
        const agent = await registry.get(settled.assigneeId);
        if (agent) this.emitAgent(agent);
        this.settle(settled);
      }
    }
  }
}
