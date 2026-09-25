import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Effort, Provider, ProviderStatus, RunEvent, RunResult, ToolAllowance, PermissionMode } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";

/**
 * `claude-session` provider: work is done by the user's own Claude Code session running
 * /agenticview-work. This runtime NEVER launches `claude` or the Agent SDK; it only queues runs
 * for workers that pull them over HTTP (see api/worker.ts) and relays what they report.
 */

export const SESSION_WORKER_HINT = "Run /agenticview-work in a Claude Code session to connect it.";

/** What a worker receives when it claims a run. */
export interface SessionTask {
  runId: string;
  agent: { id: string; name: string; role: string; specialty: string };
  cwd: string;
  systemPrompt: string;
  prompt: string;
  images: string[];
  model?: string;
  /** Requested reasoning effort; the session cannot change it, so it scales thoroughness instead. */
  effort?: Effort;
  tools: ToolAllowance;
  permissionMode: PermissionMode;
  bridgeTools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

export type WorkerReport =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_end"; name: string; ok?: boolean; summary?: string }
  | { type: "file_changed"; path: string; kind?: "create" | "modify" | "delete" }
  | { type: "status"; text: string };

export type WorkerAck = { ok: true } | { ok: false; cancelled?: boolean; error: string };

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
}

const CANCELLED_MSG = "This task was cancelled in the office. Stop working on it and call agenticview_next_task.";

export class SessionRuntime implements Runtime {
  readonly provider: Provider = "claude-session";
  private readonly queue: string[] = [];
  private readonly runs = new Map<string, Pending>();
  /** runIds cancelled recently, so a worker's next call is told to stop. */
  private readonly cancelled = new Set<string>();
  private readonly seen = new Map<string, number>();
  private readonly waiters: Waiter[] = [];
  private readonly liveMs: number;
  private readonly now: () => number;
  private lastCount = 0;
  /** Called when the connected-worker count changes (to refresh provider chips). */
  onWorkersChanged?: () => void;

  constructor(opts: SessionRuntimeOptions = {}) {
    this.liveMs = opts.liveMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.onWorkersChanged = opts.onWorkersChanged;
  }

  static newWorkerId(): string {
    return `w-${randomBytes(6).toString("hex")}`;
  }

  /** Number of workers seen within the liveness window (polling or working on a run). */
  workers(): number {
    const cutoff = this.now() - this.liveMs;
    let n = 0;
    for (const [id, at] of this.seen) {
      const busy = [...this.runs.values()].some((p) => p.workerId === id);
      if (at >= cutoff || busy || this.waiters.some((w) => w.workerId === id)) n++;
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

  private touch(workerId: string): void {
    this.seen.set(workerId, this.now());
    this.notifyCount();
  }

  private notifyCount(): void {
    const n = this.workers();
    if (n !== this.lastCount) {
      this.lastCount = n;
      this.onWorkersChanged?.();
    }
  }

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
      if (this.workers() === 0) sink({ type: "status", text: `Waiting for a Claude Code session worker. ${SESSION_WORKER_HINT}` });
      else sink({ type: "status", text: "Queued for a Claude Code session worker" });
      this.dispatch();
    });
  }

  /** Hand queued runs to waiting workers. */
  private dispatch(): void {
    while (this.queue.length > 0 && this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      const runId = this.queue.shift()!;
      const p = this.runs.get(runId);
      if (!p) continue;
      p.workerId = w.workerId;
      p.sink({ type: "status", text: "Picked up by a Claude Code session worker" });
      w.resolve(toSessionTask(p.req));
    }
  }

  /** Long-poll for the next run. Resolves null when nothing arrives within `waitMs`. */
  claim(workerId: string, waitMs = 25_000, signal?: AbortSignal): Promise<SessionTask | null> {
    this.touch(workerId);
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
      this.dispatch();
    });
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

function toSessionTask(req: RunRequest): SessionTask {
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
      inputSchema: z.toJSONSchema(z.object(t.schema)) as Record<string, unknown>,
    })),
  };
}
