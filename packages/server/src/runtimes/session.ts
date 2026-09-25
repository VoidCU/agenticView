import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  defaultSessionName,
  type Effort,
  type PermissionMode,
  type Provider,
  type ProviderStatus,
  type RunEvent,
  type RunResult,
  type ToolAllowance,
  type WorkerSession,
} from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";

/**
 * `claude-session` provider: work is done by the user's own Claude Code sessions running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for sessions that pull them over HTTP (see api/worker.ts) and relays what they report.
 *
 * Sessions are identified by Claude Code's own session id, so the office recognises a session
 * again after it is closed and resumed. Agents are bound to a session ("affinity"):
 * - a session claims tasks of agents bound to it first;
 * - a task of an unbound agent goes to any free session, which then becomes the agent's session;
 * - a task of an agent bound to another known session waits for that session.
 */

export const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";

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
  /** Model requested in the office (informational: only the user can switch a session's model). */
  model?: string;
  /** Requested reasoning effort; the session cannot change it, so it scales thoroughness instead. */
  effort?: Effort;
  tools: ToolAllowance;
  permissionMode: PermissionMode;
  bridgeTools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  /** The claiming session as the office knows it (its reported model drives the mismatch note). */
  session?: { id: string; name: string; model: string | null };
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

/** Where bindings and session records live (the world's agent registry and store). */
export interface SessionHooks {
  bindingOf(agentId: string): Promise<string | null | undefined>;
  bind(agentId: string, session: { id: string; name: string } | null): Promise<void>;
  findAgent(ref: string): Promise<{ id: string; name: string } | undefined>;
  save(sessions: WorkerSession[]): Promise<void>;
}

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

const CANCELLED_MSG = "This task was cancelled in the office. Stop working on it and call agenticview_next_task.";
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
    for (const s of sessions) if (!this.sessions.has(s.id)) this.sessions.set(s.id, s);
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
    return this.waiters.some((w) => w.workerId === id) || [...this.runs.values()].some((p) => p.workerId === id);
  }

  /** Every known session with live state. */
  sessionList(): (WorkerSession & { online: boolean; currentRunId: string | null; currentAgentId: string | null; currentTaskId: string | null })[] {
    return [...this.sessions.values()]
      .map((s) => {
        const run = [...this.runs.values()].find((p) => p.workerId === s.id);
        return { ...s, online: this.isOnline(s.id), currentRunId: run?.req.runId ?? null, currentAgentId: run?.req.agent.id ?? null, currentTaskId: run?.req.taskId ?? null };
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

  async rename(id: string, name: string): Promise<WorkerSession | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.name = name.trim().slice(0, 60) || s.name;
    s.named = true;
    await this.persist();
    this.notifySessions(true);
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
      s = { id: workerId, name: defaultSessionName(workerId, info?.cwd), model: info?.model ?? null, cwd: info?.cwd ?? null, firstSeen: iso, lastSeen: iso, named: false };
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
      .map((s) => `${s.id}:${s.online}:${s.currentRunId}:${s.name}:${s.model}`)
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
        },
      };
      const onAbort = () => {
        this.cancelled.add(req.runId);
        // Keep the tombstone bounded.
        if (this.cancelled.size > 200) this.cancelled.delete(this.cancelled.values().next().value!);
        p.settle({ text: p.text, stopReason: "aborted" });
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
    let unbound: string | undefined;
    for (const runId of this.queue) {
      const p = this.runs.get(runId);
      if (!p || p.workerId) continue;
      const b = await this.hooks.bindingOf(p.req.agent.id);
      if (b === workerId) return { runId, bind: false };
      // A binding to a session the office no longer knows (forgotten) counts as unbound.
      if (!unbound && (!b || !this.sessions.has(b))) unbound = runId;
    }
    return unbound ? { runId: unbound, bind: true } : undefined;
  }

  /** Assign a run to a session (caller holds the lock). */
  private async take(workerId: string): Promise<SessionTask | undefined> {
    const pick = await this.choose(workerId);
    if (!pick) return undefined;
    const p = this.runs.get(pick.runId);
    if (!p || p.workerId || p.settled) return undefined;
    p.workerId = workerId;
    const qi = this.queue.indexOf(pick.runId);
    if (qi >= 0) this.queue.splice(qi, 1);
    const s = this.sessions.get(workerId);
    if (pick.bind && s) {
      await this.hooks.bind(p.req.agent.id, { id: s.id, name: s.name }).catch((e) => console.error("[agenticview] binding agent to session failed", e));
    }
    p.sink({ type: "status", text: `Picked up by Claude Code session "${s?.name ?? workerId}"` });
    this.notifySessions();
    return toSessionTask(p.req, s);
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
   * Long-poll for the next run for session `workerId`. Resolves null when nothing arrives within
   * `waitMs`. A session that already holds a run (it reconnected mid-task) gets that run again.
   */
  async claim(workerId: string, waitMs = 25_000, signal?: AbortSignal, info?: ClaimInfo): Promise<SessionTask | null> {
    this.touch(workerId, info);
    if (info?.agent) await this.bindNamed(workerId, info.agent);
    const held = [...this.runs.values()].find((p) => p.workerId === workerId && !p.settled);
    if (held) return { ...toSessionTask(held.req, this.sessions.get(workerId)), redelivered: true };
    const now = await this.serialize(() => this.take(workerId));
    if (now) {
      this.touch(workerId);
      return now;
    }
    if (signal?.aborted) return null;
    return new Promise((resolve) => {
      const waiter: Waiter = {
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
        if (i >= 0) this.waiters.splice(i, 1);
        waiter.resolve(null);
      };
      const timer = setTimeout(drop, Math.max(0, waitMs));
      signal?.addEventListener("abort", drop, { once: true });
      this.waiters.push(waiter);
      void this.dispatch();
    });
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
      return { ok: false, error: `Unknown or finished run ${runId}. Call agenticview_next_task.` };
    }
    return p;
  }

  report(runId: string, events: WorkerReport[], workerId?: string): WorkerAck {
    const p = this.active(runId, workerId);
    if (!("req" in p)) return p;
    for (const ev of events) {
      const e = normalize(ev);
      if (!e) continue;
      if (e.type === "text") p.text += (p.text ? "\n" : "") + e.text;
      p.sink(e);
    }
    return { ok: true };
  }

  complete(runId: string, outcome: { text?: string; error?: string }, workerId?: string): WorkerAck {
    const p = this.active(runId, workerId);
    if (!("req" in p)) return p;
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

function toSessionTask(req: RunRequest, s?: WorkerSession): SessionTask {
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
  };
}
