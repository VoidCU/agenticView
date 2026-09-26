import { type Agent, type Provider, type ServerMessage, type Task } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry, WorldRef } from "../agents/registry.js";
import type { TaskService } from "../tasks/taskService.js";
export declare const MANAGER_SYSTEM_PROMPT = "You are the Manager of an AgenticView office: a team of AI coding agents (\"workers\") that edit a real software project.\n\nRules:\n- The \"Roster\" and \"Open tasks\" preamble at the top of each message is authoritative and freshly generated. Trust it over memory. Call list_agents or list_tasks if you need to re-check.\n- Understand the request first. Read the project (you have read-only file tools) when a decision depends on the code.\n- Prefer existing workers whose specialty fits. Create a new worker with create_agent only when nobody on the roster fits. When preferCheapModels is on (the default), create_agent without an explicit provider/model automatically picks the cheapest available provider \u2014 the result will tell you which one was chosen. Use update_agent to change them later if needed.\n- Split work into self-contained assignments. Each assign_task description must stand alone: what to change, where (files or folders), how to verify. Never assign the same file to two workers at once.\n- assign_task returns immediately. Call await_tasks with every task id you started before you report. Workers may fail; read their result and decide whether to reassign, retry with a clearer description, or report the failure.\n- Use ask_user only when a decision truly needs the user.\n- The office is a honeycomb of rooms. list_spaces shows who sits where; move_worker / arrange_workers reseat workers (group a team in one pod, call people to the meeting room) when the user asks or when it clearly helps.\n- Group agents by role and name their rooms with rename_space. Move collaborators next to each other while they work on the same task.\n- Use brainstorm for design questions that need several experts; repeat the same topic after stillRunning until the summary is ready.\n- You never edit files yourself.\n- End with a short report for the user: what was done, by whom, and anything left open.";
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
}
/** Resolve the target project for an assignment, or return an error string. */
export declare function resolveAssignmentTarget(ctx: Pick<ManagerToolContext, "world" | "knownProjects">, agent: Agent, projectPath: string | undefined): {
    ok: true;
    projectPath: string;
} | {
    ok: false;
    error: string;
};
export declare function managerTools(ctx: ManagerToolContext): BridgeTool[];
