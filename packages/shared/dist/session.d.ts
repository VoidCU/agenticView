import { z } from "zod";
/** Default number of tasks one Claude Code session runs at once (one subagent each). */
export declare const DEFAULT_SESSION_CAPACITY = 4;
export declare const MAX_SESSION_CAPACITY = 8;
/**
 * A Claude Code session that has connected to the office with /agenticview-work (the
 * `claude-session` provider). Identified by Claude Code's own session id (`${CLAUDE_SESSION_ID}`),
 * so it is recognised again when the user reopens or resumes that session. The session is a
 * coordinator: it runs each claimed task in a background subagent, several at once.
 */
export declare const WorkerSessionSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    cwd: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    firstSeen: z.ZodString;
    lastSeen: z.ZodString;
    named: z.ZodDefault<z.ZodBoolean>;
    capacity: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type WorkerSession = z.infer<typeof WorkerSessionSchema>;
export declare const WorkerSessionFileSchema: z.ZodObject<{
    sessions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        cwd: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        firstSeen: z.ZodString;
        lastSeen: z.ZodString;
        named: z.ZodDefault<z.ZodBoolean>;
        capacity: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** A run a session is working on (one background subagent in that session). */
export interface SessionRunInfo {
    runId: string;
    taskId: string | null;
    agentId: string;
    /** Claude Code subagent type that serves it ("agenticview-<slug>"), when one was generated. */
    subagent: string | null;
    /** The subagent instance id the session reported (lets the session continue it with SendMessage). */
    subagentId: string | null;
    startedAt: string;
}
/** Wire form: the persisted record plus live state. */
export interface WorkerSessionInfo extends WorkerSession {
    /** Polled or worked within the liveness window. */
    online: boolean;
    /** Office task the session is working on right now (the first of `runs`, kept for older clients). */
    currentTaskId: string | null;
    /** Every run the session holds right now, one subagent each. */
    runs: SessionRunInfo[];
    /** Agents bound to this session. */
    agentIds: string[];
}
/** The binding stored on a claude-session agent. */
export declare const AgentSessionSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
/** Name of the skill as the user types it (plugin skills are namespaced by the plugin name). */
export declare const WORK_COMMAND = "/agenticview:agenticview-work";
/** VS Code URI that opens a NEW Claude Code tab with `prompt` pre-filled (the user presses Enter). */
export declare function newSessionUri(agentName?: string): string;
/** VS Code URI that resumes an existing Claude Code session in a tab. */
export declare function resumeSessionUri(sessionId: string): string;
/** Terminal fallback for resuming a session outside VS Code. */
export declare function resumeCommand(sessionId: string): string;
/** The model family an id or display name belongs to ("claude-opus-5-5[1m]" -> "opus"), if recognisable. */
export declare function modelFamily(model: string | null | undefined): string | undefined;
/**
 * Whether a session reporting `reported` satisfies the office's `requested` model. Unknown on either
 * side counts as a match (nothing to warn about).
 */
export declare function sessionModelMatches(requested: string | null | undefined, reported: string | null | undefined): boolean;
/** Short default name for a session: "<folder> · 1a2b3c". */
export declare function defaultSessionName(id: string, cwd?: string | null): string;
