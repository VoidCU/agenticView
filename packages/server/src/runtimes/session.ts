import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_SESSION_CAPACITY,
  MAX_SESSION_CAPACITY,
  defaultSessionName,
  type Effort,
  type PermissionMode,
  type Provider,
  type ProviderStatus,
  type RunEvent,
  type RunResult,
  type SessionRunInfo,
  type ToolAllowance,
  type WorkerSession,
} from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";

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

/** One earlier task of the agent, for the "Your recent work" digest. */
export interface RecentWork {
  taskId: string;
  title: string;
  status: string;
  /** Short result or error. */
  summary: string;
  files: string[];
  finishedAt?: string;
  subagentId?: string;
  sessionName?: string;
}

/** What a worker receives when it claims a run. */
export interface SessionTask {
  runId: string;
  /** Office task id (for display). */
  taskId?: string;
  agent: { id: string; name: string; role: string; specialty: string };
  cwd: string;
  systemPrompt: string;
  prompt: string;
  images: string[];
  /** Model requested in the office (a subagent with a Claude model alias really runs on it). */
  model?: string;
  /** Requested reasoning effort; the session cannot change it, so it scales thoroughness instead. */
  effort?: Effort;
  tools: ToolAllowance;
  permissionMode: PermissionMode;
  bridgeTools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  /** The claiming session as the office knows it (its reported model drives the mismatch note). */
  session?: { id: string; name: string; model: string | null };
  /** Claude Code subagent type to launch for this run (null: no file, do it in the main thread). */
  subagent?: string | null;
  /** The agent's previous tasks, newest first. */
  recentWork?: RecentWork[];
  /** True when the office hands back a task this session already claimed (e.g. after a reconnect). */
  redelivered?: boolean;
}

export type WorkerReport =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_end"; name: string; ok?: boolean; summary?: string }
  | { type: "file_changed"; path: string; kind?: "create" | "modify" | "delete" }
  | { type: "status"; text: string };

export type WorkerAck = { ok: true } | { ok: false; cancelled?: boolean; error: string };

/** What a session tells the office about itself on each poll. */
export interface ClaimInfo {
  model?: string;
  cwd?: string;
  /** Agent name (or id) the user named in `/agenticview-work <agent>`: bind it to this session. */
  agent?: string;
}

export interface ClaimOptions {
  /** Most new runs to hand out (default: every free slot). */
  max?: number;
  waitMs?: number;
  signal?: AbortSignal;
  info?: ClaimInfo;
  /**
   * Run ids the worker still tracks. Held runs missing from it are handed back (redelivered), and ids in
   * it that are no longer live for this session come back in `cancelled`. Omitted: legacy one-run worker.
   */
  holding?: string[];
}

export interface ClaimResult {
  tasks: SessionTask[];
  /** Run ids from `holding` that were cancelled in the office: stop their subagents. */
  cancelled: string[];
  /** Run ids from `holding` that are finished or unknown (completed elsewhere, office restarted): forget them. */
  gone: string[];
  capacity: number;
  /** Runs this session holds after the claim. */
  held: number;
}

/** What the office records about a run as it is claimed, reported on and finished. */
export interface RunAttribution {
  runId: string;
  taskId?: string;
  agentId: string;
  sessionId: string;
  sessionName: string;
  subagent?: string;
  subagentId?: string;
  files?: string[];
}

/** Where bindings and session records live (the world's agent registry and store). */
export interface SessionHooks {
  bindingOf(agentId: string): Promise<string | null | undefined>;
  bind(agentId: string, session: { id: string; name: string } | null): Promise<void>;
  findAgent(ref: string): Promise<{ id: string; name: string } | undefined>;
  save(sessions: WorkerSessionRecord[]): Promise<void>;
  /** Before a run is handed out: make sure its subagent file exists and collect the agent's recent work. */
  prepare?(req: RunRequest): Promise<{ subagent: string | null; recentWork: RecentWork[] }>;
  /** A run was claimed, or its subagent id / changed files became known. */
  attribute?(info: RunAttribution): void | Promise<void>;
}

