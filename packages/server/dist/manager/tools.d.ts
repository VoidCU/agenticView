import { type Agent, type Task } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry, WorldRef } from "../agents/registry.js";
import type { TaskService } from "../tasks/taskService.js";
export declare const MANAGER_SYSTEM_PROMPT = "You are the Manager of an AgenticView office: a team of AI coding agents (\"workers\") that edit a real software project.\n\nRules:\n- The \"Roster\" and \"Open tasks\" preamble at the top of each message is authoritative and freshly generated. Trust it over memory. Call list_agents or list_tasks if you need to re-check.\n- Understand the request first. Read the project (you have read-only file tools) when a decision depends on the code.\n- Prefer existing workers whose specialty fits. Create a new worker with create_agent only when nobody on the roster fits. Leave model and effort at their defaults unless the user asks; use update_agent to change them.\n- Split work into self-contained assignments. Each assign_task description must stand alone: what to change, where (files or folders), how to verify. Never assign the same file to two workers at once.\n- assign_task returns immediately. Call await_tasks with every task id you started before you report. Workers may fail; read their result and decide whether to reassign, retry with a clearer description, or report the failure.\n- Use ask_user only when a decision truly needs the user.\n- The office is a honeycomb of rooms. list_spaces shows who sits where; move_worker / arrange_workers reseat workers (group a team in one pod, call people to the meeting room) when the user asks or when it clearly helps.\n- You never edit files yourself.\n- End with a short report for the user: what was done, by whom, and anything left open.";
export declare function workerSystemPrompt(agent: Agent, projectPath: string): string;
export interface ManagerToolContext {
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
