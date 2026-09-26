import { z } from "zod";
export declare const TaskStatusSchema: z.ZodEnum<{
    done: "done";
    queued: "queued";
    assigned: "assigned";
    running: "running";
    waiting: "waiting";
    failed: "failed";
    cancelled: "cancelled";
}>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export declare const TaskKindSchema: z.ZodEnum<{
    request: "request";
    work: "work";
    chat: "chat";
}>;
export type TaskKind = z.infer<typeof TaskKindSchema>;
export declare const TRANSITIONS: Record<TaskStatus, TaskStatus[]>;
export declare const TERMINAL_STATUSES: readonly TaskStatus[];
export declare function isTerminal(status: TaskStatus): boolean;
export declare const TaskLogEntrySchema: z.ZodObject<{
    ts: z.ZodString;
    type: z.ZodString;
    text: z.ZodString;
}, z.core.$strip>;
export type TaskLogEntry = z.infer<typeof TaskLogEntrySchema>;
export declare const TaskWorkerSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    sessionName: z.ZodOptional<z.ZodString>;
    subagent: z.ZodOptional<z.ZodString>;
    subagentId: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type TaskWorker = z.infer<typeof TaskWorkerSchema>;
export declare const TaskResolutionSchema: z.ZodObject<{
    byTaskId: z.ZodOptional<z.ZodString>;
    note: z.ZodString;
    at: z.ZodString;
}, z.core.$strip>;
export type TaskResolution = z.infer<typeof TaskResolutionSchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        request: "request";
        work: "work";
        chat: "chat";
    }>;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        done: "done";
        queued: "queued";
        assigned: "assigned";
        running: "running";
        waiting: "waiting";
        failed: "failed";
        cancelled: "cancelled";
    }>;
    createdBy: z.ZodString;
    assigneeId: z.ZodString;
    parentId: z.ZodOptional<z.ZodString>;
    readOnly: z.ZodOptional<z.ZodBoolean>;
    projectPath: z.ZodString;
    session: z.ZodOptional<z.ZodObject<{
        provider: z.ZodEnum<{
            claude: "claude";
            "claude-session": "claude-session";
            codex: "codex";
            antigravity: "antigravity";
            gemini: "gemini";
        }>;
        sessionId: z.ZodString;
    }, z.core.$strip>>;
    worker: z.ZodOptional<z.ZodObject<{
        runId: z.ZodString;
        sessionId: z.ZodString;
        sessionName: z.ZodOptional<z.ZodString>;
        subagent: z.ZodOptional<z.ZodString>;
        subagentId: z.ZodOptional<z.ZodString>;
        files: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    images: z.ZodArray<z.ZodString>;
    result: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    resolution: z.ZodOptional<z.ZodObject<{
        byTaskId: z.ZodOptional<z.ZodString>;
        note: z.ZodString;
        at: z.ZodString;
    }, z.core.$strip>>;
    log: z.ZodArray<z.ZodObject<{
        ts: z.ZodString;
        type: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Task = z.infer<typeof TaskSchema>;
export declare const TASK_LOG_CAP = 500;
