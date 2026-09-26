import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ProviderSchema } from "@agenticview/shared";
/**
 * Per-agent memory of finished tasks, independent of provider and model.
 *
 * After every finished worker task (any provider) the orchestrator appends one compact record to
 * `<project>/.agenticview/memory/<agentId>.jsonl`. Every run's prompt carries the agent's latest records,
 * so an agent switched from e.g. gemini-flash to sonnet mid-stream (by the user, the Manager or a limit
 * failover) continues where it left off. The claude-session "Your recent work" digest reads from the same store.
 */
export const MEMORY_CAP = 100;
export const MEMORY_PROMPT_RECORDS = 5;
export const MemoryRecordSchema = z.object({
    taskId: z.string(),
    title: z.string(),
    status: z.enum(["done", "failed"]),
    /** Two or three sentences taken from the result (or the error). */
    outcome: z.string(),
    files: z.array(z.string()),
    provider: ProviderSchema.nullable(),
    model: z.string().nullable(),
    at: z.string(),
    sessionName: z.string().optional(),
    subagentId: z.string().optional(),
});
/** Up to three sentences (at most `max` characters) summarising a result: its last paragraph, where workers put their summary. */
export function outcomeOf(text, max = 400) {
    if (!text)
        return "";
    const paras = text
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const last = paras[paras.length - 1] ?? "";
    // A sentence ends at . ! or ? followed by whitespace (so "a.ts" stays whole).
    const sentences = (last.match(/.+?[.!?]+(?=\s|$)|.+$/g) ?? [last]).map((x) => x.trim()).filter(Boolean);
    const out = sentences.slice(0, 3).join(" ").trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
/** Files a task changed: the session-reported list, else its file_changed log lines. */
export function filesOf(task) {
    const files = task.worker?.files ?? [...new Set(task.log.filter((l) => l.type === "file_changed").map((l) => l.text.replace(/^\S+\s+/, "")))];
    return files.slice(0, 12);
}
export function recordFor(task, provider, model) {
    if (task.status !== "done" && task.status !== "failed")
        return undefined;
    const parsed = ProviderSchema.safeParse(provider);
    return {
        taskId: task.id,
        title: task.title.slice(0, 200),
        status: task.status,
        outcome: outcomeOf(task.status === "done" ? task.result : (task.error ?? task.result)),
        files: filesOf(task),
        provider: parsed.success ? parsed.data : null,
        model: model ?? null,
        at: task.finishedAt ?? new Date().toISOString(),
        ...(task.worker?.sessionName ? { sessionName: task.worker.sessionName } : {}),
        ...(task.worker?.subagentId ? { subagentId: task.worker.subagentId } : {}),
    };
}
export class AgentMemory {
    dirFor;
    chains = new Map();
    /** `dirFor(projectPath)`: where the memory of work in that project lives. */
    constructor(dirFor) {
        this.dirFor = dirFor;
    }
    file(projectPath, agentId) {
        return join(this.dirFor(projectPath), `${agentId.replace(/[^\w-]/g, "_")}.jsonl`);
    }
    chained(key, fn) {
        const prev = this.chains.get(key) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        this.chains.set(key, next.catch(() => undefined));
        return next;
    }
    /** Append a record, pruning the oldest beyond MEMORY_CAP. */
    append(projectPath, agentId, rec) {
        const file = this.file(projectPath, agentId);
        return this.chained(file, async () => {
            await mkdir(this.dirFor(projectPath), { recursive: true });
            await appendFile(file, `${JSON.stringify(rec)}\n`, "utf8");
            const all = await this.readAll(file);
            if (all.length > MEMORY_CAP)
                await writeFile(file, all.slice(-MEMORY_CAP).map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
        });
    }
    /** All records, oldest first. */
    async list(projectPath, agentId) {
        const file = this.file(projectPath, agentId);
        return this.chained(file, () => this.readAll(file));
    }
    /** Latest `n` records, newest first. */
    async recent(projectPath, agentId, n = MEMORY_PROMPT_RECORDS) {
        return (await this.list(projectPath, agentId)).slice(-n).reverse();
    }
    async readAll(file) {
        let text;
        try {
            text = await readFile(file, "utf8");
        }
        catch (e) {
            if (e.code === "ENOENT")
                return [];
            throw e;
        }
        const out = [];
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim())
                continue;
            try {
                const r = MemoryRecordSchema.safeParse(JSON.parse(line));
                if (r.success)
                    out.push(r.data);
            }
            catch {
                // A torn line (crash mid-write) is skipped.
            }
        }
        return out;
    }
}
/** One-line identity reinforcement for every worker run. */
export function identityLine(agent) {
    return `You are ${agent.name}, expert in ${agent.specialty || "general engineering"}.`;
}
/** The "Your recent work" block for a run prompt (empty when there is no memory yet). */
export function memoryBlock(records, currentTaskId) {
    if (records.length === 0)
        return "";
    const lines = records.map((r) => {
        const via = [r.provider, r.model].filter(Boolean).join("/");
        const again = r.taskId === currentTaskId ? " (an earlier attempt of THIS task)" : "";
        const files = r.files.length ? ` [files: ${r.files.join(", ")}]` : "";
        return `- [${r.status}] "${r.title}"${again} (${r.at.slice(0, 16).replace("T", " ")}${via ? `, ${via}` : ""}): ${r.outcome || "(no result text)"}${files}`;
    });
    return ["## Your recent work (newest first; continue from it, do not redo it)", ...lines].join("\n");
}
//# sourceMappingURL=memory.js.map