import { z } from "zod";
import { EffortSchema, MODEL_CATALOGUE, effortsFor, findModel, isTerminal, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema, } from "@agenticview/shared";
import { brainstormTool } from "./brainstorm.js";
import { officeTools } from "./officeTools.js";
export const MANAGER_SYSTEM_PROMPT = `You are the Manager of an AgenticView office: a team of AI coding agents ("workers") that edit a real software project.

Rules:
- The "Roster" and "Open tasks" preamble at the top of each message is authoritative and freshly generated. Trust it over memory. Call list_agents or list_tasks if you need to re-check.
- Understand the request first. Read the project (you have read-only file tools) when a decision depends on the code.
- Prefer existing workers whose specialty fits. Create a new worker with create_agent only when nobody on the roster fits. When preferCheapModels is on (the default), create_agent without an explicit provider/model automatically picks the cheapest available provider — the result will tell you which one was chosen. Use update_agent to change them later if needed.
- Split work into self-contained assignments. Each assign_task description must stand alone: what to change, where (files or folders), how to verify. Never assign the same file to two workers at once.
- assign_task returns immediately. Call await_tasks with every task id you started before you report. Workers may fail; read their result and decide whether to reassign, retry with a clearer description, or report the failure.
- When a task fails and a later task (by you or another worker) completes the same work, call resolve_task with the failing task id and the succeeding task id. This marks the failure as solved in the history without changing its status. If no retry is possible and the failure is acceptable, call resolve_task with just a note.
- Use ask_user only when a decision truly needs the user.
- The office is a honeycomb of rooms. list_spaces shows who sits where; move_worker / arrange_workers reseat workers (group a team in one pod, call people to the meeting room) when the user asks or when it clearly helps.
- Group agents by role and name their rooms with rename_space. Move collaborators next to each other while they work on the same task.
- Use brainstorm for design questions that need several experts; repeat the same topic after stillRunning until the summary is ready.
- Claude Code session agents (provider claude-session) run on the model and effort of the session that serves them; you cannot set a model for them. The user usually keeps one Opus session and one Sonnet session open. Call list_sessions to see each session's model, capacity, load and bound agents, then route with assign_session before assign_task: hard, architectural or cross-cutting work goes to the strongest-model session (e.g. Opus); routine edits, tests and docs go to Sonnet sessions. Balance load across online sessions with free slots, and never leave a task waiting on a full or offline session while another suitable session has a free slot (move the agent with assign_session, or "any").
- Model tiers for codex, copilot, antigravity and gemini agents: assign_task takes optional model and effort for that task only. Default to the cheap tier (codex gpt-6-luna with effort medium; copilot auto; antigravity gemini-3.8-flash-medium; gemini flash). Step up to the strong tier (codex gpt-6-sol; copilot gpt-5.6-sol or claude-opus-5; antigravity gemini-3.8-flash-high or gemini-3.1-pro-high; gemini pro) only for genuinely hard tasks (tricky debugging, architecture, large refactors, subtle concurrency or security work), and say why in the task description.
- Workers keep a memory of their recent tasks that survives provider and model switches, so a task retried on another provider continues where it left off; you do not need to repeat earlier context.
- "## Provider notes" in the preamble report agents that hit a provider limit and were failed over automatically. Review each with proper analysis: how hard the task is, what limits remain (usage/limit status), and which provider/model/session fits. Then place the agent well with update_agent, assign_session or a per-task model, and retry the failed task with retry_task if it still needs doing (or it was already retried by the failover: then leave it running unless the placement is clearly wrong).
- You never edit files yourself.
- End with a short report for the user: what was done, by whom, and anything left open.`;
export function workerSystemPrompt(agent, projectPath) {
    return [
        `You are ${agent.name}, a ${agent.specialty || "generalist"} engineer on an AgenticView team.`,
        `You are working inside the project at ${projectPath}. Only change files under that path.`,
        "Make the requested change, run the relevant tests or checks when they exist, and finish with a two-sentence summary of what you changed and how you verified it.",
        // Commits land in the user's repository under the user's name, whatever tool the agent runs in.
        "If you commit, write plain commit messages: never add Co-Authored-By, \"Generated with\" or any other AI attribution lines, and never change git config or the author.",
        agent.description ? `About you: ${agent.description}` : "",
        agent.systemPrompt,
    ]
        .filter(Boolean)
        .join("\n\n");
}
const MODEL_HINT = "Model id or alias for the agent's provider, e.g. claude: opus | sonnet | haiku | fable; codex: gpt-6-sol; copilot: auto (Copilot routes per request) | gpt-5.6-sol | claude-sonnet-5 | claude-opus-5 (availability depends on the user's Copilot plan); antigravity: gemini-3.8-flash-high | gemini-3.1-pro-high | claude-sonnet-4-6 | claude-opus-4-6-thinking (run `agy models`); gemini: pro | flash. Omit for the provider default.";
const EFFORT_HINT = "Reasoning effort: low | medium | high (claude also xhigh | max; codex also xhigh | max | ultra on supporting models; copilot also minimal | xhigh | max, ignored for copilot model auto; antigravity also max, ignored for its -high/-medium/-low model ids; ignored for gemini). Omit for the default.";
function agentLine(a, tasks, sessions = []) {
    const active = tasks.find((t) => t.assigneeId === a.id && (t.status === "running" || t.status === "waiting"));
    const base = { id: a.id, name: a.name, scope: a.scope, specialty: a.specialty, provider: a.provider ?? "default" };
    const tail = { level: a.stats.level, tasksDone: a.stats.tasksDone, state: active ? `running ${active.id}` : "idle" };
    if (a.provider === "claude-session") {
        const s = a.session?.id ? sessions.find((x) => x.id === a.session.id) : undefined;
        return {
            ...base,
            // Model and effort come from the serving session.
            model: s?.model ? `session: ${s.model}` : "session's own model",
            session: a.session ? { id: a.session.id, name: s?.name ?? a.session.name ?? a.session.id, online: s?.online ?? false } : "any free session",
            ...tail,
        };
    }
    return { ...base, model: a.model ?? "default", effort: a.effort ?? "default", ...tail };
}
/** One session as list_sessions reports it. */
export function sessionLine(s, agents) {
    const load = s.runs?.length ?? 0;
    return {
        id: s.id,
        name: s.name,
        model: s.model ?? "unknown",
        online: s.online,
        capacity: s.capacity,
        load,
        freeSlots: Math.max(0, s.capacity - load),
        boundAgents: agents.filter((a) => a.session?.id === s.id).map((a) => ({ id: a.id, name: a.name })),
    };
}
/** Find a session by id or (case-insensitive) name. */
function findSession(sessions, ref) {
    const k = ref.trim().toLowerCase();
    return sessions.find((s) => s.id === ref.trim()) ?? sessions.find((s) => s.name.toLowerCase() === k);
}
/** Find an agent by id or (case-insensitive) name. */
async function findAgent(ctx, ref) {
    const direct = await ctx.registry.get(ref.trim());
    if (direct)
        return direct;
    const k = ref.trim().toLowerCase();
    return (await ctx.registry.list()).find((a) => a.name.toLowerCase() === k);
}
const SESSION_INHERITS = "model/effort ignored: Claude Code session agents run on the model and effort of the session that serves them (use assign_session to pick the session)";
/** Validate a per-task model tier for a provider. */
export function validateTier(provider, agent, model, effort) {
    if (model === undefined && effort === undefined)
        return { ok: true, note: "" };
    if (provider === "claude-session")
        return { ok: true, note: ` (${SESSION_INHERITS})` };
    const cat = MODEL_CATALOGUE[provider];
    if (model !== undefined && !findModel(provider, model)) {
        return { ok: false, error: `ERROR: model "${model}" is not in the ${provider} catalogue. Valid: ${cat.models.map((m) => m.id).join(", ")}` };
    }
    let note = "";
    let useEffort = effort;
    if (effort !== undefined) {
        const allowed = effortsFor(provider, model ?? agent.model);
        if (allowed.length === 0) {
            note = ` (effort ignored: ${model ?? agent.model ?? provider} has no effort control)`;
            useEffort = undefined;
        }
        else if (!allowed.includes(effort)) {
            return { ok: false, error: `ERROR: effort "${effort}" is not accepted by ${provider}/${model ?? agent.model ?? "default"}. Valid: ${allowed.join(", ")}` };
        }
    }
    const tier = { provider, ...(model !== undefined ? { model } : {}), ...(useEffort !== undefined ? { effort: useEffort } : {}) };
    return { ok: true, tier, note: `${note} [this task runs on ${provider}/${model ?? agent.model ?? "default"}${useEffort ? ` effort ${useEffort}` : ""}]` };
}
/** Resolve the target project for an assignment, or return an error string. */
export function resolveAssignmentTarget(ctx, agent, projectPath) {
    if (ctx.world.kind === "project") {
        const target = projectPath ?? ctx.world.projectPath;
        if (agent.scope === "project" && target !== ctx.world.projectPath) {
            return { ok: false, error: `ERROR: scope: ${agent.name} is a project agent and can only work in ${ctx.world.projectPath}` };
        }
        if (target !== ctx.world.projectPath && !ctx.knownProjects().some((p) => p.path === target)) {
            return { ok: false, error: `ERROR: scope: ${target} is not a known project` };
        }
        return { ok: true, projectPath: target };
    }
    if (!projectPath)
        return { ok: false, error: "ERROR: scope: projectPath is required in the hub; pick one of the known projects" };
    if (!ctx.knownProjects().some((p) => p.path === projectPath)) {
        return { ok: false, error: `ERROR: scope: ${projectPath} is not a known project (open it once with /agenticview first)` };
    }
    if (agent.scope !== "global")
        return { ok: false, error: `ERROR: scope: ${agent.name} is not a global agent` };
    return { ok: true, projectPath };
}
export function managerTools(ctx) {
    return [
        {
            name: "list_agents",
            description: "List every agent on the roster with scope, specialty, provider, model, level and current state. Claude Code session agents also show their session (and its model).",
            schema: {},
            handler: async () => {
                const sessions = (await ctx.sessions?.()) ?? [];
                const tasks = await ctx.tasks.list();
                return JSON.stringify((await ctx.registry.list()).filter((a) => a.role === "worker").map((a) => agentLine(a, tasks, sessions)), null, 2);
            },
        },
        {
            name: "list_sessions",
            description: "List the user's Claude Code sessions (provider claude-session): each session's id, name, reported model (e.g. Opus or Sonnet), online state, capacity, current load, free slots and the agents bound to it.",
            schema: {},
            handler: async () => {
                const sessions = (await ctx.sessions?.()) ?? [];
                if (sessions.length === 0)
                    return "No Claude Code sessions known. The user opens one with /agenticview-work.";
                const agents = await ctx.registry.list();
                return JSON.stringify(sessions.map((s) => sessionLine(s, agents)), null, 2);
            },
        },
        {
            name: "assign_session",
            description: 'Bind a Claude Code session agent to a session (it then runs on that session\'s model), or pass session "any" to let any free session take it. Queued tasks of the agent are re-dispatched at once; a task already running stays where it is.',
            schema: {
                agent: z.string().min(1).describe("Agent id or name"),
                session: z.string().min(1).describe('Session id or name (see list_sessions), or "any" to unbind'),
            },
            handler: async (args) => {
                const agent = await findAgent(ctx, String(args.agent));
                if (!agent)
                    return `ERROR: unknown agent ${String(args.agent)}`;
                if (agent.role !== "worker")
                    return "ERROR: only workers can be assigned to a session";
                const provider = ctx.providerOf ? await ctx.providerOf(agent) : agent.provider;
                if (provider !== "claude-session")
                    return `ERROR: ${agent.name} runs on ${provider ?? "the default provider"}, not a Claude Code session. Use update_agent to switch it to claude-session first.`;
                const ref = String(args.session).trim();
                const sessions = (await ctx.sessions?.()) ?? [];
                let binding = null;
                let s;
                if (ref.toLowerCase() !== "any") {
                    s = findSession(sessions, ref);
                    if (!s)
                        return `ERROR: unknown session "${ref}". Known: ${sessions.map((x) => `${x.name} (${x.id})`).join(", ") || "none"}`;
                    binding = { id: s.id, name: s.name };
                }
                const next = await ctx.registry.update(agent.id, { session: binding });
                // agent.updated re-runs session dispatch, so queued runs go to the new session at once.
                ctx.emitAgent(next);
                const queued = (await ctx.tasks.list()).filter((t) => t.assigneeId === agent.id && !isTerminal(t.status));
                const where = s ? `session "${s.name}" (model ${s.model ?? "unknown"}, ${s.online ? "online" : "OFFLINE"}, ${Math.max(0, s.capacity - (s.runs?.length ?? 0))}/${s.capacity} slots free)` : "any free session";
                const running = queued.filter((t) => t.status === "running" || t.status === "waiting").length;
                return `${agent.name} now runs on ${where}. ${queued.length - running} queued task(s) re-dispatched${running ? `; ${running} running task(s) finish where they started` : ""}.`;
            },
        },
        {
            name: "list_tasks",
            description: "List open (non-terminal) tasks with status, assignee and parent. Resolved failures are hidden by default; pass includeDone to see them.",
            schema: { includeDone: z.boolean().optional().describe("Also include finished tasks (done, failed, cancelled); resolved failures are included when true") },
            handler: async (args) => {
                const all = await ctx.tasks.list();
                // Resolved failures are terminal (failed status) and are hidden in the default view,
                // just like other terminal tasks.  They appear when includeDone=true.
                const rows = all.filter((t) => args.includeDone === true || !isTerminal(t.status));
                return JSON.stringify(rows.map((t) => ({ id: t.id, kind: t.kind, title: t.title, status: t.status, assigneeId: t.assigneeId, parentId: t.parentId, projectPath: t.projectPath, result: t.result?.slice(0, 300), error: t.error, resolution: t.resolution })), null, 2);
            },
        },
        {
            name: "create_agent",
            description: "Create a new worker agent on this world's roster. Give it a short name and a specialty such as 'frontend (React, CSS)' or 'tests (vitest)'.",
            schema: {
                name: z.string().min(1).max(40),
                specialty: z.string().max(120),
                description: z.string().max(2000).optional(),
                provider: ProviderSchema.optional().describe("claude (API key), claude-session (a Claude Code session running /agenticview-work), codex, copilot (the GitHub Copilot CLI), antigravity (the Antigravity CLI, agy) or gemini; omit to use the world default"),
                model: z.string().optional().describe(MODEL_HINT),
                effort: EffortSchema.optional().describe(EFFORT_HINT),
                systemPrompt: z.string().max(20000).optional(),
                tools: ToolAllowanceSchema.optional(),
                permissionMode: PermissionModeSchema.optional(),
            },
            handler: async (args) => {
                const explicitProvider = args.provider;
                const explicitModel = args.model;
                let chosenProvider = explicitProvider ?? null;
                let chosenModel = explicitModel ?? null;
                let cheapNote = "";
                // When no explicit provider/model supplied, pick the cheapest available if the setting is on.
                if (explicitProvider == null && explicitModel == null && ctx.cheapProvider) {
                    const cheap = await ctx.cheapProvider();
                    if (cheap) {
                        chosenProvider = cheap.provider;
                        chosenModel = cheap.model;
                        cheapNote = ` [preferCheapModels: assigned ${cheap.provider}/${cheap.model}]`;
                    }
                }
                let effortOut = args.effort ?? null;
                if (chosenProvider === "claude-session") {
                    if (explicitModel != null || args.effort != null)
                        cheapNote += ` (${SESSION_INHERITS})`;
                    chosenModel = null;
                    effortOut = null;
                }
                const draft = { name: String(args.name), specialty: String(args.specialty ?? ""), description: args.description, provider: chosenProvider, model: chosenModel, effort: effortOut, systemPrompt: args.systemPrompt, tools: args.tools, permissionMode: args.permissionMode };
                const agent = await ctx.registry.create(draft);
                const problem = await ctx.checkProvider(agent);
                if (problem) {
                    await ctx.registry.remove(agent.id);
                    return `ERROR: ${problem}`;
                }
                ctx.emitAgent(agent);
                return `Created agent ${agent.id} "${agent.name}" (${agent.scope}, ${agent.specialty || "generalist"})${cheapNote}`;
            },
        },
        {
            name: "update_agent",
            description: "Change a worker's model, reasoning effort, provider, specialty or instructions. Pass null for model/effort to go back to the provider default.",
            schema: {
                agentId: z.string(),
                provider: ProviderSchema.nullable().optional().describe("claude, claude-session, codex, copilot, antigravity or gemini; null for the world default"),
                model: z.string().nullable().optional().describe(MODEL_HINT),
                effort: EffortSchema.nullable().optional().describe(EFFORT_HINT),
                specialty: z.string().max(120).optional(),
                description: z.string().max(2000).optional(),
                systemPrompt: z.string().max(20000).optional(),
            },
            handler: async (args) => {
                const cur = await ctx.registry.get(String(args.agentId));
                if (!cur)
                    return `ERROR: unknown agent ${String(args.agentId)}`;
                if (cur.role !== "worker")
                    return "ERROR: only workers can be updated";
                const patch = {};
                for (const k of ["provider", "model", "effort", "specialty", "description", "systemPrompt"]) {
                    if (args[k] !== undefined)
                        patch[k] = args[k];
                }
                const next = await ctx.registry.update(cur.id, patch);
                const problem = await ctx.checkProvider(next);
                if (problem) {
                    await ctx.registry.update(cur.id, cur);
                    return `ERROR: ${problem}`;
                }
                ctx.emitAgent(next);
                if (next.provider === "claude-session") {
                    const ignored = (args.model != null || args.effort != null) ? ` (${SESSION_INHERITS})` : "";
                    return `Updated agent ${next.id} "${next.name}" (provider claude-session, model and effort from its session ${next.session?.name ?? "(any free session)"})${ignored}`;
                }
                return `Updated agent ${next.id} "${next.name}" (provider ${next.provider ?? "default"}, model ${next.model ?? "default"}, effort ${next.effort ?? "default"})`;
            },
        },
        {
            name: "assign_task",
            description: "Create a work task for a worker and start it immediately. Returns the task id; call await_tasks to collect the result.",
            schema: {
                agentId: z.string(),
                title: z.string().min(1).max(120),
                description: z.string().min(1).describe("Self-contained instructions: what, where, how to verify"),
                projectPath: z.string().optional().describe("Target project path (hub only, or a global agent working in another known project)"),
                model: z.string().optional().describe("Per-task model tier for THIS task only (codex: gpt-6-luna cheap | gpt-6-sol strong; copilot: auto cheap | gpt-5.6-sol / claude-opus-5 strong; antigravity: gemini-3.8-flash-medium cheap | gemini-3.8-flash-high / gemini-3.1-pro-high strong; gemini: flash cheap | pro strong). Ignored for claude-session agents."),
                effort: EffortSchema.optional().describe("Per-task reasoning effort for THIS task only (validated for the model). Ignored for claude-session agents."),
            },
            handler: async (args) => {
                const agent = await ctx.registry.get(String(args.agentId));
                if (!agent)
                    return `ERROR: unknown agent ${String(args.agentId)}`;
                if (agent.role !== "worker")
                    return "ERROR: tasks can only be assigned to workers";
                const target = resolveAssignmentTarget(ctx, agent, args.projectPath);
                if (!target.ok)
                    return target.error;
                const problem = await ctx.checkProvider(agent);
                if (problem)
                    return `ERROR: ${problem}`;
                const provider = ctx.providerOf ? await ctx.providerOf(agent) : (agent.provider ?? "claude");
                const tier = validateTier(provider, agent, args.model, args.effort);
                if (!tier.ok)
                    return tier.error;
                const conflict = await ctx.sessionConflict?.(agent);
                if (conflict) {
                    ctx.notify?.(conflict);
                    return `ERROR: ${conflict}`;
                }
                const task = await ctx.tasks.create({
                    kind: "work",
                    title: String(args.title),
                    description: String(args.description),
                    createdBy: ctx.managerId,
                    assigneeId: agent.id,
                    projectPath: target.projectPath,
                    parentId: ctx.requestTask.id,
                    ...(tier.tier ? { tier: tier.tier } : {}),
                });
                ctx.startTask(task.id);
                return `Started task ${task.id} for ${agent.name}${tier.note}`;
            },
        },
        {
            name: "await_tasks",
            description: "Block until every listed task is finished, then return each task's status and result or error. With maxWaitSeconds, returns early with the tasks still running; call it again with those ids.",
            schema: {
                taskIds: z.array(z.string()).min(1),
                maxWaitSeconds: z.number().int().min(1).max(86_400).optional().describe("Return after this long even if tasks are still running (default: wait until all finish)"),
            },
            handler: async (args) => {
                const ids = args.taskIds;
                if (ctx.sessionConflict) {
                    const blocked = [];
                    for (const id of ids) {
                        const t = await ctx.tasks.get(id);
                        if (!t || isTerminal(t.status))
                            continue;
                        const a = await ctx.registry.get(t.assigneeId);
                        const conflict = a && (await ctx.sessionConflict(a));
                        if (conflict)
                            blocked.push(`${id}: ${conflict}`);
                    }
                    if (blocked.length) {
                        ctx.notify?.(blocked.join("\n"));
                        return `ERROR: waiting would deadlock.\n${blocked.join("\n")}`;
                    }
                }
                const line = (t) => ({ id: t.id, title: t.title, status: t.status, result: t.result, error: t.error });
                const maxMs = typeof args.maxWaitSeconds === "number" ? args.maxWaitSeconds * 1000 : undefined;
                // A Manager waiting on its own workers is still working: the request stays "running". Only a
                // question or permission for the user moves it to "waiting" (shown as "Waiting on you").
                {
                    const all = Promise.all(ids.map((id) => ctx.awaitTask(id)));
                    if (maxMs === undefined)
                        return JSON.stringify((await all).map(line), null, 2);
                    let timer;
                    const timedOut = new Promise((r) => (timer = setTimeout(() => r(null), maxMs)));
                    const results = await Promise.race([all, timedOut]);
                    clearTimeout(timer);
                    if (results)
                        return JSON.stringify(results.map(line), null, 2);
                    const now = await Promise.all(ids.map((id) => ctx.tasks.get(id)));
                    const finished = now.filter((t) => Boolean(t && isTerminal(t.status)));
                    const running = now.filter((t) => Boolean(t && !isTerminal(t.status)));
                    return JSON.stringify({
                        stillRunning: running.map((t) => ({ id: t.id, title: t.title, status: t.status })),
                        finished: finished.map(line),
                        message: `Not finished after ${Math.round(maxMs / 1000)}s. Call await_tasks again with taskIds ${JSON.stringify(running.map((t) => t.id))} to keep waiting.`,
                    }, null, 2);
                }
            },
        },
        {
            name: "ask_user",
            description: "Ask the user a question and wait for the answer. Use sparingly.",
            schema: { question: z.string().min(1) },
            handler: async (args) => ctx.askUser(ctx.requestTask.id, ctx.managerId, String(args.question)),
        },
        brainstormTool(ctx),
        ...officeTools(ctx),
        {
            name: "resolve_task",
            description: "Mark a failed (or cancelled) task as solved without changing its history. Use when a later task completed the same work, or when the failure is acceptable. Retrying a resolved task clears the resolution.",
            schema: {
                taskId: z.string().describe("Id of the failed task to mark as resolved"),
                byTaskId: z.string().optional().describe("Id of the task that completed the same work (must be done)"),
                note: z.string().min(1).describe("Short explanation of why this failure is considered resolved"),
            },
            handler: async (args) => {
                const taskId = String(args.taskId);
                const byTaskId = args.byTaskId;
                const note = String(args.note);
                const task = await ctx.tasks.get(taskId);
                if (!task)
                    return `ERROR: unknown task ${taskId}`;
                if (task.status !== "failed" && task.status !== "cancelled") {
                    return `ERROR: only failed or cancelled tasks can be resolved (status is ${task.status})`;
                }
                if (byTaskId !== undefined) {
                    const byTask = await ctx.tasks.get(byTaskId);
                    if (!byTask)
                        return `ERROR: byTaskId ${byTaskId} not found`;
                    if (byTask.status !== "done")
                        return `ERROR: byTaskId ${byTaskId} is not done (status is ${byTask.status})`;
                }
                await ctx.tasks.setResolution(taskId, { byTaskId, note, at: new Date().toISOString() });
                return `Resolved task ${taskId}${byTaskId ? ` (completed by ${byTaskId})` : ""}`;
            },
        },
        {
            name: "retry_task",
            description: "Retry a failed task on its assignee's current provider/model/session (same as Retry in the office). The agent's memory carries its earlier attempt, so it continues where it left off.",
            schema: { taskId: z.string() },
            handler: async (args) => {
                const taskId = String(args.taskId);
                const task = await ctx.tasks.get(taskId);
                if (!task)
                    return `ERROR: unknown task ${taskId}`;
                if (task.status !== "failed")
                    return `ERROR: only failed tasks can be retried (status is ${task.status})`;
                await ctx.tasks.transition(taskId, "queued", { error: undefined, result: undefined });
                ctx.startTask(taskId);
                return `Retrying task ${taskId}; call await_tasks with it to collect the result`;
            },
        },
        {
            name: "revive_agent",
            description: "Switch a fainted agent to a new provider and retry its last failed task. Call after the user approves the revive or chooses a different provider.",
            schema: {
                agentId: z.string().describe("The id of the fainted agent"),
                provider: ProviderSchema.optional().describe("Provider to switch to; omit to use the suggested provider"),
                model: z.string().optional().describe("Model override; omit for the provider default"),
            },
            handler: async (args) => {
                if (!ctx.reviveAgent)
                    return "ERROR: reviveAgent not available";
                const agentId = String(args.agentId);
                const agent = await ctx.registry.get(agentId);
                if (!agent)
                    return `ERROR: unknown agent ${agentId}`;
                await ctx.reviveAgent(agentId, args.provider, args.model);
                return `Reviving ${agent.name} — switched provider and retried task`;
            },
        },
        {
            name: "add_room",
            description: "Add a new pod, meeting room, or lounge to the office layout. Returns the new space id.",
            schema: {
                kind: z.enum(["pod", "meeting", "lounge"]),
                name: z.string().max(40).optional().describe("Display name; omit for a default like 'Pod B'"),
            },
            handler: async (args) => {
                if (!ctx.addRoom)
                    return "ERROR: addRoom not available";
                const result = await ctx.addRoom(args.kind, args.name ?? "");
                if (!result.ok)
                    return `ERROR: ${result.message}`;
                return `Added ${args.kind} room (id: ${result.spaceId})`;
            },
        },
    ];
}
//# sourceMappingURL=tools.js.map