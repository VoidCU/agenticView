import { randomBytes } from "node:crypto";
import { z } from "zod";
/**
 * `claude-session` provider: work is done by the user's own Claude Code session running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for workers that pull them over HTTP (see api/worker.ts) and relays what they report.
 */
export const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";
const CANCELLED_MSG = "This task was cancelled in the office. Stop working on it and call agenticview_next_task.";
export class SessionRuntime {
    provider = "claude-session";
    queue = [];
    runs = new Map();
    /** runIds cancelled recently, so a worker's next call is told to stop. */
    cancelled = new Set();
    seen = new Map();
    waiters = [];
    liveMs;
    now;
    lastCount = 0;
    /** Called when the connected-worker count changes (to refresh provider chips). */
    onWorkersChanged;
    constructor(opts = {}) {
        this.liveMs = opts.liveMs ?? 60_000;
        this.now = opts.now ?? Date.now;
        this.onWorkersChanged = opts.onWorkersChanged;
    }
    static newWorkerId() {
        return `w-${randomBytes(6).toString("hex")}`;
    }
    /** Number of workers seen within the liveness window (polling or working on a run). */
    workers() {
        const cutoff = this.now() - this.liveMs;
        let n = 0;
        for (const [id, at] of this.seen) {
            const busy = [...this.runs.values()].some((p) => p.workerId === id);
            if (at >= cutoff || busy || this.waiters.some((w) => w.workerId === id))
                n++;
            else
                this.seen.delete(id);
        }
        return n;
    }
    queued() {
        return this.queue.length;
    }
    async check() {
        const n = this.workers();
        if (n > 0)
            return { provider: this.provider, ok: true, version: `${n} worker${n === 1 ? "" : "s"}` };
        return { provider: this.provider, ok: false, reason: SESSION_WORKER_HINT };
    }
    touch(workerId) {
        this.seen.set(workerId, this.now());
        this.notifyCount();
    }
    notifyCount() {
        const n = this.workers();
        if (n !== this.lastCount) {
            this.lastCount = n;
            this.onWorkersChanged?.();
        }
    }
    run(req, sink, signal) {
        return new Promise((resolve) => {
            const p = {
                req,
                sink,
                text: "",
                settled: false,
                settle: (r) => {
                    if (p.settled)
                        return;
                    p.settled = true;
                    this.runs.delete(req.runId);
                    const qi = this.queue.indexOf(req.runId);
                    if (qi >= 0)
                        this.queue.splice(qi, 1);
                    signal.removeEventListener("abort", onAbort);
                    this.notifyCount();
                    resolve(r);
                },
            };
            const onAbort = () => {
                this.cancelled.add(req.runId);
                // Keep the tombstone bounded.
                if (this.cancelled.size > 200)
                    this.cancelled.delete(this.cancelled.values().next().value);
                p.settle({ text: p.text, stopReason: "aborted" });
            };
            if (signal.aborted) {
                resolve({ text: "", stopReason: "aborted" });
                return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
            this.runs.set(req.runId, p);
            this.queue.push(req.runId);
            if (this.workers() === 0)
                sink({ type: "status", text: `Waiting for a Claude Code session worker. ${SESSION_WORKER_HINT}` });
            else
                sink({ type: "status", text: "Queued for a Claude Code session worker" });
            this.dispatch();
        });
    }
    /** Hand queued runs to waiting workers. */
    dispatch() {
        while (this.queue.length > 0 && this.waiters.length > 0) {
            const w = this.waiters.shift();
            const runId = this.queue.shift();
            const p = this.runs.get(runId);
            if (!p)
                continue;
            p.workerId = w.workerId;
            p.sink({ type: "status", text: "Picked up by a Claude Code session worker" });
            w.resolve(toSessionTask(p.req));
        }
    }
    /** Long-poll for the next run. Resolves null when nothing arrives within `waitMs`. */
    claim(workerId, waitMs = 25_000, signal) {
        this.touch(workerId);
        return new Promise((resolve) => {
            const waiter = {
                workerId,
                resolve: (t) => {
                    clearTimeout(timer);
                    signal?.removeEventListener("abort", drop);
                    this.touch(workerId);
                    resolve(t);
                },
            };
            const drop = () => {
                const i = this.waiters.indexOf(waiter);
                if (i >= 0)
                    this.waiters.splice(i, 1);
                waiter.resolve(null);
            };
            const timer = setTimeout(drop, Math.max(0, waitMs));
            signal?.addEventListener("abort", drop, { once: true });
            this.waiters.push(waiter);
            this.dispatch();
        });
    }
    active(runId, workerId) {
        if (workerId)
            this.touch(workerId);
        const p = this.runs.get(runId);
        if (!p) {
            if (this.cancelled.has(runId))
                return { ok: false, cancelled: true, error: CANCELLED_MSG };
            return { ok: false, error: `Unknown or finished run ${runId}. Call agenticview_next_task.` };
        }
        return p;
    }
    report(runId, events, workerId) {
        const p = this.active(runId, workerId);
        if (!("req" in p))
            return p;
        for (const ev of events) {
            const e = normalize(ev);
            if (!e)
                continue;
            if (e.type === "text")
                p.text += (p.text ? "\n" : "") + e.text;
            p.sink(e);
        }
        return { ok: true };
    }
    complete(runId, outcome, workerId) {
        const p = this.active(runId, workerId);
        if (!("req" in p))
            return p;
        const text = outcome.text ?? p.text;
        if (outcome.text)
            p.sink({ type: "text", text: outcome.text });
        if (outcome.error)
            p.settle({ text, stopReason: "error", error: outcome.error });
        else
            p.settle({ text, stopReason: "done" });
        return { ok: true };
    }
    /** The per-run bridge token (for calling bridge tools on the run's behalf), if the run is live. */
    bridgeAccess(runId, workerId) {
        const p = this.active(runId, workerId);
        if (!("req" in p))
            return p;
        if (!p.req.bridgeToken)
            return { ok: false, error: "This run has no bridge tools" };
        return { token: p.req.bridgeToken };
    }
    /** Mark a run's event as a tool call (used by the worker bridge route). */
    emit(runId, e) {
        this.runs.get(runId)?.sink(e);
    }
}
function normalize(ev) {
    switch (ev?.type) {
        case "text":
            return typeof ev.text === "string" && ev.text ? { type: "text", text: ev.text } : undefined;
        case "status":
            return typeof ev.text === "string" ? { type: "status", text: ev.text } : undefined;
        case "tool_start":
            return { type: "tool_start", name: String(ev.name ?? "tool"), input: ev.input ?? {} };
        case "tool_end":
            return { type: "tool_end", name: String(ev.name ?? "tool"), ok: ev.ok !== false, summary: String(ev.summary ?? "").slice(0, 500) };
        case "file_changed":
            return typeof ev.path === "string" ? { type: "file_changed", path: ev.path, kind: ev.kind ?? "modify" } : undefined;
        default:
            return undefined;
    }
}
function toSessionTask(req) {
    return {
        runId: req.runId,
        agent: { id: req.agent.id, name: req.agent.name, role: req.agent.role, specialty: req.agent.specialty },
        cwd: req.cwd,
        systemPrompt: req.systemPrompt,
        prompt: req.prompt.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n\n"),
        images: req.prompt.flatMap((p) => (p.type === "image" ? [p.path] : [])),
        model: req.model,
        effort: req.effort,
        tools: req.tools,
        permissionMode: req.permissionMode,
        bridgeTools: req.bridgeTools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: z.toJSONSchema(z.object(t.schema)),
        })),
    };
}
//# sourceMappingURL=session.js.map