import { z } from "zod";
import { EffortSchema, isTerminal, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema } from "@agenticview/shared";
import { officeTools } from "./officeTools.js";
export const MANAGER_SYSTEM_PROMPT = `You are the Manager of an AgenticView office: a team of AI coding agents ("workers") that edit a real software project.

Rules:
- The "Roster" and "Open tasks" preamble at the top of each message is authoritative and freshly generated. Trust it over memory. Call list_agents or list_tasks if you need to re-check.
- Understand the request first. Read the project (you have read-only file tools) when a decision depends on the code.
- Prefer existing workers whose specialty fits. Create a new worker with create_agent only when nobody on the roster fits. Leave model and effort at their defaults unless the user asks; use update_agent to change them.
- Split work into self-contained assignments. Each assign_task description must stand alone: what to change, where (files or folders), how to verify. Never assign the same file to two workers at once.
- assign_task returns immediately. Call await_tasks with every task id you started before you report. Workers may fail; read their result and decide whether to reassign, retry with a clearer description, or report the failure.
- Use ask_user only when a decision truly needs the user.
- The office is a honeycomb of rooms. list_spaces shows who sits where; move_worker / arrange_workers reseat workers (group a team in one pod, call people to the meeting room) when the user asks or when it clearly helps.
- You never edit files yourself.
- End with a short report for the user: what was done, by whom, and anything left open.`;
export function workerSystemPrompt(agent, projectPath) {
    return [
        `You are ${agent.name}, a ${agent.specialty || "generalist"} engineer on an AgenticView team.`,
        `You are working inside the project at ${projectPath}. Only change files under that path.`,
        "Make the requested change, run the relevant tests or checks when they exist, and finish with a two-sentence summary of what you changed and how you verified it.",
        agent.description ? `About you: ${agent.description}` : "",
        agent.systemPrompt,
    ]
        .filter(Boolean)
        .join("\n\n");
}
const MODEL_HINT = "Model id or alias for the agent's provider, e.g. claude: opus | sonnet | haiku | fable; codex: gpt-6-sol; gemini: pro | flash. Omit for the provider default.";
const EFFORT_HINT = "Reasoning effort: low | medium | high (claude also xhigh | max; codex also xhigh | max | ultra on supporting models; ignored for gemini). Omit for the default.";
function agentLine(a, tasks) {
    const active = tasks.find((t) => t.assigneeId === a.id && (t.status === "running" || t.status === "waiting"));
    return { id: a.id, name: a.name, scope: a.scope, specialty: a.specialty, provider: a.provider ?? "default", model: a.model ?? "default", effort: a.effort ?? "default", level: a.stats.level, tasksDone: a.stats.tasksDone, state: active ? `running ${active.id}` : "idle" };
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
            description: "List every agent on the roster with scope, specialty, provider, level and current state.",
            schema: {},
            handler: async () => JSON.stringify((await ctx.registry.list()).filter((a) => a.role === "worker").map((a) => agentLine(a, [])), null, 2),
        },
        {
            name: "list_tasks",
            description: "List open (non-terminal) tasks with status, assignee and parent.",
            schema: { includeDone: z.boolean().optional().describe("Also include finished tasks") },
            handler: async (args) => {
                const all = await ctx.tasks.list();
                const rows = all.filter((t) => args.includeDone === true || !isTerminal(t.status));
                return JSON.stringify(rows.map((t) => ({ id: t.id, kind: t.kind, title: t.title, status: t.status, assigneeId: t.assigneeId, parentId: t.parentId, projectPath: t.projectPath, result: t.result?.slice(0, 300), error: t.error })), null, 2);
            },
        },
        {
            name: "create_agent",
            description: "Create a new worker agent on this world's roster. Give it a short name and a specialty such as 'frontend (React, CSS)' or 'tests (vitest)'.",
            schema: {
                name: z.string().min(1).max(40),
                specialty: z.string().max(120),
                description: z.string().max(2000).optional(),
                provider: ProviderSchema.optional().describe("claude (API key), claude-session (a Claude Code session running /agenticview-work), codex or gemini; omit to use the world default"),
                model: z.string().optional().describe(MODEL_HINT),
                effort: EffortSchema.optional().describe(EFFORT_HINT),
                systemPrompt: z.string().max(20000).optional(),
                tools: ToolAllowanceSchema.optional(),
                permissionMode: PermissionModeSchema.optional(),
            },
            handler: async (args) => {
                const draft = { name: String(args.name), specialty: String(args.specialty ?? ""), description: args.description, provider: args.provider ?? null, model: args.model ?? null, effort: args.effort ?? null, systemPrompt: args.systemPrompt, tools: args.tools, permissionMode: args.permissionMode };
                const agent = await ctx.registry.create(draft);
                const problem = await ctx.checkProvider(agent);
                if (problem) {
                    await ctx.registry.remove(agent.id);
                    return `ERROR: ${problem}`;
                }
                ctx.emitAgent(agent);
                return `Created agent ${agent.id} "${agent.name}" (${agent.scope}, ${agent.specialty || "generalist"})`;
            },
        },
        {
            name: "update_agent",
            description: "Change a worker's model, reasoning effort, provider, specialty or instructions. Pass null for model/effort to go back to the provider default.",
            schema: {
                agentId: z.string(),
                provider: ProviderSchema.nullable().optional(),
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
                });
                ctx.startTask(task.id);
                return `Started task ${task.id} for ${agent.name}`;
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
                await ctx.setWaiting(ctx.requestTask.id, true);
                try {
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
                finally {
                    await ctx.setWaiting(ctx.requestTask.id, false);
                }
            },
        },
        {
            name: "ask_user",
            description: "Ask the user a question and wait for the answer. Use sparingly.",
            schema: { question: z.string().min(1) },
            handler: async (args) => ctx.askUser(ctx.requestTask.id, ctx.managerId, String(args.question)),
        },
        ...officeTools({ registry: ctx.registry, emitAgent: ctx.emitAgent }),
    ];
}
//# sourceMappingURL=tools.js.map