#!/usr/bin/env node
import { z } from "zod";
import { type Instance } from "./instances.js";
import { type SessionTask } from "./runtimes/session.js";
/** Test helper: forget the current task and identity. */
export declare function resetWorkerState(): void;
type ToolText = {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: boolean;
};
/** Find the office for `start` or its nearest ancestor with one running, else the hub. */
export declare function discoverOffice(start: string): Promise<Instance | undefined>;
/**
 * A usable session id, or undefined. The skill passes `${CLAUDE_SESSION_ID}`; if Claude Code did not
 * substitute it the literal placeholder arrives, which we ignore.
 */
export declare function cleanSessionId(v: unknown): string | undefined;
/**
 * POST JSON to the office with node:http. Deliberately not `fetch`: Node's fetch (undici) aborts
 * any response whose headers take longer than 300s (headersTimeout), which broke long bridge calls
 * such as a Manager's await_tasks. node:http has no such default; the caller's signal is the limit.
 */
export declare function postJson<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<{
    status: number;
    json: T;
}>;
export declare function formatTask(t: SessionTask): string;
export interface NextTaskArgs {
    wait_seconds?: number;
    project?: string;
    session_id?: string;
    agent?: string;
    model?: string;
}
export declare function nextTask(args: NextTaskArgs): Promise<ToolText>;
declare const EventSchema: z.ZodObject<{
    type: z.ZodEnum<{
        text: "text";
        tool_start: "tool_start";
        tool_end: "tool_end";
        file_changed: "file_changed";
        status: "status";
    }>;
    text: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    input: z.ZodOptional<z.ZodUnknown>;
    ok: z.ZodOptional<z.ZodBoolean>;
    summary: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        create: "create";
        modify: "modify";
        delete: "delete";
    }>>;
}, z.core.$strip>;
export declare function report(args: {
    text?: string;
    events?: z.infer<typeof EventSchema>[];
    session_id?: string;
}): Promise<ToolText>;
export declare function complete(args: {
    result?: string;
    error?: string;
    session_id?: string;
}): Promise<ToolText>;
export declare function bridge(args: {
    tool: string;
    args?: Record<string, unknown>;
    session_id?: string;
}): Promise<ToolText>;
export declare function main(): Promise<void>;
export {};
