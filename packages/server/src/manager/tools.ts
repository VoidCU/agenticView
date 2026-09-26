import { z } from "zod";
import { EffortSchema, isTerminal, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema, type Agent, type BrainstormParticipant, type Provider, type ServerMessage, type Task } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry, WorldRef } from "../agents/registry.js";
import type { TaskService } from "../tasks/taskService.js";
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
- You never edit files yourself.
- End with a short report for the user: what was done, by whom, and anything left open.`;

export function workerSystemPrompt(agent: Agent, projectPath: string): string {
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

const MODEL_HINT = "Model id or alias for the agent's provider, e.g. claude: opus | sonnet | haiku | fable; codex: gpt-6-sol; antigravity: gemini-3.8-flash-high | gemini-3.1-pro-high | claude-sonnet-4-6 | claude-opus-4-6-thinking (run `agy models`); gemini: pro | flash. Omit for the provider default.";
const EFFORT_HINT = "Reasoning effort: low | medium | high (claude also xhigh | max; codex also xhigh | max | ultra on supporting models; antigravity also max, ignored for its -high/-medium/-low model ids; ignored for gemini). Omit for the default.";

export interface ManagerToolContext {
  spaceNames?: () => Record<string, string>;
  renameSpace?: (id: string, name: string) => Promise<void>;
  world: WorldRef;
  registry: AgentRegistry;
  tasks: TaskService;
  requestTask: Task;
  managerId: string;
  knownProjects: () => { path: string; name: string }[];
  startTask: (taskId: string) => void;
  cancelTask?: (taskId: string) => Promise<void>;
  awaitTask: (taskId: string) => Promise<Task>;
  askUser: (taskId: string, agentId: string, question: string) => Promise<string>;
  setWaiting: (taskId: string, waiting: boolean) => Promise<void>;
  emitAgent: (agent: Agent) => void;
  checkProvider: (agent: Agent) => Promise<string | undefined>;
  /**
   * claude-session guard: a message when `agent`'s task could only run in the Claude Code session
   * that is running this Manager (it would wait forever while the Manager waits on it).
   */
  sessionConflict?: (agent: Agent) => Promise<string | undefined>;
  /** Surface a status line in the Manager's feed. */
  notify?: (text: string) => void;
  /** Switch agent to a new provider and retry its last failed task. */
  reviveAgent?: (agentId: string, provider?: Provider, model?: string) => Promise<void>;
  /** When preferCheapModels is on, returns the cheapest available {provider, model}. */
  cheapProvider?: () => Promise<{ provider: Provider; model: string } | undefined>;
  /** Add a new room to the office layout. */
  addRoom?: (kind: "pod" | "meeting" | "lounge", name: string) => Promise<{ ok: true; spaceId: string } | { ok: false; message: string }>;
  /** Emit a brainstorm.updated event. */
  emitBrainstorm?: (ev: Extract<ServerMessage, { type: "brainstorm.updated" }>) => void;
}

function agentLine(a: Agent, tasks: Task[]): Record<string, unknown> {
  const active = tasks.find((t) => t.assigneeId === a.id && (t.status === "running" || t.status === "waiting"));
  return { id: a.id, name: a.name, scope: a.scope, specialty: a.specialty, provider: a.provider ?? "default", model: a.model ?? "default", effort: a.effort ?? "default", level: a.stats.level, tasksDone: a.stats.tasksDone, state: active ? `running ${active.id}` : "idle" };
}

/** Resolve the target project for an assignment, or return an error string. */
export function resolveAssignmentTarget(ctx: Pick<ManagerToolContext, "world" | "knownProjects">, agent: Agent, projectPath: string | undefined): { ok: true; projectPath: string } | { ok: false; error: string } {
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
  if (!projectPath) return { ok: false, error: "ERROR: scope: projectPath is required in the hub; pick one of the known projects" };
  if (!ctx.knownProjects().some((p) => p.path === projectPath)) {
    return { ok: false, error: `ERROR: scope: ${projectPath} is not a known project (open it once with /agenticview first)` };
  }
  if (agent.scope !== "global") return { ok: false, error: `ERROR: scope: ${agent.name} is not a global agent` };
  return { ok: true, projectPath };
}

export function managerTools(ctx: ManagerToolContext): BridgeTool[] {
  return [
    {
      name: "list_agents",
      description: "List every agent on the roster with scope, specialty, provider, level and current state.",
      schema: {},
      handler: async () => JSON.stringify((await ctx.registry.list()).filter((a) => a.role === "worker").map((a) => agentLine(a, [])), null, 2),
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
        provider: ProviderSchema.optional().describe("claude (API key), claude-session (a Claude Code session running /agenticview-work), codex, antigravity (the Antigravity CLI, agy) or gemini; omit to use the world default"),
        model: z.string().optional().describe(MODEL_HINT),
        effort: EffortSchema.optional().describe(EFFORT_HINT),
        systemPrompt: z.string().max(20000).optional(),
        tools: ToolAllowanceSchema.optional(),
        permissionMode: PermissionModeSchema.optional(),
      },
      handler: async (args) => {
        const explicitProvider = args.provider as Agent["provider"] | undefined;
        const explicitModel = args.model as string | undefined;
        let chosenProvider: Agent["provider"] = explicitProvider ?? null;
        let chosenModel: string | null = explicitModel ?? null;
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
        const draft = { name: String(args.name), specialty: String(args.specialty ?? ""), description: args.description as string | undefined, provider: chosenProvider, model: chosenModel, effort: (args.effort as Agent["effort"]) ?? null, systemPrompt: args.systemPrompt as string | undefined, tools: args.tools as Agent["tools"] | undefined, permissionMode: args.permissionMode as Agent["permissionMode"] | undefined };
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
        provider: ProviderSchema.nullable().optional().describe("claude, claude-session, codex, antigravity or gemini; null for the world default"),
        model: z.string().nullable().optional().describe(MODEL_HINT),
        effort: EffortSchema.nullable().optional().describe(EFFORT_HINT),
        specialty: z.string().max(120).optional(),
        description: z.string().max(2000).optional(),
        systemPrompt: z.string().max(20000).optional(),
      },
      handler: async (args) => {
        const cur = await ctx.registry.get(String(args.agentId));
        if (!cur) return `ERROR: unknown agent ${String(args.agentId)}`;
        if (cur.role !== "worker") return "ERROR: only workers can be updated";
        const patch: Partial<Agent> = {};
        for (const k of ["provider", "model", "effort", "specialty", "description", "systemPrompt"] as const) {
          if (args[k] !== undefined) (patch as Record<string, unknown>)[k] = args[k];
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
        if (!agent) return `ERROR: unknown agent ${String(args.agentId)}`;
        if (agent.role !== "worker") return "ERROR: tasks can only be assigned to workers";
        const target = resolveAssignmentTarget(ctx, agent, args.projectPath as string | undefined);
        if (!target.ok) return target.error;
        const problem = await ctx.checkProvider(agent);
        if (problem) return `ERROR: ${problem}`;
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
      description:
        "Block until every listed task is finished, then return each task's status and result or error. With maxWaitSeconds, returns early with the tasks still running; call it again with those ids.",
      schema: {
        taskIds: z.array(z.string()).min(1),
        maxWaitSeconds: z.number().int().min(1).max(86_400).optional().describe("Return after this long even if tasks are still running (default: wait until all finish)"),
      },
      handler: async (args) => {
        const ids = args.taskIds as string[];
        if (ctx.sessionConflict) {
          const blocked: string[] = [];
          for (const id of ids) {
            const t = await ctx.tasks.get(id);
            if (!t || isTerminal(t.status)) continue;
            const a = await ctx.registry.get(t.assigneeId);
            const conflict = a && (await ctx.sessionConflict(a));
            if (conflict) blocked.push(`${id}: ${conflict}`);
          }
          if (blocked.length) {
            ctx.notify?.(blocked.join("\n"));
            return `ERROR: waiting would deadlock.\n${blocked.join("\n")}`;
          }
        }
        const line = (t: Task) => ({ id: t.id, title: t.title, status: t.status, result: t.result, error: t.error });
        const maxMs = typeof args.maxWaitSeconds === "number" ? args.maxWaitSeconds * 1000 : undefined;
        // A Manager waiting on its own workers is still working: the request stays "running". Only a
        // question or permission for the user moves it to "waiting" (shown as "Waiting on you").
        {
          const all = Promise.all(ids.map((id) => ctx.awaitTask(id)));
          if (maxMs === undefined) return JSON.stringify((await all).map(line), null, 2);
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timedOut = new Promise<null>((r) => (timer = setTimeout(() => r(null), maxMs)));
          const results = await Promise.race([all, timedOut]);
          clearTimeout(timer);
          if (results) return JSON.stringify(results.map(line), null, 2);
          const now = await Promise.all(ids.map((id) => ctx.tasks.get(id)));
          const finished = now.filter((t): t is Task => Boolean(t && isTerminal(t.status)));
          const running = now.filter((t): t is Task => Boolean(t && !isTerminal(t.status)));
          return JSON.stringify(
            {
              stillRunning: running.map((t) => ({ id: t.id, title: t.title, status: t.status })),
              finished: finished.map(line),
              message: `Not finished after ${Math.round(maxMs / 1000)}s. Call await_tasks again with taskIds ${JSON.stringify(running.map((t) => t.id))} to keep waiting.`,
            },
            null,
            2,
          );
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
      description:
        "Mark a failed (or cancelled) task as solved without changing its history. Use when a later task completed the same work, or when the failure is acceptable. Retrying a resolved task clears the resolution.",
      schema: {
        taskId: z.string().describe("Id of the failed task to mark as resolved"),
        byTaskId: z.string().optional().describe("Id of the task that completed the same work (must be done)"),
        note: z.string().min(1).describe("Short explanation of why this failure is considered resolved"),
      },
      handler: async (args) => {
        const taskId = String(args.taskId);
        const byTaskId = args.byTaskId as string | undefined;
        const note = String(args.note);
        const task = await ctx.tasks.get(taskId);
        if (!task) return `ERROR: unknown task ${taskId}`;
        if (task.status !== "failed" && task.status !== "cancelled") {
          return `ERROR: only failed or cancelled tasks can be resolved (status is ${task.status})`;
        }
        if (byTaskId !== undefined) {
          const byTask = await ctx.tasks.get(byTaskId);
          if (!byTask) return `ERROR: byTaskId ${byTaskId} not found`;
          if (byTask.status !== "done") return `ERROR: byTaskId ${byTaskId} is not done (status is ${byTask.status})`;
        }
        await ctx.tasks.setResolution(taskId, { byTaskId, note, at: new Date().toISOString() });
        return `Resolved task ${taskId}${byTaskId ? ` (completed by ${byTaskId})` : ""}`;
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
        if (!ctx.reviveAgent) return "ERROR: reviveAgent not available";
        const agentId = String(args.agentId);
        const agent = await ctx.registry.get(agentId);
        if (!agent) return `ERROR: unknown agent ${agentId}`;
        await ctx.reviveAgent(agentId, args.provider as Provider | undefined, args.model as string | undefined);
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
        if (!ctx.addRoom) return "ERROR: addRoom not available";
        const result = await ctx.addRoom(args.kind as "pod" | "meeting" | "lounge", (args.name as string | undefined) ?? "");
        if (!result.ok) return `ERROR: ${result.message}`;
        return `Added ${args.kind} room (id: ${result.spaceId})`;
      },
    },
  ];
}
