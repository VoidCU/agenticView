import { z } from "zod";
import { ProviderSchema } from "./agent.js";

export const TaskStatusSchema = z.enum(["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const TaskKindSchema = z.enum(["request", "work", "chat"]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["assigned", "cancelled"],
  assigned: ["running", "queued", "cancelled"],
  running: ["waiting", "done", "failed", "cancelled"],
  waiting: ["running", "failed", "cancelled"],
  done: [],
  failed: ["queued"],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["done", "failed", "cancelled"];
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const TaskLogEntrySchema = z.object({ ts: z.string(), type: z.string(), text: z.string() });
export type TaskLogEntry = z.infer<typeof TaskLogEntrySchema>;

export const TaskWorkerSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  sessionName: z.string().optional(),
  /** Claude Code subagent type (`agenticview-<slug>`) the session was told to use. */
  subagent: z.string().optional(),
  /** Subagent instance id the session reported (SendMessage can continue it while it is alive). */
  subagentId: z.string().optional(),
  /** Files the run reported as changed. */
  files: z.array(z.string()).optional(),
});
export type TaskWorker = z.infer<typeof TaskWorkerSchema>;

export const TaskResolutionSchema = z.object({
  /** Id of the task that completed the same work. */
  byTaskId: z.string().optional(),
  /** Human-readable note explaining why this failure is considered resolved. */
  note: z.string(),
  /** ISO timestamp when the resolution was recorded. */
  at: z.string(),
});
export type TaskResolution = z.infer<typeof TaskResolutionSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  kind: TaskKindSchema,
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  createdBy: z.string(),
  assigneeId: z.string(),
  parentId: z.string().optional(),
  /** Per-run restrictions; never changes the saved worker permissions. */
  readOnly: z.boolean().optional(),
  projectPath: z.string(),
  session: z.object({ provider: ProviderSchema, sessionId: z.string() }).optional(),
  /** claude-session tasks: which Claude Code session and subagent did the work (continuity and the work log). */
  worker: TaskWorkerSchema.optional(),
  images: z.array(z.string()),
  result: z.string().optional(),
  error: z.string().optional(),
  /** Set when a failed task has been marked as resolved (fixed by another task or noted as acceptable). */
  resolution: TaskResolutionSchema.optional(),
  log: z.array(TaskLogEntrySchema),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TASK_LOG_CAP = 500;
