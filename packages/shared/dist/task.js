import { z } from "zod";
import { ProviderSchema } from "./agent.js";
export const TaskStatusSchema = z.enum(["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"]);
export const TaskKindSchema = z.enum(["request", "work", "chat"]);
export const TRANSITIONS = {
    queued: ["assigned", "cancelled"],
    assigned: ["running", "cancelled"],
    running: ["waiting", "done", "failed", "cancelled"],
    waiting: ["running", "cancelled"],
    done: [],
    failed: [],
    cancelled: [],
};
export const TERMINAL_STATUSES = ["done", "failed", "cancelled"];
export function isTerminal(status) {
    return TERMINAL_STATUSES.includes(status);
}
export const TaskLogEntrySchema = z.object({ ts: z.string(), type: z.string(), text: z.string() });
export const TaskSchema = z.object({
    id: z.string(),
    kind: TaskKindSchema,
    title: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    createdBy: z.string(),
    assigneeId: z.string(),
    parentId: z.string().optional(),
    projectPath: z.string(),
    session: z.object({ provider: ProviderSchema, sessionId: z.string() }).optional(),
    images: z.array(z.string()),
    result: z.string().optional(),
    error: z.string().optional(),
    log: z.array(TaskLogEntrySchema),
    createdAt: z.string(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
});
export const TASK_LOG_CAP = 500;
//# sourceMappingURL=task.js.map