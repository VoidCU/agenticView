import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SESSION_CAPACITY, MAX_SESSION_CAPACITY, defaultSessionName, } from "@agenticview/shared";
/**
 * `claude-session` provider: work is done by the user's own Claude Code sessions running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for sessions that pull them over HTTP (see api/worker.ts) and relays what they report.
 *
 * A session is a coordinator: it claims several runs at once (up to its capacity) and runs each in a
 * background subagent of the agent's own type (`.claude/agents/agenticview-<slug>.md`). Every call
 * about a run names its run id, so the office tells the concurrent runs apart.
 *
 * Sessions are identified by Claude Code's own session id, so the office recognises a session
 * again after it is closed and resumed. Agents are bound to a session ("affinity"):
 * - a session claims tasks of agents bound to it first;
 * - a task of an unbound agent goes to any session with a free slot, which then becomes the agent's session;
 * - a task of an agent bound to another known session waits for that session;
 * - one agent runs one task at a time in a session (its subagent continues its own thread of work).
 */
export const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";
/** In-memory hooks (tests, and before a world attaches its own). */
export function memoryHooks() {
    const bindings = new Map();
    const agents = new Map();
    return {
        bindings,
        agents,
        bindingOf: async (id) => bindings.get(id),
        bind: async (id, s) => void bindings.set(id, s?.id ?? null),
        findAgent: async (ref) => {
            for (const [id, name] of agents)
                if (id === ref || name.toLowerCase() === ref.toLowerCase())
                    return { id, name };
            return undefined;
        },
        save: async () => undefined,
    };
}
const CANCELLED_MSG = "This task was cancelled in the office. Stop working on it (stop its subagent).";
/** lastSeen is persisted at most this often while a session only polls. */
const SEEN_PERSIST_MS = 30_000;
export class SessionRuntime {
    provider = "claude-session";
    queue = [];
    runs = new Map();
    /** runIds cancelled recently, so a worker's next call is told to stop. */
    cancelled = new Set();
    seen = new Map();
    waiters = [];
    sessions = new Map();
    persistedSeen = new Map();
    /** `${sessionId}\n${agentRef}` pairs already bound by name, so a later office re-bind sticks. */
    namedBinds = new Set();
    liveMs;
    now;
    hooks;
    lock = Promise.resolve();
    lastCount = 0;
    lastSignature = "";
    /** Called when the connected-worker count changes (to refresh provider chips). */
    onWorkersChanged;
    /** Called when the session list (records, online state, current work) changes. */
    onSessionsChanged;
    constructor(opts = {}) {
        this.liveMs = opts.liveMs ?? 60_000;
        this.now = opts.now ?? Date.now;
        this.onWorkersChanged = opts.onWorkersChanged;
        this.hooks = opts.hooks ?? memoryHooks();
    }
    static newWorkerId() {
        return `w-${randomBytes(6).toString("hex")}`;
    }
    /** Attach the world's persistence and load the sessions it remembers. */
    attach(hooks, sessions = []) {
        this.hooks = hooks;
        for (const s of sessions)
            if (!this.sessions.has(s.id))
                this.sessions.set(s.id, { ...s, capacity: clampCapacity(s.capacity) });
        this.notifySessions();
    }
    serialize(fn) {
        const next = this.lock.then(fn, fn);
        this.lock = next.catch(() => undefined);
        return next;
    }
    // ---------- sessions ----------
    isOnline(id) {
        const at = this.seen.get(id);
        if (at !== undefined && at >= this.now() - this.liveMs)
            return true;
        return this.waiters.some((w) => w.workerId === id) || this.held(id).length > 0;
    }
    /** Live runs a session holds, oldest claim first. */
    held(id) {
        return [...this.runs.values()].filter((p) => p.workerId === id && !p.settled);
    }
    /** How many runs a session may hold at once. */
    capacityOf(id) {
        return clampCapacity(this.sessions.get(id)?.capacity);
    }
    /** Free slots of a session right now. */
    freeSlots(id) {
        return Math.max(0, this.capacityOf(id) - this.held(id).length);
    }
    /** Every known session with live state. */
    sessionList() {
        return [...this.sessions.values()]
            .map((s) => {
            const runs = this.held(s.id).map((p) => ({
                runId: p.req.runId,
                taskId: p.req.taskId ?? null,
                agentId: p.req.agent.id,
                subagent: p.subagent ?? null,
                subagentId: p.subagentId ?? null,
                startedAt: p.claimedAt ?? new Date(this.now()).toISOString(),
            }));
            const first = runs[0];
            return {
                ...s,
                capacity: clampCapacity(s.capacity),
                online: this.isOnline(s.id),
                currentRunId: first?.runId ?? null,
                currentAgentId: first?.agentId ?? null,
                currentTaskId: first?.taskId ?? null,
                runs,
            };
        })
            .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen.localeCompare(a.lastSeen));
    }
    session(id) {
        return this.sessions.get(id);
    }
    /** The session working on a run, if any (used by the manager deadlock guard). */
    sessionOfRun(runId) {
        return this.runs.get(runId)?.workerId;
    }
    /**
     * Slots of `sessionId` that could ever run another task while the runs in `waitingRunIds` (Managers
     * blocked on their workers) keep theirs: capacity minus those held, waiting runs.
     */
    spareSlotsBeside(sessionId, waitingRunIds) {
        const blocked = this.held(sessionId).filter((p) => waitingRunIds.includes(p.req.runId) || p.req.agent.role === "manager").length;
        return this.capacityOf(sessionId) - blocked;
    }
    async rename(id, name) {
        const s = this.sessions.get(id);
        if (!s)
            return undefined;
        s.name = name.trim().slice(0, 60) || s.name;
        s.named = true;
        await this.persist();
        this.notifySessions(true);
        return s;
    }
    /** Change how many runs a session holds at once (persisted). */
    async setCapacity(id, capacity) {
        const s = this.sessions.get(id);
        if (!s)
            return undefined;
        s.capacity = clampCapacity(capacity);
        await this.persist();
        this.notifySessions(true);
        this.kick();
        return s;
    }
    /** Forget a session record (its agents should be unbound by the caller). */
    async forget(id) {
        const had = this.sessions.delete(id);
        this.seen.delete(id);
        for (const k of [...this.namedBinds])
            if (k.startsWith(`${id}\n`))
                this.namedBinds.delete(k);
        if (had)
            await this.persist();
        this.notifySessions(true);
        this.kick();
        return had;
    }
    persist() {
        return this.hooks.save([...this.sessions.values()]).catch((e) => console.error("[agenticview] saving sessions failed", e));
    }
    /** Register a poll from a session: update its record and liveness. */
    touch(workerId, info) {
        const now = this.now();
        this.seen.set(workerId, now);
        const iso = new Date(now).toISOString();
        let s = this.sessions.get(workerId);
        let changed = false;
        if (!s) {
            s = {
                id: workerId,
                name: defaultSessionName(workerId, info?.cwd),
                model: info?.model ?? null,
                cwd: info?.cwd ?? null,
                firstSeen: iso,
                lastSeen: iso,
                named: false,
                capacity: DEFAULT_SESSION_CAPACITY,
            };
            this.sessions.set(workerId, s);
            changed = true;
        }
        else {
            s.lastSeen = iso;
            if (info?.model && info.model !== s.model) {
                s.model = info.model.slice(0, 120);
                changed = true;
            }
            if (info?.cwd && info.cwd !== s.cwd) {
                s.cwd = info.cwd;
                if (!s.named)
                    s.name = defaultSessionName(workerId, info.cwd);
                changed = true;
            }
        }
        if (changed || now - (this.persistedSeen.get(workerId) ?? 0) >= SEEN_PERSIST_MS) {
            this.persistedSeen.set(workerId, now);
            void this.persist();
        }
        this.notifyCount();
        this.notifySessions(changed);
    }
    /** Re-evaluate time-based online state (call periodically). */
    pulse() {
        this.notifyCount();
        this.notifySessions();
    }
    /** Re-run dispatch (after a binding changed in the office). */
    kick() {
        void this.dispatch();
    }
    notifySessions(force = false) {
        const sig = this.sessionList()
            .map((s) => `${s.id}:${s.online}:${s.runs.map((r) => `${r.runId}/${r.subagentId ?? ""}`).join(",")}:${s.name}:${s.model}:${s.capacity}`)
            .join("|");
        if (!force && sig === this.lastSignature)
            return;
        this.lastSignature = sig;
        this.onSessionsChanged?.();
    }
    // ---------- provider status ----------
    /** Number of sessions connected right now (polling within the liveness window or working on a run). */
    workers() {
        const ids = new Set([...this.seen.keys(), ...this.waiters.map((w) => w.workerId)]);
        for (const p of this.runs.values())
            if (p.workerId)
                ids.add(p.workerId);
        let n = 0;
        for (const id of ids) {
            if (this.isOnline(id))
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
    notifyCount() {
        const n = this.workers();
        if (n !== this.lastCount) {
            this.lastCount = n;
            this.onWorkersChanged?.();
        }
    }
    // ---------- runs ----------
    run(req, sink, signal) {
        return new Promise((resolve) => {
            const p = {
                req,
                sink,
                text: "",
                files: new Set(),
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
                    this.notifySessions();
                    resolve(r);
                    // A slot freed up: waiting polls of this session may take more work.
                    this.kick();
                },
            };
            const onAbort = () => {
                this.cancelled.add(req.runId);
                // Keep the tombstone bounded.
                if (this.cancelled.size > 200)
                    this.cancelled.delete(this.cancelled.values().next().value);
                const worker = p.workerId;
                p.settle({ text: p.text, stopReason: "aborted" });
                // Wake the session's waiting poll so it hears about the cancellation now.
                if (worker)
                    for (const w of this.waiters.filter((x) => x.workerId === worker))
                        w.resolve(null);
            };
            if (signal.aborted) {
                resolve({ text: "", stopReason: "aborted" });
                return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
            this.runs.set(req.runId, p);
            this.queue.push(req.runId);
            sink({ type: "status", text: this.queuedStatus(req) });
            void this.dispatch();
        });
    }
    queuedStatus(req) {
        const bound = req.agent.session?.id ? this.sessions.get(req.agent.session.id) : undefined;
        if (bound && !this.isOnline(bound.id)) {
            return `Waiting for Claude Code session "${bound.name}" (offline). Open that session, or choose "Use any session" in the office.`;
        }
        if (bound)
            return `Queued for Claude Code session "${bound.name}"`;
        if (this.workers() === 0)
            return `Waiting for a Claude Code session worker. ${SESSION_WORKER_HINT}`;
        return "Queued for a Claude Code session worker";
    }
    /** Pick the run a session should take: its bound agents first, then any unbound agent's. */
    async choose(workerId) {
        // One task per agent at a time in a session: its subagent carries one thread of work.
        const busyAgents = new Set(this.held(workerId).map((p) => p.req.agent.id));
        let unbound;
        for (const runId of this.queue) {
            const p = this.runs.get(runId);
            if (!p || p.workerId || busyAgents.has(p.req.agent.id))
                continue;
            const b = await this.hooks.bindingOf(p.req.agent.id);
            if (b === workerId)
                return { runId, bind: false };
            // A binding to a session the office no longer knows (forgotten) counts as unbound.
            if (!unbound && (!b || !this.sessions.has(b)))
                unbound = runId;
        }
        return unbound ? { runId: unbound, bind: true } : undefined;
    }
    /** Assign a run to a session when it has a free slot (caller holds the lock). */
    async take(workerId) {
        if (this.freeSlots(workerId) <= 0)
            return undefined;
        const pick = await this.choose(workerId);
        if (!pick)
            return undefined;
        const p = this.runs.get(pick.runId);
        if (!p || p.workerId || p.settled)
            return undefined;
        p.workerId = workerId;
        p.claimedAt = new Date(this.now()).toISOString();
        const qi = this.queue.indexOf(pick.runId);
        if (qi >= 0)
            this.queue.splice(qi, 1);
        const s = this.sessions.get(workerId);
        if (pick.bind && s) {
            await this.hooks.bind(p.req.agent.id, { id: s.id, name: s.name }).catch((e) => console.error("[agenticview] binding agent to session failed", e));
        }
        if (this.hooks.prepare) {
            try {
                const prep = await this.hooks.prepare(p.req);
                p.subagent = prep.subagent;
                p.recentWork = prep.recentWork;
            }
            catch (e) {
                console.error("[agenticview] preparing the subagent failed", e);
                p.subagent = null;
            }
        }
        p.sink({ type: "status", text: `Picked up by Claude Code session "${s?.name ?? workerId}"${p.subagent ? ` (subagent ${p.subagent})` : ""}` });
        this.attribute(p);
        this.notifySessions();
        return this.toTask(p, s);
    }
    attribute(p) {
        if (!p.workerId || !this.hooks.attribute)
            return;
        const s = this.sessions.get(p.workerId);
        void Promise.resolve(this.hooks.attribute({
            runId: p.req.runId,
            ...(p.req.taskId ? { taskId: p.req.taskId } : {}),
            agentId: p.req.agent.id,
            sessionId: p.workerId,
            sessionName: s?.name ?? p.workerId,
            ...(p.subagent ? { subagent: p.subagent } : {}),
            ...(p.subagentId ? { subagentId: p.subagentId } : {}),
            ...(p.files.size ? { files: [...p.files] } : {}),
        })).catch((e) => console.error("[agenticview] recording run attribution failed", e));
    }
    toTask(p, s) {
        return toSessionTask(p.req, s, { subagent: p.subagent, recentWork: p.recentWork });
    }
    /** Hand queued runs to waiting sessions. */
    dispatch() {
        return this.serialize(async () => {
            for (const w of [...this.waiters]) {
                if (!this.waiters.includes(w) || this.queue.length === 0)
                    continue;
                const task = await this.take(w.workerId);
                if (!task)
                    continue;
                const i = this.waiters.indexOf(w);
                if (i < 0) {
                    // The poll ended while we were binding: put the run back at the front.
                    const p = this.runs.get(task.runId);
                    if (p && !p.settled) {
                        p.workerId = undefined;
                        this.queue.unshift(task.runId);
                    }
                    continue;
                }
                this.waiters.splice(i, 1);
                w.resolve(task);
            }
        });
    }
    /**
     * Legacy single-run long-poll (one task per session): resolves null when nothing arrives within
     * `waitMs`. A session that already holds a run (it reconnected mid-task) gets that run again.
     */
    async claim(workerId, waitMs = 25_000, signal, info) {
        const res = await this.claimMany(workerId, { max: 1, waitMs, signal, info });
        return res.tasks[0] ?? null;
    }
    /**
     * Long-poll for up to `max` runs for session `workerId` (never more than its free slots). Returns as
     * soon as at least one run is available, a held run is cancelled, or `waitMs` passes.
     */
    async claimMany(workerId, opts = {}) {
        const { waitMs = 25_000, signal, info, holding } = opts;
        this.touch(workerId, info);
        if (info?.agent)
            await this.bindNamed(workerId, info.agent);
        const result = (tasks) => ({
            tasks,
            cancelled: holding ? holding.filter((id) => this.runs.get(id)?.workerId !== workerId && this.cancelled.has(id)) : [],
            gone: holding ? holding.filter((id) => this.runs.get(id)?.workerId !== workerId && !this.cancelled.has(id)) : [],
            capacity: this.capacityOf(workerId),
            held: this.held(workerId).length,
        });
        // Runs this session holds but the worker does not know about (it restarted): hand them back.
        const held = this.held(workerId);
        const lost = holding ? held.filter((p) => !holding.includes(p.req.runId)) : held.slice(0, 1);
        if (lost.length)
            return result(lost.map((p) => ({ ...this.toTask(p, this.sessions.get(workerId)), redelivered: true })));
        const early = result([]);
        if (early.cancelled.length || early.gone.length || opts.max === 0)
            return early;
        const want = Math.max(0, Math.min(opts.max ?? Infinity, this.freeSlots(workerId)));
        const out = [];
        const fill = () => this.serialize(async () => {
            while (out.length < want) {
                const t = await this.take(workerId);
                if (!t)
                    break;
                out.push(t);
            }
        });
        if (want > 0)
            await fill();
        if (out.length === 0) {
            // A held run may have been cancelled while we were filling: report it instead of waiting.
            const now = result([]);
            if (now.cancelled.length || now.gone.length)
                return now;
        }
        if (out.length === 0 && !signal?.aborted && waitMs > 0) {
            const first = await new Promise((resolve) => {
                const waiter = {
                    workerId,
                    resolve: (t) => {
                        clearTimeout(timer);
                        signal?.removeEventListener("abort", drop);
                        const i = this.waiters.indexOf(waiter);
                        if (i >= 0)
                            this.waiters.splice(i, 1);
                        resolve(t);
                    },
                };
                const drop = () => waiter.resolve(null);
                const timer = setTimeout(drop, Math.max(0, waitMs));
                signal?.addEventListener("abort", drop, { once: true });
                this.waiters.push(waiter);
                void this.dispatch();
            });
            this.touch(workerId);
            if (first) {
                out.push(first);
                await fill();
            }
        }
        if (out.length)
            this.touch(workerId);
        return result(out);
    }
    /** `/agenticview-work <agent>`: bind that agent to this session (once per session and name). */
    async bindNamed(workerId, ref) {
        const key = `${workerId}\n${ref.trim().toLowerCase()}`;
        if (!ref.trim() || this.namedBinds.has(key))
            return;
        const agent = await this.hooks.findAgent(ref.trim());
        if (!agent)
            return;
        this.namedBinds.add(key);
        const s = this.sessions.get(workerId);
        if ((await this.hooks.bindingOf(agent.id)) !== workerId && s)
            await this.hooks.bind(agent.id, { id: s.id, name: s.name });
    }
    active(runId, workerId) {
        if (workerId)
            this.touch(workerId);
        const p = this.runs.get(runId);
        if (!p) {
            if (this.cancelled.has(runId))
                return { ok: false, cancelled: true, error: CANCELLED_MSG };
            return { ok: false, error: `Unknown or finished run ${runId}. It may have been completed already.` };
        }
        return p;
    }
    /** Remember the subagent instance a session reported for a run (shown in the office, kept on the task). */
    noteSubagent(p, subagentId) {
        const id = typeof subagentId === "string" ? subagentId.trim().slice(0, 120) : "";
        if (!id || id === p.subagentId)
            return false;
        p.subagentId = id;
        this.notifySessions();
        return true;
    }
    report(runId, events, workerId, subagentId) {
        const p = this.active(runId, workerId);
        if (!("req" in p))
            return p;
        let changed = this.noteSubagent(p, subagentId);
        for (const ev of events) {
            const e = normalize(ev);
            if (!e)
                continue;
            if (e.type === "text")
                p.text += (p.text ? "\n" : "") + e.text;
            if (e.type === "file_changed" && !p.files.has(e.path)) {
                p.files.add(e.path);
                changed = true;
            }
            p.sink(e);
        }
        if (changed)
            this.attribute(p);
        return { ok: true };
    }
    complete(runId, outcome, workerId) {
        const p = this.active(runId, workerId);
        if (!("req" in p))
            return p;
        this.noteSubagent(p, outcome.subagentId);
        this.attribute(p);
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
function clampCapacity(n) {
    const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_SESSION_CAPACITY;
    return Math.min(MAX_SESSION_CAPACITY, Math.max(1, v));
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
function toSessionTask(req, s, extra = {}) {
    return {
        runId: req.runId,
        ...(req.taskId ? { taskId: req.taskId } : {}),
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
        ...(s ? { session: { id: s.id, name: s.name, model: s.model } } : {}),
        ...(extra.subagent !== undefined ? { subagent: extra.subagent } : {}),
        ...(extra.recentWork ? { recentWork: extra.recentWork } : {}),
    };
}
//# sourceMappingURL=session.js.map