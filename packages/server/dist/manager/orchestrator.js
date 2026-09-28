import { join } from "node:path";
import { z } from "zod";
import { effectiveEffort, isTerminal, newId, ProviderSchema, PROVIDER_ORDER, WORK_COMMAND, FAILOVER_PROVIDER_MODELS, } from "@agenticview/shared";
import { classifyError } from "../runtimes/errors.js";
import { coverInsteadOfRetry } from "../tasks/retryGuard.js";
import { readJsonFile, writeJsonFile } from "../store/jsonStore.js";
import { buildRosterPreamble } from "./preamble.js";
import { SessionRuntime } from "../runtimes/session.js";
import { identityLine, memoryBlock, recordFor } from "../agents/memory.js";
import { MANAGER_SYSTEM_PROMPT, managerTools, workerSystemPrompt } from "./tools.js";
/** Legacy fallback provider order used when failoverOrder is empty. */
const REVIVE_CANDIDATES_FALLBACK = ["claude-session", "antigravity", "codex", "copilot", "gemini", "claude"];
/** Ordered cheapest-first choices for preferCheapModels. */
const CHEAP_CANDIDATES = [
    { provider: "claude-session", model: "sonnet" },
    { provider: "antigravity", model: "gemini-3.8-flash-medium" },
    { provider: "codex", model: "gpt-6-luna" },
];
function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
const SessionFileSchema = z.record(z.string(), z.object({ provider: ProviderSchema, sessionId: z.string() }));
const LOG_COALESCE_LIMIT = 2000;
/** Longest worker result handed to a woken Manager in full. */
const RESULT_CLIP = 1500;
/** Runs tasks on runtimes, keeps the Manager's map truthful, and mediates permissions and questions. */
export class Orchestrator {
    deps;
    aborts = new Map();
    active = new Set();
    /** Agent+conversation keys a run is currently resuming (see execute). */
    resuming = new Set();
    queue = [];
    /** Manager agent id -> the request run holding its main conversation right now. */
    liveRequests = new Map();
    /** Chat messages waiting for a live Manager request run, by task id (see interruptManager). */
    inbox = new Map();
    waiters = new Map();
    pendingPermissions = new Map();
    pendingQuestions = new Map();
    pendingLimits = new Map();
    pumping = false;
    constructor(deps) {
        this.deps = deps;
    }
    running() {
        return this.active.size;
    }
    /**
     * Provider and model for an agent. `auto` is what "Automatic" currently resolves to (see
     * autoProvider()); without it an unset default falls back to Claude.
     */
    resolveProvider(agent, auto) {
        const s = this.deps.settings();
        if (agent.provider) {
            return { provider: agent.provider, model: agent.model ?? s.providerModels[agent.provider] ?? undefined };
        }
        const provider = s.defaultProvider ?? s.globalDefaultProvider ?? auto ?? "claude";
        const model = agent.model ?? s.defaultModel ?? s.globalDefaultModel ?? s.providerModels[provider] ?? undefined;
        return { provider, model: model ?? undefined };
    }
    /** True when no explicit provider applies to this agent, so "Automatic" decides. */
    isAutomatic(agent) {
        const s = this.deps.settings();
        return !agent.provider && !s.defaultProvider && !s.globalDefaultProvider;
    }
    /** Provider order in effect: the user's order, else PROVIDER_ORDER; then any other registered runtime. */
    providerOrder() {
        const base = this.deps.settings().providerOrder ?? PROVIDER_ORDER;
        const out = base.filter((p) => this.deps.runtimes.has(p));
        for (const p of this.deps.runtimes.keys())
            if (!out.includes(p))
                out.push(p);
        return out;
    }
    /** "Automatic": the first provider in the provider order whose check() is ok, or null when none is. */
    async autoProvider() {
        for (const p of this.providerOrder()) {
            const rt = this.deps.runtimes.get(p);
            if (rt && (await rt.check()).ok)
                return p;
        }
        return null;
    }
    /** resolveProvider(), consulting the live provider checks when the agent is on Automatic. */
    async resolveProviderLive(agent) {
        return this.resolveProvider(agent, this.isAutomatic(agent) ? await this.autoProvider() : undefined);
    }
    /** Returns a human-readable problem when the agent's provider cannot run, else undefined. */
    async providerProblem(agent) {
        if (this.isAutomatic(agent) && !(await this.autoProvider())) {
            return "no provider available: set ANTHROPIC_API_KEY, run /agenticview-work in a Claude Code session, or sign in to the codex, copilot (GitHub Copilot), agy (Antigravity) or gemini CLI";
        }
        const { provider } = await this.resolveProviderLive(agent);
        const runtime = this.deps.runtimes.get(provider);
        if (!runtime)
            return `provider ${provider} unavailable: not configured`;
        // Session runs wait in the queue until a worker connects instead of failing.
        if (provider === "claude-session")
            return undefined;
        const status = await runtime.check();
        if (!status.ok)
            return `provider ${provider} unavailable: ${status.reason ?? "unknown reason"}`;
        return undefined;
    }
    emitAgent(agent) {
        this.deps.bus.emit({ type: "agent.updated", agent });
    }
    async handleUserMessage(input) {
        const agent = await this.deps.registry.get(input.agentId);
        if (!agent)
            throw new Error(`Unknown agent ${input.agentId}`);
        const world = this.deps.world;
        let projectPath;
        if (world.kind === "project") {
            projectPath = world.projectPath;
        }
        else if (agent.role === "manager") {
            if (input.projectPath && !this.deps.knownProjects().some((p) => p.path === input.projectPath))
                throw new Error(`${input.projectPath} is not a known project`);
            projectPath = input.projectPath ?? "";
        }
        else {
            if (!input.projectPath)
                throw new Error("projectPath is required to chat with a global agent from the hub");
            if (!this.deps.knownProjects().some((p) => p.path === input.projectPath))
                throw new Error(`${input.projectPath} is not a known project`);
            projectPath = input.projectPath;
        }
        const isManager = agent.role === "manager";
        if (isManager) {
            // The Manager is mid-request: the message joins that run instead of starting a second conversation.
            const live = await this.liveRequest(agent.id, projectPath);
            if (live)
                return this.interruptManager(live, input);
        }
        const task = await this.deps.tasks.create({
            kind: isManager ? "request" : "chat",
            title: input.text.length > 80 ? `${input.text.slice(0, 77)}...` : input.text,
            description: input.followUpOf ? `(Sent while you were finishing request ${input.followUpOf}.)\n\n${input.text}` : input.text,
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
    /** The Manager's request run that holds its main conversation for `projectPath`, if one is live. */
    async liveRequest(agentId, projectPath) {
        const id = this.liveRequests.get(agentId);
        const t = id ? await this.deps.tasks.get(id) : undefined;
        return t && !isTerminal(t.status) && t.projectPath === projectPath ? t : undefined;
    }
    /**
     * A chat message for a Manager that is working. A question it is waiting on takes the message as its
     * answer; otherwise it rides on the run's next tool result (withInbox), so the Manager handles it in
     * context without aborting or re-reading anything. A Manager with no live run (idle, or delegated
     * and waiting for workers) is free: the message starts a request on the same conversation.
     */
    async interruptManager(live, input) {
        await this.deps.tasks.log(live.id, "user", input.text);
        const text = input.images?.length ? `${input.text}\n(Attached images: ${input.images.join(", ")})` : input.text;
        const question = [...this.pendingQuestions.values()].find((q) => q.info.taskId === live.id);
        if (question) {
            this.respondQuestion(question.info.id, text);
            return live;
        }
        this.inbox.set(live.id, [...(this.inbox.get(live.id) ?? []), text]);
        this.deps.bus.emit({ type: "run.event", taskId: live.id, agentId: live.assigneeId, event: { type: "status", text: "Got your message; reading it next" } });
        return live;
    }
    /** Waiting user messages as one block for the Manager, or undefined. Consumes them. */
    takeMessages(taskId) {
        const texts = this.inbox.get(taskId)?.splice(0);
        if (!texts?.length)
            return undefined;
        return [
            `## New message${texts.length > 1 ? "s" : ""} from the user (sent while you were working on this request)`,
            texts.join("\n---\n"),
            "Deal with this first. A progress question: answer in a few lines from what you already know, without extra tool calls. A change or addition: adjust the work in place (cancel_task, assign_task, retry_task), do not restart it. Then carry on; tasks you already started keep running.",
        ].join("\n\n");
    }
    /** Manager tools whose results carry any user message that arrived during the call. */
    withInbox(taskId, tools) {
        return tools.map((t) => ({
            ...t,
            handler: async (args) => {
                const out = await t.handler(args);
                const msgs = this.takeMessages(taskId);
                return msgs ? `${out}\n\n${msgs}` : out;
            },
        }));
    }
    startTask(taskId) {
        void (async () => {
            const cur = await this.deps.tasks.get(taskId);
            if (!cur)
                return;
            if (cur.status === "queued")
                await this.deps.tasks.transition(taskId, "assigned");
            this.queue.push(taskId);
            await this.pump();
        })().catch((e) => console.error("[agenticview] startTask failed", e));
    }
    async pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            let i = 0;
            while (i < this.queue.length) {
                const id = this.queue[i];
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
                if (limited)
                    this.active.add(id);
                void this.execute(task).finally(() => {
                    this.active.delete(id);
                    void this.pump();
                });
            }
        }
        finally {
            this.pumping = false;
        }
    }
    async awaitTask(taskId) {
        const cur = await this.deps.tasks.get(taskId);
        if (!cur)
            throw new Error(`Unknown task ${taskId}`);
        if (isTerminal(cur.status))
            return cur;
        return new Promise((resolve) => {
            const list = this.waiters.get(taskId) ?? [];
            list.push(resolve);
            this.waiters.set(taskId, list);
        });
    }
    settle(task) {
        const list = this.waiters.get(task.id);
        this.waiters.delete(task.id);
        for (const fn of list ?? [])
            fn(task);
        // A finished child may be what its delegated request is waiting for.
        if (task.parentId && !task.meeting)
            this.scheduleWake(task.parentId);
    }
    /** Cancel a task; a request also cancels every non-terminal child it spawned. */
    async cancel(taskId) {
        const cur = await this.deps.tasks.get(taskId);
        if (!cur || isTerminal(cur.status))
            return;
        const idx = this.queue.indexOf(taskId);
        if (idx >= 0)
            this.queue.splice(idx, 1);
        this.aborts.get(taskId)?.abort();
        const next = await this.deps.tasks.transition(taskId, "cancelled");
        this.active.delete(taskId);
        this.resolvePendingFor(taskId);
        this.settle(next);
        if (cur.kind === "request") {
            for (const child of await this.deps.tasks.children(taskId))
                if (!isTerminal(child.status))
                    await this.cancel(child.id);
        }
        void this.pump();
    }
    /** Prompts currently waiting on the user, for snapshots and reconnecting tabs. */
    pending() {
        return {
            permissions: [...this.pendingPermissions.values()].map((p) => p.info),
            questions: [...this.pendingQuestions.values()].map((q) => q.info),
            limits: [...this.pendingLimits.values()].map((l) => l.info),
        };
    }
    respondLimit(id, answer, provider, model) {
        const entry = this.pendingLimits.get(id);
        if (!entry)
            return;
        this.pendingLimits.delete(id);
        this.deps.bus.emit({ type: "limit.resolved", id });
        entry.resolve(answer, provider, model);
    }
    /** The agent's limit was decided elsewhere (the Manager, another answer): close its open Inbox limit items. */
    settleLimitsFor(agentId) {
        for (const [id, entry] of this.pendingLimits) {
            if (entry.info.agentId !== agentId)
                continue;
            this.pendingLimits.delete(id);
            this.deps.bus.emit({ type: "limit.resolved", id });
            entry.resolve("settled");
        }
    }
    /** Returns the cheapest available provider when preferCheapModels is on, or undefined. */
    async cheapProvider() {
        for (const c of CHEAP_CANDIDATES) {
            const rt = this.deps.runtimes.get(c.provider);
            if (!rt)
                continue;
            const lim = this.deps.usageTracker?.getProviderLimit(c.provider);
            if (lim?.limited)
                continue;
            // claude-session is always "available" when configured — it waits for a session to connect.
            if (c.provider !== "claude-session") {
                const status = await rt.check();
                if (!status.ok)
                    continue;
            }
            return c;
        }
        return undefined;
    }
    /**
     * Pick the next provider after `failedProvider` in the configured failoverOrder, skipping
     * providers that have no runtime or are currently limited.  Falls back to
     * REVIVE_CANDIDATES_FALLBACK when failoverOrder is empty.
     */
    pickReviveProvider(failedProvider) {
        const s = this.deps.settings();
        const order = s.failoverOrder.length > 0 ? s.failoverOrder : REVIVE_CANDIDATES_FALLBACK;
        // Find the position of the failed provider in the order (wrap around the list).
        const startIdx = order.indexOf(failedProvider);
        // Build a candidate list that starts at the entry after failedProvider.
        // If failedProvider isn't in the list we try all entries from the beginning.
        const candidates = startIdx >= 0
            ? [...order.slice(startIdx + 1), ...order.slice(0, startIdx)]
            : [...order];
        for (const p of candidates) {
            if (p === failedProvider)
                continue;
            const rt = this.deps.runtimes.get(p);
            if (!rt)
                continue;
            const lim = this.deps.usageTracker?.getProviderLimit(p);
            if (lim?.limited)
                continue;
            // Use per-failover default model, then fall back to the globally configured model.
            const model = FAILOVER_PROVIDER_MODELS[p] ?? s.providerModels[p] ?? undefined;
            return { provider: p, model };
        }
        return undefined;
    }
    /** Trigger the revive state machine for a worker agent after a quota/rate-limit failure. */
    async triggerRevive(agent, failedProvider, failedTaskId, errorText, cause = "limit", managerId) {
        const { registry } = this.deps;
        try {
            const s = this.deps.settings();
            const suggested = this.pickReviveProvider(failedProvider);
            // Scene: a limit makes the agent walk to the Manager's desk and report (a crash faints in the lounge).
            const base = { cause, failedProvider, managerId, suggested, failedTaskId };
            const fainted = await registry.update(agent.id, { revive: { phase: "fainted", ...base } });
            this.emitAgent(fainted);
            const managerDecides = s.limitPolicy === "manager";
            const resetAt = this.deps.usageTracker?.getProviderLimit(failedProvider)?.resetAt ?? agent.limit?.resetAt;
            if ((s.limitPolicy === "auto" || managerDecides) && suggested) {
                // Short delay then switch and retry automatically (only when an alternate provider is available).
                const revivingAgent = await registry.update(agent.id, { revive: { phase: "reviving", ...base, switchTo: { provider: suggested.provider, model: suggested.model ?? null } } });
                this.emitAgent(revivingAgent);
                await delay(this.deps.reviveDelayMs ?? 6000);
                await this.reviveAgent(agent.id, suggested.provider, suggested.model);
                if (managerDecides) {
                    const now = new Date().toISOString();
                    this.addProviderNote(`${agent.name} (${agent.id}) hit ${failedProvider} limit at ${now}, resets ${resetAt ?? "unknown"}; now on ${suggested.provider}/${suggested.model ?? "default"} via failover (task ${failedTaskId} retried). ${this.limitSummary()}`);
                    // Keep an Inbox entry for the user; choosing another provider there switches the agent again.
                    const id = newId("lim");
                    const info = { id, agentId: agent.id, taskId: failedTaskId, suggested, reason: `${errorText} (switched automatically; the Manager reviews the placement)` };
                    this.deps.bus.emit({ type: "limit.request", ...info });
                    this.pendingLimits.set(id, {
                        info,
                        resolve: (answer, provider, model) => {
                            if (answer === "choose" && provider)
                                void this.reviveAgent(agent.id, provider, model);
                        },
                    });
                }
                return;
            }
            if (managerDecides) {
                this.addProviderNote(`${agent.name} (${agent.id}) hit ${failedProvider} limit at ${new Date().toISOString()}, resets ${resetAt ?? "unknown"}; no failover provider available, so the user was asked (task ${failedTaskId}). ${this.limitSummary()}`);
            }
            // No alternate provider available, or limitPolicy === "ask": prompt the user.
            {
                // Ask mode: create a pending limit request that the user resolves.
                const id = newId("lim");
                const info = { id, agentId: agent.id, taskId: failedTaskId, suggested, reason: errorText };
                this.deps.bus.emit({ type: "limit.request", ...info });
                const answer = await new Promise((resolve) => {
                    this.pendingLimits.set(id, { info, resolve: (answer, provider, model) => resolve({ answer, provider, model }) });
                });
                // Settled by the Manager (update_agent + retry_task / revive_agent): nothing left to do here.
                if (answer.answer === "settled")
                    return;
                if (answer.answer === "dismiss") {
                    const cur = await registry.get(agent.id);
                    // Settled elsewhere (the Manager or another Inbox answer revived the agent): leave that state alone.
                    if (cur && cur.revive?.phase !== "done") {
                        const cleared = await registry.update(agent.id, { revive: undefined });
                        this.emitAgent(cleared);
                    }
                    // No automatic retry after all: the failure is the Manager's to handle now.
                    await this.wakeParentOf(failedTaskId);
                    return;
                }
                const chosenProvider = answer.answer === "choose" ? answer.provider : suggested?.provider;
                const chosenModel = answer.answer === "choose" ? answer.model : suggested?.model;
                const cur = await registry.get(agent.id);
                if (!cur)
                    return;
                const revivingAgent = await registry.update(agent.id, { revive: { phase: "reviving", ...base, switchTo: { provider: chosenProvider ?? null, model: chosenModel ?? null } } });
                this.emitAgent(revivingAgent);
                await this.reviveAgent(agent.id, chosenProvider, chosenModel);
            }
        }
        catch (e) {
            console.error("[agenticview] triggerRevive failed", e.message);
        }
    }
    /** Switch agent to a new provider and retry its last failed task. */
    async reviveAgent(agentId, provider, model) {
        const { registry, tasks } = this.deps;
        try {
            const agent = await registry.get(agentId);
            if (!agent)
                return;
            const failedTaskId = agent.revive?.failedTaskId;
            // Any Inbox question still open for this agent is settled by this decision.
            this.settleLimitsFor(agentId);
            // Switch provider. "done" + switchTo: the scene says "Switching to <provider>!" and walks back to the seat.
            const { cause, failedProvider } = agent.revive ?? {};
            const updated = await registry.update(agentId, {
                provider: provider ?? null,
                model: model ?? null,
                limit: undefined,
                revive: { phase: "done", failedTaskId, ...(cause ? { cause } : {}), ...(failedProvider ? { failedProvider } : {}), switchTo: { provider: provider ?? null, model: model ?? null } },
            });
            this.emitAgent(updated);
            // Retry the task, unless its work is already covered (resolved, or a done replacement exists):
            // then it is marked solved instead of re-run.
            if (failedTaskId) {
                const task = await tasks.get(failedTaskId);
                if (task && task.status === "failed" && !(await coverInsteadOfRetry(tasks, failedTaskId))) {
                    await tasks.transition(failedTaskId, "queued", { error: undefined, result: undefined });
                    this.startTask(failedTaskId);
                }
                // Covered instead of re-run, or not retried: its delegated request may be ready now.
                await this.wakeParentOf(failedTaskId);
            }
            // Clear revive state after a brief window so the client can show the "done" phase.
            const clearMs = this.deps.reviveClearMs ?? 5000;
            void delay(clearMs).then(async () => {
                const cur = await registry.get(agentId);
                if (cur?.revive?.phase === "done") {
                    const cleared = await registry.update(agentId, { revive: undefined }).catch(() => undefined);
                    if (cleared)
                        this.emitAgent(cleared);
                }
            }).catch(() => undefined);
        }
        catch (e) {
            console.error("[agenticview] reviveAgent failed", e.message);
        }
    }
    /** A task that ended (or was cancelled) can no longer be waiting on anyone: deny/close its prompts. */
    resolvePendingFor(taskId) {
        for (const [id, p] of this.pendingPermissions)
            if (p.info.taskId === taskId)
                this.respondPermission(id, false);
        for (const [id, q] of this.pendingQuestions)
            if (q.info.taskId === taskId)
                this.respondQuestion(id, "");
    }
    respondPermission(id, allow) {
        const entry = this.pendingPermissions.get(id);
        if (!entry)
            return;
        this.pendingPermissions.delete(id);
        this.deps.bus.emit({ type: "permission.resolved", id });
        entry.resolve(allow);
    }
    respondQuestion(id, answer) {
        const entry = this.pendingQuestions.get(id);
        if (!entry)
            return;
        this.pendingQuestions.delete(id);
        this.deps.bus.emit({ type: "question.resolved", id });
        entry.resolve(answer);
    }
    async setWaiting(taskId, waiting) {
        try {
            const cur = await this.deps.tasks.get(taskId);
            if (!cur)
                return;
            if (waiting && cur.status === "running")
                await this.deps.tasks.transition(taskId, "waiting");
            else if (!waiting && cur.status === "waiting")
                await this.deps.tasks.transition(taskId, "running");
        }
        catch {
            // The task was cancelled or finished meanwhile; nothing to restore.
        }
    }
    async requestPermission(taskId, agentId, req) {
        await this.setWaiting(taskId, true);
        const info = { id: req.id, agentId, taskId, tool: req.tool, input: req.input };
        this.deps.bus.emit({ type: "permission.request", ...info });
        const allow = await new Promise((resolve) => this.pendingPermissions.set(req.id, { info, resolve }));
        await this.setWaiting(taskId, false);
        return allow;
    }
    async askUser(taskId, agentId, question) {
        const id = newId("u");
        await this.setWaiting(taskId, true);
        const info = { id, agentId, taskId, question };
        this.deps.bus.emit({ type: "question.request", ...info });
        const answer = await new Promise((resolve) => this.pendingQuestions.set(id, { info, resolve }));
        await this.setWaiting(taskId, false);
        return answer;
    }
    sessionKey(task, agent) {
        if (agent.role === "manager")
            return this.deps.world.kind === "project" ? this.deps.world.projectPath : "hub";
        return task.projectPath || "hub";
    }
    sessionFile(agentId) {
        return join(this.deps.root, "sessions", `${agentId}.json`);
    }
    async loadSession(agent, key, provider) {
        const file = await readJsonFile(this.sessionFile(agent.id), SessionFileSchema, {});
        const entry = file[key];
        return entry && entry.provider === provider ? entry.sessionId : undefined;
    }
    async saveSession(agent, key, provider, sessionId) {
        const file = await readJsonFile(this.sessionFile(agent.id), SessionFileSchema, {});
        file[key] = { provider, sessionId };
        await writeJsonFile(this.sessionFile(agent.id), file);
    }
    async buildPrompt(task, agent, provider, resumed = false) {
        let text;
        if (task.kind === "request") {
            const all = await this.deps.tasks.list();
            const preamble = buildRosterPreamble(await this.deps.info(), await this.deps.registry.list(), all);
            const target = this.deps.world.kind === "hub" && task.projectPath ? `\n\nTarget project: ${task.projectPath} (pass this as projectPath to assign_task)` : "";
            const notes = this.takeProviderNotes();
            const notesBlock = notes.length ? `\n\n## Provider notes\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
            // The request's own id: tasks assigned now get it as parentId (the closing rule's failed children).
            const self = `\n\nThis request is task ${task.id}; the tasks you assign are its children (parentId ${task.id}).`;
            const kids = all.filter((t) => t.parentId === task.id && !t.meeting);
            // A wake (see checkWake): only the new worker outcomes, plus the request itself when the conversation is not resumed.
            const body = kids.length ? await this.wakeBlock(task, kids, resumed) : `## User request\n${task.description}`;
            text = `${preamble}${target}${notesBlock}${self}\n\n${body}`;
        }
        else {
            const body = task.kind === "work" ? `${task.title}\n\n${task.description}` : task.description;
            if (agent.role === "worker" && provider !== "claude-session") {
                // Identity + memory make a model/provider switch seamless. A claude-session run gets both from the
                // session task itself (formatTask: "You are the office agent ..." and "Your recent work", read
                // from the same memory store in world.ts prepare).
                const parts = [identityLine(agent)];
                if (this.deps.memory) {
                    const block = memoryBlock(await this.deps.memory.recent(this.memoryKey(task), agent.id).catch(() => []), task.id);
                    if (block)
                        parts.push(block);
                }
                parts.push(task.kind === "work" ? `## Task\n${body}` : body);
                text = parts.join("\n\n");
            }
            else {
                text = body;
            }
        }
        return [{ type: "text", text }, ...task.images.map((path) => ({ type: "image", path }))];
    }
    /** The "## Worker results" wake prompt for a request; marks the outcomes it hands over as reported. */
    async wakeBlock(task, kids, resumed) {
        const agents = new Map((await this.deps.registry.list()).map((a) => [a.id, a]));
        const fresh = kids.filter((t) => isTerminal(t.status) && t.finishedAt && task.reported?.[t.id] !== t.finishedAt);
        const open = kids.filter((t) => !isTerminal(t.status));
        const clip = (s) => (s.length > RESULT_CLIP ? `${s.slice(0, RESULT_CLIP)}… (truncated; list_tasks has the rest)` : s);
        const lines = fresh.map((t) => {
            const who = agents.get(t.assigneeId)?.name ?? t.assigneeId;
            const reviving = agents.get(t.assigneeId)?.revive?.failedTaskId === t.id && agents.get(t.assigneeId)?.revive?.phase === "reviving" ? " (switching provider and retrying automatically; no action needed)" : "";
            const out = t.status === "done" ? t.result : (t.error ?? t.result);
            return `- ${t.id} "${t.title}" by ${who}: ${t.status}${t.resolution ? " (resolved)" : ""}${reviving}${out ? `\n  ${clip(out.trim()).replace(/\n/g, "\n  ")}` : ""}`;
        });
        if (fresh.length)
            await this.deps.tasks.markReported(task.id, Object.fromEntries(fresh.map((t) => [t.id, t.finishedAt])));
        const parts = ["## Worker results", lines.join("\n") || "- (nothing new)"];
        if (open.length)
            parts.push(`Still running: ${open.map((t) => `${t.id} "${t.title}"`).join(", ")}. You will be woken again when they finish.`);
        parts.push(resumed ? `Request: "${task.title}".` : `## User request\n${task.description}`);
        parts.push("Next: assign follow-up work if needed, retry_task or resolve_task each failure, then end your turn. When nothing is left open, write the final report for the user.");
        return parts.join("\n\n");
    }
    /**
     * A delegated request's children: still open (a failure being retried automatically counts as open)
     * and not yet reported. Brainstorm (meeting) tasks are left out: the brainstorm tool collects them in the run.
     */
    async delegation(task) {
        const kids = (await this.deps.tasks.children(task.id)).filter((t) => !t.meeting);
        const agents = new Map((await this.deps.registry.list()).map((a) => [a.id, a]));
        // Only a provider switch already under way; a failure waiting on the user's Inbox answer goes to the Manager too.
        const retrying = (t) => t.status === "failed" && agents.get(t.assigneeId)?.revive?.failedTaskId === t.id && agents.get(t.assigneeId)?.revive?.phase === "reviving";
        return {
            open: kids.filter((t) => !isTerminal(t.status) || retrying(t)),
            fresh: kids.filter((t) => isTerminal(t.status) && !retrying(t) && task.reported?.[t.id] !== t.finishedAt),
        };
    }
    wakeTimers = new Map();
    /** Check a delegated request soon; several children finishing together cause one wake. */
    scheduleWake(requestId) {
        if (this.wakeTimers.has(requestId))
            return;
        this.wakeTimers.set(requestId, setTimeout(() => {
            this.wakeTimers.delete(requestId);
            void this.checkWake(requestId).catch((e) => console.error("[agenticview] wake check failed", e.message));
        }, this.deps.wakeDelayMs ?? 400));
    }
    async wakeParentOf(taskId) {
        const t = await this.deps.tasks.get(taskId);
        if (t?.parentId)
            this.scheduleWake(t.parentId);
    }
    /** Check every delegated request (boot, or after a Manager's run freed its conversation). */
    async resumeDelegated(managerId) {
        for (const t of await this.deps.tasks.list()) {
            if (t.kind === "request" && t.status === "delegated" && (!managerId || t.assigneeId === managerId))
                this.scheduleWake(t.id);
        }
    }
    /**
     * Wake a delegated request's Manager once every child is finished, or earlier when one failed and
     * needs a decision. It waits while the Manager has another run live, so one conversation stays one
     * line of thought (execute re-checks when that run ends).
     */
    async checkWake(requestId) {
        const r = await this.deps.tasks.get(requestId);
        if (!r || r.status !== "delegated")
            return;
        if (this.liveRequests.has(r.assigneeId))
            return;
        const { open, fresh } = await this.delegation(r);
        if (!fresh.length) {
            if (open.length)
                return;
            // Nothing left to run or report: the last turn's text is the final report.
            const done = await this.deps.tasks.transition(r.id, "done");
            await this.deps.tasks.awardXp(this.deps.registry, done);
            this.settle(done);
            return;
        }
        if (open.length && !fresh.some((t) => t.status === "failed" && !t.resolution))
            return;
        await this.deps.tasks.transition(r.id, "assigned");
        this.startTask(r.id);
    }
    /** Project path the agent memory of a task is kept under ("" = the world root). */
    memoryKey(task) {
        return task.projectPath || (this.deps.world.kind === "project" ? this.deps.world.projectPath : "");
    }
    /** Append a finished worker task to its agent's memory (any provider). */
    async remember(task, provider, model) {
        if (!this.deps.memory || (task.status !== "done" && task.status !== "failed"))
            return;
        try {
            const agent = await this.deps.registry.get(task.assigneeId);
            if (!agent || agent.role !== "worker")
                return;
            let usedModel = model ?? null;
            if (provider === "claude-session" && task.worker?.sessionId && this.deps.sessions) {
                usedModel = (await this.deps.sessions()).find((s) => s.id === task.worker.sessionId)?.model ?? null;
            }
            const rec = recordFor(task, provider ?? agent.provider, usedModel ?? (provider === "claude-session" ? null : agent.model));
            if (rec)
                await this.deps.memory.append(this.memoryKey(task), agent.id, rec);
        }
        catch (e) {
            console.error("[agenticview] recording agent memory failed", e.message);
        }
    }
    /** "Limits now: codex limited until X; antigravity ok; ..." for the configured providers. */
    limitSummary() {
        const parts = [];
        for (const p of this.providerOrder()) {
            if (!this.deps.runtimes.has(p))
                continue;
            const lim = this.deps.usageTracker?.getProviderLimit(p);
            parts.push(lim?.limited ? `${p} limited${lim.resetAt ? ` until ${lim.resetAt}` : ""}` : `${p} ok`);
        }
        return parts.length ? `Limits now: ${parts.join("; ")}.` : "";
    }
    /** Notes for the Manager's next preamble (limit policy "manager"). */
    providerNotes = [];
    /** Queue a note for the Manager's next request preamble. */
    addProviderNote(note) {
        this.providerNotes.push(note);
        if (this.providerNotes.length > 20)
            this.providerNotes.splice(0, this.providerNotes.length - 20);
    }
    /** Notes waiting for the Manager (read without consuming; for tests and snapshots). */
    peekProviderNotes() {
        return [...this.providerNotes];
    }
    takeProviderNotes() {
        return this.providerNotes.splice(0, this.providerNotes.length);
    }
    /**
     * claude-session deadlock guard for a Manager run `runId`. A session runs several tasks at once (one
     * subagent each), so a worker bound to the Manager's own session is fine as long as that session has
     * a slot the waiting Manager does not occupy. It is a deadlock only when the target's task could be
     * picked up by nothing but that session and every slot of it is held by a waiting Manager.
     */
    async sessionConflict(runId, target) {
        const rt = this.deps.runtimes.get("claude-session");
        if (!(rt instanceof SessionRuntime))
            return undefined;
        const mine = rt.sessionOfRun(runId);
        if (!mine)
            return undefined;
        const fresh = (await this.deps.registry.get(target.id)) ?? target;
        if ((await this.resolveProviderLive(fresh)).provider !== "claude-session")
            return undefined;
        if (fresh.session?.id !== mine)
            return undefined;
        if (rt.spareSlotsBeside(mine, [runId]) > 0)
            return undefined;
        const name = rt.session(mine)?.name ?? fresh.session.name ?? mine;
        const cap = rt.capacityOf(mine);
        return `${fresh.name} is bound to Claude Code session "${name}", the same session that is running you (the Manager), and that session runs only ${cap} task${cap === 1 ? "" : "s"} at once, all taken by you, so ${fresh.name}'s task could never start while you wait. Ask the user to raise that session's capacity in the office (Sessions panel), to open another Claude Code session for ${fresh.name} (Sessions panel > New session, or run ${WORK_COMMAND} ${fresh.name} in a new session), or to switch ${fresh.name} to "Any free session" or another session, then assign again.`;
    }
    bridgeToolsFor(task, agent, runId) {
        if (agent.role === "manager") {
            return this.withInbox(task.id, managerTools({
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
                cheapProvider: this.deps.settings().preferCheapModels ? () => this.cheapProvider() : undefined,
                addRoom: this.deps.addRoom,
                removeRoom: this.deps.removeRoom,
                layout: this.deps.layout,
                updateLayout: this.deps.updateLayout,
                editLayout: this.deps.editLayout,
                spaces: this.deps.spaces,
                emitBrainstorm: (ev) => this.deps.bus.emit(ev),
                sessions: this.deps.sessions,
                providerOf: async (a) => (await this.resolveProviderLive(a)).provider,
            }));
        }
        return task.readOnly ? [] : this.deps.workerTools?.(agent, task) ?? [];
    }
    async appendLog(taskId, ev) {
        const cur = await this.deps.tasks.get(taskId);
        if (!cur)
            return;
        const last = cur.log[cur.log.length - 1];
        if (ev.type === "text" && last && last.type === "text" && last.text.length < LOG_COALESCE_LIMIT) {
            await this.deps.tasks.replaceLastLog(taskId, { ...last, text: last.text + ev.text });
            return;
        }
        const text = ev.type === "text" ? ev.text
            : ev.type === "tool_start" ? `${ev.name} ${JSON.stringify(ev.input).slice(0, 300)}`
                : ev.type === "tool_end" ? `${ev.name} ${ev.ok ? "ok" : "failed"}: ${ev.summary}`
                    : ev.type === "file_changed" ? `${ev.kind} ${ev.path}`
                        : ev.type === "permission" ? `${ev.tool} needs permission`
                            : ev.text;
        await this.deps.tasks.log(taskId, ev.type, text);
    }
    async finish(task, status, patch) {
        const cur = await this.deps.tasks.get(task.id);
        if (!cur || isTerminal(cur.status))
            return cur;
        try {
            if (cur.status === "queued")
                await this.deps.tasks.transition(task.id, "assigned");
            if (cur.status === "queued" || cur.status === "assigned" || cur.status === "waiting")
                await this.deps.tasks.transition(task.id, "running");
            return await this.deps.tasks.transition(task.id, status, patch);
        }
        catch {
            return this.deps.tasks.get(task.id);
        }
    }
    /** running -> delegated; the wake check then runs once the run has released the conversation. */
    async delegate(task, patch) {
        try {
            const cur = await this.deps.tasks.get(task.id);
            if (!cur || isTerminal(cur.status))
                return cur;
            if (cur.status === "waiting")
                await this.deps.tasks.transition(task.id, "running");
            return await this.deps.tasks.transition(task.id, "delegated", patch);
        }
        catch {
            return this.deps.tasks.get(task.id);
        }
    }
    async execute(task) {
        const { tasks, registry, bus } = this.deps;
        const ac = new AbortController();
        this.aborts.set(task.id, ac);
        const runId = newId("r");
        let final;
        let releaseConvo = () => { };
        let runAgent;
        let runProvider;
        let runModelName;
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
            const resolved = await this.resolveProviderLive(agent);
            const provider = resolved.provider;
            runProvider = provider;
            // Per-task tier (assign_task model/effort) applies only while the agent is still on the provider it was chosen for.
            const tier = task.tier && task.tier.provider === provider ? task.tier : undefined;
            // A claude-session agent inherits model and effort from the session that serves it.
            const model = provider === "claude-session" ? undefined : (tier?.model ?? resolved.model);
            runModelName = model;
            const runEffort = provider === "claude-session" ? undefined : (tier?.effort ?? agent.effort);
            const runtime = this.deps.runtimes.get(provider);
            await tasks.transition(task.id, "running");
            const key = this.sessionKey(task, agent);
            // Managers take several requests at once. Only one run may resume a CLI conversation at a time, so a
            // request that starts while another run holds that conversation begins a fresh one instead.
            const convo = `${agent.id}\u0000${key}`;
            const resumeBusy = Boolean(task.readOnly) || this.resuming.has(convo);
            const sessionId = resumeBusy ? undefined : await this.loadSession(agent, key, provider);
            if (!resumeBusy)
                this.resuming.add(convo);
            releaseConvo = () => {
                if (!resumeBusy)
                    this.resuming.delete(convo);
            };
            // The run on the main conversation receives the user's further chat messages while it works.
            if (agent.role === "manager" && task.kind === "request" && !resumeBusy)
                this.liveRequests.set(agent.id, task.id);
            const cwd = task.projectPath || process.cwd();
            const bridgeTools = this.bridgeToolsFor(task, agent, runId);
            const { token: bridgeToken } = this.deps.toolRegistry.register(runId, bridgeTools);
            const req = {
                runId,
                taskId: task.id,
                readOnly: task.readOnly,
                agent,
                cwd,
                prompt: await this.buildPrompt((await tasks.get(task.id)) ?? task, agent, provider, Boolean(sessionId)),
                systemPrompt: task.readOnly ? `You are ${agent.name}, an expert in ${agent.specialty || "general engineering"}. Give your expert view in 5-10 bullet points. Do not edit files or run commands.` : agent.role === "manager" ? MANAGER_SYSTEM_PROMPT : workerSystemPrompt(agent, cwd),
                sessionId,
                tools: agent.tools,
                bridgeTools,
                bridgeToken,
                permissionMode: agent.permissionMode,
                model,
                effort: effectiveEffort(provider, model, runEffort) ?? undefined,
                onPermission: (p) => this.requestPermission(task.id, agent.id, p),
            };
            let chain = Promise.resolve();
            const sink = (ev) => {
                bus.emit({ type: "run.event", taskId: task.id, agentId: agent.id, event: ev });
                chain = chain.then(() => this.appendLog(task.id, ev)).catch(() => undefined);
            };
            let result;
            try {
                result = await runtime.run(req, sink, ac.signal);
            }
            finally {
                this.deps.toolRegistry.release(runId);
            }
            await chain;
            const usedSession = result.sessionId ?? sessionId;
            const session = usedSession ? { provider, sessionId: usedSession } : undefined;
            // A side conversation (started while the main one was busy) does not replace the saved main one.
            if (usedSession && !resumeBusy)
                await this.saveSession(agent, key, provider, usedSession);
            if (result.stopReason === "aborted") {
                final = await tasks.get(task.id);
                if (final && !isTerminal(final.status))
                    final = await this.finish(task, "failed", { error: "aborted", session });
                return;
            }
            if (result.stopReason === "done") {
                // A Manager turn that handed out work ends here: the request waits for the workers without a live run.
                const delegating = agent.role === "manager" && task.kind === "request" && !task.readOnly;
                const pending = delegating ? await this.delegation((await tasks.get(task.id)) ?? task) : undefined;
                if (pending && (pending.open.length || pending.fresh.length)) {
                    final = await this.delegate(task, { result: result.text, session });
                }
                else {
                    final = await this.finish(task, "done", { result: result.text, session });
                }
                this.deps.usageTracker?.recordSuccess(agent, provider, req.model ?? agent.model ?? "default");
                const liveAgent = await registry.get(agent.id);
                if (liveAgent?.limit?.limited) {
                    const cleared = await registry.update(agent.id, { limit: undefined });
                    this.emitAgent(cleared);
                }
            }
            else {
                const errorText = result.error ?? result.stopReason;
                final = await this.finish(task, "failed", { error: errorText, result: result.text || undefined, session });
                if (this.deps.usageTracker) {
                    const lim = this.deps.usageTracker.recordFailure(agent, provider, req.model ?? agent.model ?? "default", errorText);
                    if (lim) {
                        const updatedAgent = await registry.update(agent.id, { limit: lim });
                        this.emitAgent(updatedAgent);
                        await this.deps.emitProviders?.();
                    }
                    // Trigger revive for workers whose provider hit a quota, rate-limit, or crash.
                    const cls = classifyError(errorText ?? "");
                    if (agent.role === "worker" && (cls === "quota" || cls === "rate-limit" || cls === "crash")) {
                        void this.triggerRevive(agent, provider, task.id, errorText ?? "", cls === "crash" ? "crash" : "limit");
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
        }
        catch (e) {
            const errorText = e.message;
            final = await this.finish(task, "failed", { error: errorText });
            if (this.deps.usageTracker && runAgent && runProvider) {
                const lim = this.deps.usageTracker.recordFailure(runAgent, runProvider, runAgent.model ?? "default", errorText);
                if (lim) {
                    const updatedAgent = await registry.update(runAgent.id, { limit: lim });
                    this.emitAgent(updatedAgent);
                    await this.deps.emitProviders?.();
                }
                const cls = classifyError(errorText ?? "");
                if (runAgent.role === "worker" && (cls === "quota" || cls === "rate-limit" || cls === "crash")) {
                    void this.triggerRevive(runAgent, runProvider, task.id, errorText ?? "", cls === "crash" ? "crash" : "limit");
                }
            }
        }
        finally {
            releaseConvo();
            let unread = [];
            if (runAgent && this.liveRequests.get(runAgent.id) === task.id) {
                this.liveRequests.delete(runAgent.id);
                unread = this.inbox.get(task.id) ?? [];
            }
            this.inbox.delete(task.id);
            this.aborts.delete(task.id);
            this.resolvePendingFor(task.id);
            const settled = final ?? (await tasks.get(task.id));
            if (settled && isTerminal(settled.status)) {
                if (settled.status !== "cancelled")
                    await tasks.awardXp(registry, settled);
                await this.remember(settled, runProvider, runModelName);
                const agent = await registry.get(settled.assigneeId);
                if (agent)
                    this.emitAgent(agent);
                this.settle(settled);
            }
            // Messages the run ended before reading: one follow-up request, resuming the same conversation.
            if (unread.length && runAgent) {
                void this.handleUserMessage({ agentId: runAgent.id, text: unread.join("\n\n"), projectPath: task.projectPath || undefined, followUpOf: task.id })
                    .catch((e) => console.error("[agenticview] follow-up request failed", e.message));
            }
            // The Manager's conversation is free again: its delegated requests (this one included) may wake.
            if (runAgent?.role === "manager")
                void this.resumeDelegated(runAgent.id);
        }
    }
}
//# sourceMappingURL=orchestrator.js.map