import { z } from "zod";

/** Default number of tasks one Claude Code session runs at once (one subagent each). */
export const DEFAULT_SESSION_CAPACITY = 4;
export const MAX_SESSION_CAPACITY = 8;

/**
 * A Claude Code session that has connected to the office with /agenticview-work (the
 * `claude-session` provider). Identified by Claude Code's own session id (`${CLAUDE_SESSION_ID}`),
 * so it is recognised again when the user reopens or resumes that session. The session is a
 * coordinator: it runs each claimed task in a background subagent, several at once.
 */
export const WorkerSessionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  /** Model the session reported on its last poll (its own model; only the user can change it with /model). */
  model: z.string().max(120).nullable().default(null),
  cwd: z.string().max(1000).nullable().default(null),
  firstSeen: z.string(),
  lastSeen: z.string(),
  /** True once the user renamed it in the office (auto names never overwrite it). */
  named: z.boolean().default(false),
  /** How many office tasks this session runs at once (each in its own background subagent). */
  capacity: z.number().int().min(1).max(MAX_SESSION_CAPACITY).default(DEFAULT_SESSION_CAPACITY),
});
export type WorkerSession = z.infer<typeof WorkerSessionSchema>;

export const WorkerSessionFileSchema = z.object({ sessions: z.array(WorkerSessionSchema).default([]) });

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
export const AgentSessionSchema = z.object({ id: z.string().min(1).max(64), name: z.string().max(60).optional() });
export type AgentSession = z.infer<typeof AgentSessionSchema>;

/** Name of the skill as the user types it (plugin skills are namespaced by the plugin name). */
export const WORK_COMMAND = "/agenticview:agenticview-work";

/** VS Code URI that opens a NEW Claude Code tab with `prompt` pre-filled (the user presses Enter). */
export function newSessionUri(agentName?: string): string {
  const prompt = agentName ? `${WORK_COMMAND} ${agentName}` : WORK_COMMAND;
  return `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`;
}

/** VS Code URI that resumes an existing Claude Code session in a tab. */
export function resumeSessionUri(sessionId: string): string {
  return `vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`;
}

/** Terminal fallback for resuming a session outside VS Code. */
export function resumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId}`;
}

const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;

/** The model family an id or display name belongs to ("claude-opus-5-5[1m]" -> "opus"), if recognisable. */
export function modelFamily(model: string | null | undefined): string | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  return FAMILIES.find((f) => m.includes(f));
}

/**
 * Whether a session reporting `reported` satisfies the office's `requested` model. Unknown on either
 * side counts as a match (nothing to warn about).
 */
export function sessionModelMatches(requested: string | null | undefined, reported: string | null | undefined): boolean {
  if (!requested || !reported) return true;
  const a = requested.trim().toLowerCase();
  const b = reported.trim().toLowerCase();
  if (a === b || b.includes(a)) return true;
  const fa = modelFamily(a);
  const fb = modelFamily(b);
  return !fa || !fb ? a === b : fa === fb;
}

/** Short default name for a session: "<folder> · 1a2b3c". */
export function defaultSessionName(id: string, cwd?: string | null): string {
  const folder = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : undefined;
  const short = id.replace(/-/g, "").slice(0, 6);
  return (folder ? `${folder} · ${short}` : `Session ${short}`).slice(0, 60);
}
