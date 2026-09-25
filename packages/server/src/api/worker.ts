import { Hono } from "hono";
import { BridgeAuthError, type ToolRegistry } from "../bridge/toolRegistry.js";
import { SessionRuntime, type WorkerReport } from "../runtimes/session.js";

const MAX_WAIT_MS = 25_000;
/**
 * Long bridge calls from a session (await_tasks) return early after this long with the tasks still
 * running, so no HTTP or MCP tool-call timeout between the session and the office can cut them off;
 * the session calls again to keep waiting.
 */
export const BRIDGE_AWAIT_CHUNK_SECONDS = 240;

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Endpoints for Claude Code session workers (/agenticview-work). Mounted under /api, so they
 * require the launch token like the rest of the API. Workers identify themselves with the
 * `x-agenticview-worker` header; polls double as heartbeats.
 */
export function workerRoutes(session: SessionRuntime, toolRegistry: ToolRegistry): Hono {
  const app = new Hono();
  const workerOf = (h: string | undefined) => (h && /^[\w-]{1,64}$/.test(h) ? h : "anonymous");

  const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
    try {
      const b = await c.req.json();
      return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  app.post("/api/worker/claim", async (c) => {
    const b = await body(c);
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number(b.waitMs ?? MAX_WAIT_MS) || 0));
    const info = b.session && typeof b.session === "object" ? (b.session as Record<string, unknown>) : {};
    const claimInfo = { model: str(info.model, 120), cwd: str(info.cwd, 1000), agent: str(info.agent, 40) };
    const worker = workerOf(c.req.header("x-agenticview-worker"));
    // Multi-run workers send the runs they hold (and optionally a max); older workers get one task at a time.
    if (Array.isArray(b.holding) || b.max !== undefined) {
      const holding = Array.isArray(b.holding) ? b.holding.filter((x): x is string => typeof x === "string").slice(0, 64) : [];
      const max = b.max === undefined ? undefined : Math.max(0, Math.min(64, Math.floor(Number(b.max)) || 0));
      const res = await session.claimMany(worker, { max, waitMs: wait, signal: c.req.raw.signal, info: claimInfo, holding });
      return c.json({ ...res, task: res.tasks[0] ?? null });
    }
    const task = await session.claim(worker, wait, c.req.raw.signal, claimInfo);
    return c.json({ task });
  });

  app.post("/api/worker/:runId/report", async (c) => {
    const b = await body(c);
    const events = Array.isArray(b.events) ? (b.events as WorkerReport[]) : [];
    return c.json(session.report(c.req.param("runId"), events, workerOf(c.req.header("x-agenticview-worker")), str(b.subagentId, 120)));
  });

  app.post("/api/worker/:runId/complete", async (c) => {
    const b = await body(c);
    const outcome = { text: typeof b.text === "string" ? b.text : undefined, error: typeof b.error === "string" && b.error ? b.error : undefined, subagentId: str(b.subagentId, 120) };
    return c.json(session.complete(c.req.param("runId"), outcome, workerOf(c.req.header("x-agenticview-worker"))));
  });

  app.post("/api/worker/:runId/bridge", async (c) => {
    const runId = c.req.param("runId");
    const b = await body(c);
    const name = String(b.name ?? "");
    const args = b.args && typeof b.args === "object" ? { ...(b.args as Record<string, unknown>) } : {};
    if (name === "await_tasks" && args.maxWaitSeconds === undefined) args.maxWaitSeconds = Number(process.env.AGENTICVIEW_AWAIT_CHUNK_SECONDS) || BRIDGE_AWAIT_CHUNK_SECONDS;
    const access = session.bridgeAccess(runId, workerOf(c.req.header("x-agenticview-worker")));
    if (!("token" in access)) return c.json(access);
    session.emit(runId, { type: "tool_start", name, input: args });
    try {
      const result = await toolRegistry.call(runId, access.token, name, args);
      session.emit(runId, { type: "tool_end", name, ok: true, summary: result.slice(0, 200) });
      return c.json({ ok: true, result });
    } catch (e) {
      const error = e instanceof BridgeAuthError ? "Run is no longer active" : (e as Error).message;
      session.emit(runId, { type: "tool_end", name, ok: false, summary: error });
      return c.json({ ok: false, error });
    }
  });

  return app;
}