/** Session record as persisted (capacity may be missing in files written by older versions). */
export type WorkerSessionRecord = WorkerSession;

/** In-memory hooks (tests, and before a world attaches its own). */
export function memoryHooks(): SessionHooks & { bindings: Map<string, string | null>; agents: Map<string, string> } {
  const bindings = new Map<string, string | null>();
  const agents = new Map<string, string>();
  return {
    bindings,
    agents,
    bindingOf: async (id) => bindings.get(id),
    bind: async (id, s) => void bindings.set(id, s?.id ?? null),
    findAgent: async (ref) => {
      for (const [id, name] of agents) if (id === ref || name.toLowerCase() === ref.toLowerCase()) return { id, name };
      return undefined;
    },
    save: async () => undefined,
  };
}

interface Pending {
  req: RunRequest;
  sink: EventSink;
  text: string;
  workerId?: string;
  claimedAt?: string;
  subagent?: string | null;
  subagentId?: string;
  recentWork?: RecentWork[];
  files: Set<string>;
  settle: (r: RunResult) => void;
  settled: boolean;
}

interface Waiter {
  workerId: string;
  resolve: (t: SessionTask | null) => void;
}

export interface SessionRuntimeOptions {
  /** A worker counts as connected when it was seen within this window. */
  liveMs?: number;
  /** Called when the connected-worker count changes (to refresh provider chips). */
  onWorkersChanged?: () => void;
  now?: () => number;
  hooks?: SessionHooks;
}

const CANCELLED_MSG = "This task was cancelled in the office. Stop working on it (stop its subagent).";
/** lastSeen is persisted at most this often while a session only polls. */
const SEEN_PERSIST_MS = 30_000;

export class SessionRuntime implements Runtime {
  readonly provider: Provider = "claude-session";
  private readonly queue: string[] = [];
  private readonly runs = new Map<string, Pending>();
  /** runIds cancelled recently, so a worker's next call is told to stop. */
  private readonly cancelled = new Set<string>();
  private readonly seen = new Map<string, number>();
  private readonly waiters: Waiter[] = [];
  private readonly sessions = new Map<string, WorkerSession>();
  private readonly persistedSeen = new Map<string, number>();
  /** `${sessionId}\n${agentRef}` pairs already bound by name, so a later office re-bind sticks. */
  private readonly namedBinds = new Set<string>();
  private readonly liveMs: number;
  private readonly now: () => number;
  private hooks: SessionHooks;
  private lock: Promise<unknown> = Promise.resolve();
  private lastCount = 0;
  private lastSignature = "";
  /** Called when the connected-worker count changes (to refresh provider chips). */
  onWorkersChanged?: () => void;
  /** Called when the session list (records, online state, current work) changes. */
  onSessionsChanged?: () => void;

  constructor(opts: SessionRuntimeOptions = {}) {
    this.liveMs = opts.liveMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.onWorkersChanged = opts.onWorkersChanged;
    this.hooks = opts.hooks ?? memoryHooks();
  }

  static newWorkerId(): string {
    return `w-${randomBytes(6).toString("hex")}`;
  }

