import { z } from "zod";
import { type Agent, type Task } from "@agenticview/shared";
/**
 * Per-agent memory of finished tasks, independent of provider and model.
 *
 * After every finished worker task (any provider) the orchestrator appends one compact record to
 * `<project>/.agenticview/memory/<agentId>.jsonl`. Every run's prompt carries the agent's latest records,
 * so an agent switched from e.g. gemini-flash to sonnet mid-stream (by the user, the Manager or a limit
 * failover) continues where it left off. The claude-session "Your recent work" digest reads from the same store.
 */
export declare const MEMORY_CAP = 100;
export declare const MEMORY_PROMPT_RECORDS = 5;
export declare const MemoryRecordSchema: z.ZodObject<{
    taskId: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<{
        done: "done";
        failed: "failed";
    }>;
    outcome: z.ZodString;
    files: z.ZodArray<z.ZodString>;
    provider: z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
    model: z.ZodNullable<z.ZodString>;
    at: z.ZodString;
    sessionName: z.ZodOptional<z.ZodString>;
    subagentId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
/** Up to three sentences (at most `max` characters) summarising a result: its last paragraph, where workers put their summary. */
export declare function outcomeOf(text: string | undefined, max?: number): string;
/** Files a task changed: the session-reported list, else its file_changed log lines. */
export declare function filesOf(task: Task): string[];
export declare function recordFor(task: Task, provider: string | null, model: string | null): MemoryRecord | undefined;
export declare class AgentMemory {
    private readonly dirFor;
    private chains;
    /** `dirFor(projectPath)`: where the memory of work in that project lives. */
    constructor(dirFor: (projectPath: string) => string);
    private file;
    private chained;
    /** Append a record, pruning the oldest beyond MEMORY_CAP. */
    append(projectPath: string, agentId: string, rec: MemoryRecord): Promise<void>;
    /** All records, oldest first. */
    list(projectPath: string, agentId: string): Promise<MemoryRecord[]>;
    /** Latest `n` records, newest first. */
    recent(projectPath: string, agentId: string, n?: number): Promise<MemoryRecord[]>;
    private readAll;
}
/** One-line identity reinforcement for every worker run. */
export declare function identityLine(agent: Pick<Agent, "name" | "specialty">): string;
/** The "Your recent work" block for a run prompt (empty when there is no memory yet). */
export declare function memoryBlock(records: MemoryRecord[], currentTaskId?: string): string;
