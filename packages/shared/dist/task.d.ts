import { z } from "zod";
export declare const TaskStatusSchema: z.ZodEnum<["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"]>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export declare const TaskKindSchema: z.ZodEnum<["request", "work", "chat"]>;
export type TaskKind = z.infer<typeof TaskKindSchema>;
export declare const TRANSITIONS: Record<TaskStatus, TaskStatus[]>;
export declare const TERMINAL_STATUSES: readonly TaskStatus[];
export declare function isTerminal(status: TaskStatus): boolean;
export declare const TaskLogEntrySchema: z.ZodObject<{
    ts: z.ZodString;
    type: z.ZodString;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    ts: string;
    text: string;
}, {
    type: string;
    ts: string;
    text: string;
}>;
export type TaskLogEntry = z.infer<typeof TaskLogEntrySchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<["request", "work", "chat"]>;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"]>;
    createdBy: z.ZodString;
    assigneeId: z.ZodString;
    parentId: z.ZodOptional<z.ZodString>;
    projectPath: z.ZodString;
    session: z.ZodOptional<z.ZodObject<{
        provider: z.ZodEnum<["claude", "codex", "gemini"]>;
        sessionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        provider: "claude" | "codex" | "gemini";
        sessionId: string;
    }, {
        provider: "claude" | "codex" | "gemini";
        sessionId: string;
    }>>;
    images: z.ZodArray<z.ZodString, "many">;
    result: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    log: z.ZodArray<z.ZodObject<{
        ts: z.ZodString;
        type: z.ZodString;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        ts: string;
        text: string;
    }, {
        type: string;
        ts: string;
        text: string;
    }>, "many">;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "queued" | "assigned" | "running" | "waiting" | "done" | "failed" | "cancelled";
    id: string;
    description: string;
    createdAt: string;
    kind: "request" | "work" | "chat";
    title: string;
    createdBy: string;
    assigneeId: string;
    projectPath: string;
    images: string[];
    log: {
        type: string;
        ts: string;
        text: string;
    }[];
    parentId?: string | undefined;
    session?: {
        provider: "claude" | "codex" | "gemini";
        sessionId: string;
    } | undefined;
    result?: string | undefined;
    error?: string | undefined;
    startedAt?: string | undefined;
    finishedAt?: string | undefined;
}, {
    status: "queued" | "assigned" | "running" | "waiting" | "done" | "failed" | "cancelled";
    id: string;
    description: string;
    createdAt: string;
    kind: "request" | "work" | "chat";
    title: string;
    createdBy: string;
    assigneeId: string;
    projectPath: string;
    images: string[];
    log: {
        type: string;
        ts: string;
        text: string;
    }[];
    parentId?: string | undefined;
    session?: {
        provider: "claude" | "codex" | "gemini";
        sessionId: string;
    } | undefined;
    result?: string | undefined;
    error?: string | undefined;
    startedAt?: string | undefined;
    finishedAt?: string | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
export declare const TASK_LOG_CAP = 500;