  /** Attach the world's persistence and load the sessions it remembers. */
  attach(hooks: SessionHooks, sessions: WorkerSession[] = []): void {
    this.hooks = hooks;
    for (const s of sessions) if (!this.sessions.has(s.id)) this.sessions.set(s.id, { ...s, capacity: clampCapacity(s.capacity) });
    this.notifySessions();
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  // ---------- sessions ----------

  isOnline(id: string): boolean {
    const at = this.seen.get(id);
    if (at !== undefined && at >= this.now() - this.liveMs) return true;
    return this.waiters.some((w) => w.workerId === id) || this.held(id).length > 0;
  }

  /** Live runs a session holds, oldest claim first. */
  private held(id: string): Pending[] {
    return [...this.runs.values()].filter((p) => p.workerId === id && !p.settled);
  }

  /** How many runs a session may hold at once. */
  capacityOf(id: string): number {
    return clampCapacity(this.sessions.get(id)?.capacity);
  }

  /** Free slots of a session right now. */
  freeSlots(id: string): number {
    return Math.max(0, this.capacityOf(id) - this.held(id).length);
  }

  /** Every known session with live state. */
  sessionList(): (WorkerSession & { online: boolean; currentRunId: string | null; currentAgentId: string | null; currentTaskId: string | null; runs: SessionRunInfo[] })[] {
    return [...this.sessions.values()]
      .map((s) => {
        const runs: SessionRunInfo[] = this.held(s.id).map((p) => ({
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

  session(id: string): WorkerSession | undefined {
    return this.sessions.get(id);
  }

  /** The session working on a run, if any (used by the manager deadlock guard). */
  sessionOfRun(runId: string): string | undefined {
    return this.runs.get(runId)?.workerId;
  }

  /**
   * Slots of `sessionId` that could ever run another task while the runs in `waitingRunIds` (Managers
   * blocked on their workers) keep theirs: capacity minus those held, waiting runs.
   */
  spareSlotsBeside(sessionId: string, waitingRunIds: string[]): number {
    const blocked = this.held(sessionId).filter((p) => waitingRunIds.includes(p.req.runId) || p.req.agent.role === "manager").length;
    return this.capacityOf(sessionId) - blocked;
  }

  async rename(id: string, name: string): Promise<WorkerSession | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.name = name.trim().slice(0, 60) || s.name;
    s.named = true;
    await this.persist();
    this.notifySessions(true);
    return s;
  }

  /** Change how many runs a session holds at once (persisted). */
  async setCapacity(id: string, capacity: number): Promise<WorkerSession | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.capacity = clampCapacity(capacity);
    await this.persist();
    this.notifySessions(true);
    this.kick();
    return s;
  }

  /** Forget a session record (its agents should be unbound by the caller). */
  async forget(id: string): Promise<boolean> {
    const had = this.sessions.delete(id);
    this.seen.delete(id);
    for (const k of [...this.namedBinds]) if (k.startsWith(`${id}\n`)) this.namedBinds.delete(k);
    if (had) await this.persist();
    this.notifySessions(true);
    this.kick();
    return had;
  }

  private persist(): Promise<void> {
    return this.hooks.save([...this.sessions.values()]).catch((e) => console.error("[agenticview] saving sessions failed", e));
  }

  /** Register a poll from a session: update its record and liveness. */
  private touch(workerId: string, info?: ClaimInfo): void {
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
    } else {
      s.lastSeen = iso;
      if (info?.model && info.model !== s.model) {
        s.model = info.model.slice(0, 120);
        changed = true;
      }
      if (info?.cwd && info.cwd !== s.cwd) {
        s.cwd = info.cwd;
        if (!s.named) s.name = defaultSessionName(workerId, info.cwd);
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
  pulse(): void {
    this.notifyCount();
    this.notifySessions();
  }

  /** Re-run dispatch (after a binding changed in the office). */
  kick(): void {
    void this.dispatch();
  }

  private notifySessions(force = false): void {
    const sig = this.sessionList()
      .map((s) => `${s.id}:${s.online}:${s.runs.map((r) => `${r.runId}/${r.subagentId ?? ""}`).join(",")}:${s.name}:${s.model}:${s.capacity}`)
      .join("|");
    if (!force && sig === this.lastSignature) return;
    this.lastSignature = sig;
    this.onSessionsChanged?.();
  }

  // ---------- provider status ----------

  /** Number of sessions connected right now (polling within the liveness window or working on a run). */
  workers(): number {
    const ids = new Set<string>([...this.seen.keys(), ...this.waiters.map((w) => w.workerId)]);
    for (const p of this.runs.values()) if (p.workerId) ids.add(p.workerId);
    let n = 0;
    for (const id of ids) {
      if (this.isOnline(id)) n++;
      else this.seen.delete(id);
    }
    return n;
  }

  queued(): number {
    return this.queue.length;
  }

  async check(): Promise<ProviderStatus> {
    const n = this.workers();
    if (n > 0) return { provider: this.provider, ok: true, version: `${n} worker${n === 1 ? "" : "s"}` };
    return { provider: this.provider, ok: false, reason: SESSION_WORKER_HINT };
  }

  private notifyCount(): void {
    const n = this.workers();
    if (n !== this.lastCount) {
      this.lastCount = n;
      this.onWorkersChanged?.();
    }
  }

  // ---------- runs ----------

  run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => {
      const p: Pending = {
        req,
        sink,
        text: "",
        files: new Set(),
        settled: false,
        settle: (r) => {
          if (p.settled) return;
          p.settled = true;
          this.runs.delete(req.runId);
          const qi = this.queue.indexOf(req.runId);
          if (qi >= 0) this.queue.splice(qi, 1);
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
        if (this.cancelled.size > 200) this.cancelled.delete(this.cancelled.values().next().value!);
        const worker = p.workerId;
        p.settle({ text: p.text, stopReason: "aborted" });
        // Wake the session's waiting poll so it hears about the cancellation now.
        if (worker) for (const w of this.waiters.filter((x) => x.workerId === worker)) w.resolve(null);
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

  private queuedStatus(req: RunRequest): string {
    const bound = req.agent.session?.id ? this.sessions.get(req.agent.session.id) : undefined;
    if (bound && !this.isOnline(bound.id)) {
      return `Waiting for Claude Code session "${bound.name}" (offline). Open that session, or choose "Use any session" in the office.`;
    }
    if (bound) return `Queued for Claude Code session "${bound.name}"`;
    if (this.workers() === 0) return `Waiting for a Claude Code session worker. ${SESSION_WORKER_HINT}`;
    return "Queued for a Claude Code session worker";
  }

  /** Pick the run a session should take: its bound agents first, then any unbound agent's. */
  private async choose(workerId: string): Promise<{ runId: string; bind: boolean } | undefined> {
    // One task per worker agent at a time in a session: its subagent carries one thread of work. A Manager is
    // exempt: while one request waits on its workers, the next request must not queue behind it, so each
    // Manager request runs in its own subagent instance.
    const busyAgents = new Set(this.held(workerId).filter((p) => p.req.agent.role !== "manager").map((p) => p.req.agent.id));
    let unbound: string | undefined;
    for (const runId of this.queue) {
      const p = this.runs.get(runId);
      if (!p || p.workerId || busyAgents.has(p.req.agent.id)) continue;
      const b = await this.hooks.bindingOf(p.req.agent.id);
      if (b === workerId) return { runId, bind: false };
      // A binding to a session the office no longer knows (forgotten) counts as unbound.
      if (!unbound && (!b || !this.sessions.has(b))) unbound = runId;
    }
    return unbound ? { runId: unbound, bind: true } : undefined;
  }

  /** Assign a run to a session when it has a free slot (caller holds the lock). */
  private async take(workerId: string): Promise<SessionTask | undefined> {
    if (this.freeSlots(workerId) <= 0) return undefined;
    const pick = await this.choose(workerId);
    if (!pick) return undefined;
    const p = this.runs.get(pick.runId);
    if (!p || p.workerId || p.settled) return undefined;
    p.workerId = workerId;
    p.claimedAt = new Date(this.now()).toISOString();
    const qi = this.queue.indexOf(pick.runId);
    if (qi >= 0) this.queue.splice(qi, 1);
    const s = this.sessions.get(workerId);
    if (pick.bind && s) {
      await this.hooks.bind(p.req.agent.id, { id: s.id, name: s.name }).catch((e) => console.error("[agenticview] binding agent to session failed", e));
    }
    if (this.hooks.prepare) {
      try {
        const prep = await this.hooks.prepare(p.req);
        p.subagent = prep.subagent;
        p.recentWork = prep.recentWork;
      } catch (e) {
        console.error("[agenticview] preparing the subagent failed", e);
        p.subagent = null;
      }
    }
    if (p.req.readOnly && !p.subagent) {
      this.complete(p.req.runId, { error: "Read-only task requires a generated restricted subagent; preparation failed" }, workerId);
      return undefined;
    }
    p.sink({ type: "status", text: `Picked up by Claude Code session "${s?.name ?? workerId}"${p.subagent ? ` (subagent ${p.subagent})` : ""}` });
    this.attribute(p);
    this.notifySessions();
    return this.toTask(p, s);
  }

  private attribute(p: Pending): void {
    if (!p.workerId || !this.hooks.attribute) return;
    const s = this.sessions.get(p.workerId);
    void Promise.resolve(
      this.hooks.attribute({
        runId: p.req.runId,
        ...(p.req.taskId ? { taskId: p.req.taskId } : {}),
        agentId: p.req.agent.id,
        sessionId: p.workerId,
        sessionName: s?.name ?? p.workerId,
        ...(p.subagent ? { subagent: p.subagent } : {}),
        ...(p.subagentId ? { subagentId: p.subagentId } : {}),
        ...(p.files.size ? { files: [...p.files] } : {}),
      }),
    ).catch((e) => console.error("[agenticview] recording run attribution failed", e));
  }

  private toTask(p: Pending, s?: WorkerSession): SessionTask {
    return toSessionTask(p.req, s, { subagent: p.subagent, recentWork: p.recentWork });
  }

  /** Hand queued runs to waiting sessions. */
  private dispatch(): Promise<void> {
    return this.serialize(async () => {
      for (const w of [...this.waiters]) {
        if (!this.waiters.includes(w) || this.queue.length === 0) continue;
        const task = await this.take(w.workerId);
        if (!task) continue;
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
  async claim(workerId: string, waitMs = 25_000, signal?: AbortSignal, info?: ClaimInfo): Promise<SessionTask | null> {
    const res = await this.claimMany(workerId, { max: 1, waitMs, signal, info });
    return res.tasks[0] ?? null;
  }

  /**
   * Long-poll for up to `max` runs for session `workerId` (never more than its free slots). Returns as
   * soon as at least one run is available, a held run is cancelled, or `waitMs` passes.
   */
  async claimMany(workerId: string, opts: ClaimOptions = {}): Promise<ClaimResult> {
    const { waitMs = 25_000, signal, info, holding } = opts;
    this.touch(workerId, info);
    if (info?.agent) await this.bindNamed(workerId, info.agent);
    const result = (tasks: SessionTask[]): ClaimResult => ({
      tasks,
      cancelled: holding ? holding.filter((id) => this.runs.get(id)?.workerId !== workerId && this.cancelled.has(id)) : [],
      gone: holding ? holding.filter((id) => this.runs.get(id)?.workerId !== workerId && !this.cancelled.has(id)) : [],
      capacity: this.capacityOf(workerId),
      held: this.held(workerId).length,
    });

    // Runs this session holds but the worker does not know about (it restarted): hand them back.
    const held = this.held(workerId);
    const lost = holding ? held.filter((p) => !holding.includes(p.req.runId)) : held.slice(0, 1);
    if (lost.length) return result(lost.map((p) => ({ ...this.toTask(p, this.sessions.get(workerId)), redelivered: true })));

    const early = result([]);
    if (early.cancelled.length || early.gone.length || opts.max === 0) return early;
    const want = Math.max(0, Math.min(opts.max ?? Infinity, this.freeSlots(workerId)));
    const out: SessionTask[] = [];
    const fill = () =>
      this.serialize(async () => {
        while (out.length < want) {
          const t = await this.take(workerId);
          if (!t) break;
          out.push(t);
        }
      });
    if (want > 0) await fill();
    if (out.length === 0) {
      // A held run may have been cancelled while we were filling: report it instead of waiting.
      const now = result([]);
      if (now.cancelled.length || now.gone.length) return now;
    }
    if (out.length === 0 && !signal?.aborted && waitMs > 0) {
      const first = await new Promise<SessionTask | null>((resolve) => {
        const waiter: Waiter = {
          workerId,
          resolve: (t) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", drop);
            const i = this.waiters.indexOf(waiter);
            if (i >= 0) this.waiters.splice(i, 1);
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
    if (out.length) this.touch(workerId);
    return result(out);
  }

  /** `/agenticview-work <agent>`: bind that agent to this session (once per session and name). */
  private async bindNamed(workerId: string, ref: string): Promise<void> {
    const key = `${workerId}\n${ref.trim().toLowerCase()}`;
    if (!ref.trim() || this.namedBinds.has(key)) return;
    const agent = await this.hooks.findAgent(ref.trim());
    if (!agent) return;
    this.namedBinds.add(key);
    const s = this.sessions.get(workerId);
    if ((await this.hooks.bindingOf(agent.id)) !== workerId && s) await this.hooks.bind(agent.id, { id: s.id, name: s.name });
  }

  private active(runId: string, workerId?: string): Pending | WorkerAck {
    if (workerId) this.touch(workerId);
    const p = this.runs.get(runId);
    if (!p) {
      if (this.cancelled.has(runId)) return { ok: false, cancelled: true, error: CANCELLED_MSG };
      return { ok: false, error: `Unknown or finished run ${runId}. It may have been completed already.` };
    }
    return p;
  }

  /** Remember the subagent instance a session reported for a run (shown in the office, kept on the task). */
  private noteSubagent(p: Pending, subagentId?: string): boolean {
    const id = typeof subagentId === "string" ? subagentId.trim().slice(0, 120) : "";
    if (!id || id === p.subagentId) return false;
    p.subagentId = id;
    this.notifySessions();
    return true;
  }

  report(runId: string, events: WorkerReport[], workerId?: string, subagentId?: string): WorkerAck {
    const p = this.active(runId, workerId);
    if (!("req" in p)) return p;
    let changed = this.noteSubagent(p, subagentId);
    for (const ev of events) {
      const e = normalize(ev);
      if (!e) continue;
      if (e.type === "text") p.text += (p.text ? "\n" : "") + e.text;
      if (e.type === "file_changed" && !p.files.has(e.path)) {
        p.files.add(e.path);
        changed = true;
      }
      p.sink(e);
    }
    if (changed) this.attribute(p);
    return { ok: true };
  }

  complete(runId: string, outcome: { text?: string; error?: string; subagentId?: string }, workerId?: string): WorkerAck {
    const p = this.active(runId, workerId);
    if (!("req" in p)) return p;
    this.noteSubagent(p, outcome.subagentId);
    this.attribute(p);
    const text = outcome.text ?? p.text;
    if (outcome.text) p.sink({ type: "text", text: outcome.text });
    if (outcome.error) p.settle({ text, stopReason: "error", error: outcome.error });
    else p.settle({ text, stopReason: "done" });
    return { ok: true };
  }

  /** The per-run bridge token (for calling bridge tools on the run's behalf), if the run is live. */
  bridgeAccess(runId: string, workerId?: string): { token: string } | WorkerAck {
    const p = this.active(runId, workerId);
    if (!("req" in p)) return p;
    if (!p.req.bridgeToken) return { ok: false, error: "This run has no bridge tools" };
    return { token: p.req.bridgeToken };
  }

  /** Mark a run's event as a tool call (used by the worker bridge route). */
  emit(runId: string, e: RunEvent): void {
    this.runs.get(runId)?.sink(e);
  }
}

function clampCapacity(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_SESSION_CAPACITY;
  return Math.min(MAX_SESSION_CAPACITY, Math.max(1, v));
}

function normalize(ev: WorkerReport): RunEvent | undefined {
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

function toSessionTask(req: RunRequest, s?: WorkerSession, extra: { subagent?: string | null; recentWork?: RecentWork[] } = {}): SessionTask {
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
      inputSchema: z.toJSONSchema(z.object(t.schema)) as Record<string, unknown>,
    })),
    ...(s ? { session: { id: s.id, name: s.name, model: s.model } } : {}),
    ...(extra.subagent !== undefined ? { subagent: extra.subagent } : {}),
    ...(extra.recentWork ? { recentWork: extra.recentWork } : {}),
  };
}
