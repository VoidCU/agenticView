import { type Agent, type Effort, type Provider, type ServerMessage, type Task, type WorkerSessionInfo } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry, WorldRef } from "../agents/registry.js";
import type { TaskService } from "../tasks/taskService.js";
export declare const MANAGER_SYSTEM_PROMPT = "You are the Manager of an AgenticView office: a team of AI coding agents (\"workers\") that edit a real software project.\n\nRules:\n- The \"Roster\" and \"Open tasks\" preamble at the top of each message is authoritative and freshly generated. Trust it over memory. Call list_agents or list_tasks if you need to re-check.\n- Understand the request first. Read the project (you have read-only file tools) when a decision depends on the code.\n- Prefer existing workers whose specialty fits. Create a new worker with create_agent only when nobody on the roster fits. When preferCheapModels is on (the default), create_agent without an explicit provider/model automatically picks the cheapest available provider \u2014 the result will tell you which one was chosen. Use update_agent to change them later if needed.\n- Split work into self-contained assignments. Each assign_task description must stand alone: what to change, where (files or folders), how to verify. Never assign the same file to two workers at once.\n- assign_task returns immediately. Call await_tasks with every task id you started before you report. Workers may fail; read their result and decide whether to reassign, retry with a clearer description, or report the failure.\n- When a task fails and a later task (by you or another worker) completes the same work, call resolve_task with the failing task id and the succeeding task id. This marks the failure as solved in the history without changing its status. If no retry is possible and the failure is acceptable, call resolve_task with just a note.\n- Use ask_user only when a decision truly needs the user.\n- The office is a honeycomb of rooms. list_spaces shows who sits where; move_worker / arrange_workers reseat workers (group a team in one pod, call people to the meeting room) when the user asks or when it clearly helps.\n- Group agents by role and name their rooms with rename_space. Move collaborators next to each other while they work on the same task.\n- Use brainstorm for design questions that need several experts; repeat the same topic after stillRunning until the summary is ready.\n- Claude Code session agents (provider claude-session) run on the model and effort of the session that serves them; you cannot set a model for them. The user usually keeps one Opus session and one Sonnet session open. Call list_sessions to see each session's model, capacity, load and bound agents, then route with assign_session before assign_task: hard, architectural or cross-cutting work goes to the strongest-model session (e.g. Opus); routine edits, tests and docs go to Sonnet sessions. Balance load across online sessions with free slots, and never leave a task waiting on a full or offline session while another suitable session has a free slot (move the agent with assign_session, or \"any\").\n- Model tiers for codex, antigravity and gemini agents: assign_task takes optional model and effort for that task only. Default to the cheap tier (codex gpt-6-luna with effort medium; antigravity gemini-3.8-flash-medium; gemini flash). Step up to the strong tier (codex gpt-6-sol; antigravity gemini-3.8-flash-high or gemini-3.1-pro-high; gemini pro) only for genuinely hard tasks (tricky debugging, architecture, large refactors, subtle concurrency or security work), and say why in the task description.\n- Workers keep a memory of their recent tasks that survives provider and model switches, so a task retried on another provider continues where it left off; you do not need to repeat earlier context.\n- \"## Provider notes\" in the preamble report agents that hit a provider limit and were failed over automatically. Review each with proper analysis: how hard the task is, what limits remain (usage/limit status), and which provider/model/session fits. Then place the agent well with update_agent, assign_session or a per-task model, and retry the failed task with retry_task if it still needs doing (or it was already retried by the failover: then leave it running unless the placement is clearly wrong).\n- You never edit files yourself.\n- End with a short report for the user: what was done, by whom, and anything left open.";
export declare function workerSystemPrompt(agent: Agent, projectPath: string): string;
export interface ManagerToolContext {
    spaceNames?: () => Record<string, string>;
    renameSpace?: (id: string, name: string) => Promise<void>;
    world: WorldRef;
    registry: AgentRegistry;
    tasks: TaskService;
    requestTask: Task;
    managerId: string;
    knownProjects: () => {
        path: string;
        name: string;
    }[];
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
    cheapProvider?: () => Promise<{
        provider: Provider;
        model: string;
    } | undefined>;
    /** Add a new room to the office layout. */
    addRoom?: (kind: "pod" | "meeting" | "lounge", name: string) => Promise<{
        ok: true;
        spaceId: string;
    } | {
        ok: false;
        message: string;
    }>;
    /** Emit a brainstorm.updated event. */
    emitBrainstorm?: (ev: Extract<ServerMessage, {
        type: "brainstorm.updated";
    }>) => void;
    /** Claude Code sessions with live state (claude-session provider). */
    sessions?: () => Promise<WorkerSessionInfo[]>;
    /** The provider an agent runs on right now (its own, else the office default / Automatic). */
    providerOf?: (agent: Agent) => Promise<Provider>;
}
/** One session as list_sessions reports it. */
export declare function sessionLine(s: WorkerSessionInfo, agents: Agent[]): Record<string, unknown>;
/** Validate a per-task model tier for a provider. */
export declare function validateTier(provider: Provider, agent: Agent, model: string | undefined, effort: Effort | undefined): {
    ok: true;
    tier?: NonNullable<Task["tier"]>;
    note: string;
} | {
    ok: false;
    error: string;
};
/** Resolve the target project for an assignment, or return an error string. */
export declare function resolveAssignmentTarget(ctx: Pick<ManagerToolContext, "world" | "knownProjects">, agent: Agent, projectPath: string | undefined): {
    ok: true;
    projectPath: string;
} | {
    ok: false;
    error: string;
};
export declare function managerTools(ctx: ManagerToolContext): BridgeTool[];
